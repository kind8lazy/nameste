// Заявки родителей: новая поездка или маршрут. Диспетчер принимает — появляются шаблоны недели и поездки.
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { HttpError } from './auth';
import { geocode } from './geo';
import { requireFamilyPlace, requireNoDuplicateTemplate } from './places';
import { materialize } from './schedule';
import { planDay } from './planner';
import { notifyFamily, notifyUsers } from './notify';
import { publish, channel } from './realtime';
import { childPrice, quote } from '../../shared/pricing';
import { describeRule, parseRule } from '../../shared/recurrence';
import { addDays, formatDateRu, localDate } from '../../shared/time';
import type { Escort } from '../../shared/domain';

export interface RequestInput {
  childIds: string[];
  fromPlaceId?: string | null;
  fromAddress?: string | null;
  toPlaceId?: string | null;
  toAddress?: string | null;
  time: string;
  rule: string;
  startDate: string;
  escort: Escort;
  comment?: string | null;
}

export function createRequest(familyId: string, userId: string, input: RequestInput) {
  const kids = db.select().from(schema.children).where(inArray(schema.children.id, input.childIds)).all();
  if (!kids.length || kids.some((k) => k.familyId !== familyId)) throw new HttpError(400, 'Выберите детей из своей семьи');
  for (const pid of [input.fromPlaceId, input.toPlaceId]) if (pid) requireFamilyPlace(familyId, pid);
  if (!input.fromPlaceId && !input.fromAddress?.trim()) throw new HttpError(400, 'Укажите, откуда забрать');
  if (!input.toPlaceId && !input.toAddress?.trim()) throw new HttpError(400, 'Укажите, куда отвезти');
  const sameAddress = input.fromAddress?.trim() && input.fromAddress.trim().toLowerCase() === input.toAddress?.trim().toLowerCase();
  if ((input.fromPlaceId && input.fromPlaceId === input.toPlaceId) || sameAddress) throw new HttpError(400, 'Откуда и куда — один и тот же адрес. Выберите разные места.');
  try {
    parseRule(input.rule);
  } catch {
    throw new HttpError(400, 'Неверный повтор поездки');
  }
  if (input.startDate < localDate()) throw new HttpError(400, 'Дата уже прошла. Выберите сегодня или позже.');
  const q = quote(kids.length, input.escort, input.rule, input.startDate);
  const id = newId('req');
  db.insert(schema.rideRequests)
    .values({ id, familyId, requestedBy: userId, ...input, priceRub: q.perTrip })
    .run();
  const family = db.select().from(schema.families).where(eq(schema.families.id, familyId)).get();
  const dispatchers = db.select().from(schema.users).all().filter((u) => u.roles.includes('dispatcher'));
  void notifyUsers(
    dispatchers.map((d) => d.id),
    'admin_request',
    {
      title: `Новая заявка: ${kids.map((k) => k.firstName).join(', ')}`,
      body: `${family?.name ?? ''} · ${input.time}, ${describeRule(parseRule(input.rule))}, с ${formatDateRu(input.startDate)}`,
      priority: 'important',
      url: '/admin',
    },
  );
  publish(channel.dispatch, 'rides', { request: id });
  return { id, quote: q };
}

export function listRequests(familyIds?: string[]) {
  const rows = familyIds
    ? familyIds.length
      ? db.select().from(schema.rideRequests).where(inArray(schema.rideRequests.familyId, familyIds)).orderBy(desc(schema.rideRequests.createdAt)).all()
      : []
    : db.select().from(schema.rideRequests).orderBy(desc(schema.rideRequests.createdAt)).all();
  const placeIds = [...new Set(rows.flatMap((r) => [r.fromPlaceId, r.toPlaceId]).filter(Boolean))] as string[];
  const places = new Map(placeIds.length ? db.select().from(schema.places).where(inArray(schema.places.id, placeIds)).all().map((p) => [p.id, p.name]) : []);
  const kids = new Map(db.select().from(schema.children).all().map((c) => [c.id, c.firstName]));
  const fams = new Map(db.select().from(schema.families).all().map((f) => [f.id, f.name]));
  return rows.map((r) => ({
    ...r,
    familyName: fams.get(r.familyId) ?? '',
    children: r.childIds.map((id) => kids.get(id) ?? '?'),
    from: r.fromPlaceId ? (places.get(r.fromPlaceId) ?? '?') : r.fromAddress,
    to: r.toPlaceId ? (places.get(r.toPlaceId) ?? '?') : r.toAddress,
    ruleText: describeRule(parseRule(r.rule)),
  }));
}

async function placeFor(familyId: string, placeId: string | null, address: string | null): Promise<string> {
  if (placeId) {
    requireFamilyPlace(familyId, placeId);
    return placeId;
  }
  const found = (await geocode(`${address}, Санкт-Петербург`))[0] ?? (await geocode(address ?? ''))[0];
  if (!found) throw new HttpError(400, `Не нашёл адрес «${address}». Добавьте место вручную и примите заявку ещё раз.`);
  const id = newId('pl');
  db.insert(schema.places).values({ id, familyId, name: address!.slice(0, 40), address: found.address, lat: found.lat, lon: found.lon }).run();
  return id;
}

export async function acceptRequest(id: string) {
  const r = db.select().from(schema.rideRequests).where(eq(schema.rideRequests.id, id)).get();
  if (!r) throw new HttpError(404, 'Заявка не найдена');
  if (r.status !== 'new') throw new HttpError(409, 'Заявка уже обработана');
  const fromPlaceId = await placeFor(r.familyId, r.fromPlaceId, r.fromAddress);
  const toPlaceId = await placeFor(r.familyId, r.toPlaceId, r.toAddress);
  for (const childId of r.childIds) requireNoDuplicateTemplate(childId, r.time, r.rule, r.startDate);
  r.childIds.forEach((childId, i) => {
    db.insert(schema.rideTemplates)
      .values({ id: newId('tpl'), familyId: r.familyId, childId, fromPlaceId, toPlaceId, time: r.time, rule: r.rule, startDate: r.startDate, escort: r.escort, priceRub: childPrice(i, r.escort) })
      .run();
  });
  db.update(schema.rideRequests).set({ status: 'accepted', fromPlaceId, toPlaceId }).where(eq(schema.rideRequests.id, id)).run();
  materialize();
  planDay(localDate());
  planDay(addDays(localDate(), 1));
  await notifyFamily(r.familyId, 'request', { title: 'Заявка принята', body: `Поездка ${r.time}, ${describeRule(parseRule(r.rule))} — уже в вашей неделе.`, priority: 'important' }, { url: '/app/week' });
  publish(channel.family(r.familyId), 'rides', { request: id });
  return { ok: true };
}

export async function declineRequest(id: string, answer: string) {
  const r = db.select().from(schema.rideRequests).where(eq(schema.rideRequests.id, id)).get();
  if (!r) throw new HttpError(404, 'Заявка не найдена');
  db.update(schema.rideRequests).set({ status: 'declined', answer }).where(eq(schema.rideRequests.id, id)).run();
  await notifyFamily(r.familyId, 'request', { title: 'Заявка не принята', body: answer, priority: 'important' }, { url: '/app/week' });
  publish(channel.family(r.familyId), 'rides', { request: id });
  return { ok: true };
}
