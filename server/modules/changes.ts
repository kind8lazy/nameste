// Просьбы родителей изменить план: отменить поездку, перенести время забора, «ребёнка не будет».
// Родитель только просит — применяет диспетчер, потому что только он знает, что могут водители.
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { HttpError } from './auth';
import { getRide, recordRideEvents } from './rides';
import { planDay } from './planner';
import { notifyFamily, notifyUsers } from './notify';
import { publish, channel } from './realtime';
import { addDays, formatDateRu, formatDayRu, localDate } from '../../shared/time';
import type { RideStatus } from '../../shared/domain';

type Change = typeof schema.changeRequests.$inferSelect;

/** Поездки, которые ещё можно менять: водитель к ребёнку не выехал. */
const CHANGEABLE: RideStatus[] = ['planned', 'confirmed'];
/** «Ребёнка не будет» — на две недели вперёд, столько поездок уже есть в расписании. */
export const ABSENCE_DAYS = 14;
export const ABSENCE_REASONS = ['Болезнь', 'Семейные обстоятельства', 'Отпуск', 'Сборы'];

export type ChangeInput =
  | { kind: 'cancel'; rideId: string; reason?: string }
  | { kind: 'time'; rideId: string; time: string; reason?: string }
  | { kind: 'absence'; childId: string; dateFrom: string; dateTo: string; reason: string };

export function createChange(familyId: string, userId: string, input: ChangeInput) {
  let childId: string;
  let rideId: string | null = null;
  let dateFrom: string;
  let dateTo: string;
  const today = localDate();
  if (input.kind === 'absence') {
    const kid = db.select().from(schema.children).where(eq(schema.children.id, input.childId)).get();
    if (!kid || kid.familyId !== familyId) throw new HttpError(400, 'Выберите ребёнка из своей семьи');
    if (input.dateFrom < today) throw new HttpError(400, 'Дата уже прошла');
    if (input.dateTo < input.dateFrom) throw new HttpError(400, 'Дата «по» раньше даты «с»');
    if (input.dateTo > addDays(today, ABSENCE_DAYS - 1)) throw new HttpError(400, `Отметить можно не дальше ${ABSENCE_DAYS} дней вперёд`);
    childId = kid.id;
    dateFrom = input.dateFrom;
    dateTo = input.dateTo;
  } else {
    const ride = getRide(input.rideId);
    if (ride.familyId !== familyId) throw new HttpError(403, 'Это не ваша поездка');
    if (!CHANGEABLE.includes(ride.status)) throw new HttpError(409, 'Водитель уже в пути — позвоните или напишите диспетчеру');
    if (input.kind === 'time' && input.time === ride.pickupTime) throw new HttpError(400, 'Это то же самое время');
    const pending = db
      .select()
      .from(schema.changeRequests)
      .where(and(eq(schema.changeRequests.rideId, ride.id), eq(schema.changeRequests.status, 'new')))
      .get();
    if (pending) throw new HttpError(409, 'По этой поездке уже есть просьба, она ждёт ответа диспетчера');
    childId = ride.childId;
    rideId = ride.id;
    dateFrom = dateTo = ride.date;
  }

  const id = newId('chg');
  db.insert(schema.changeRequests)
    .values({ id, familyId, requestedBy: userId, kind: input.kind, childId, rideId, dateFrom, dateTo, time: input.kind === 'time' ? input.time : null, reason: input.reason?.trim() || null })
    .run();
  const view = changeViews([db.select().from(schema.changeRequests).where(eq(schema.changeRequests.id, id)).get()!])[0];
  const dispatchers = db.select().from(schema.users).all().filter((u) => u.roles.includes('dispatcher'));
  void notifyUsers(
    dispatchers.map((d) => d.id),
    'admin_request',
    { title: `Просьба: ${view.title}`, body: `${view.familyName} · ${view.summary}`, priority: 'important', url: '/admin#requests' },
  );
  publish(channel.dispatch, 'rides', { change: id });
  publish(channel.family(familyId), 'rides', { change: id });
  return view;
}

export function changeViews(rows: Change[]) {
  if (!rows.length) return [];
  const kids = new Map(db.select().from(schema.children).all().map((c) => [c.id, c.firstName]));
  const fams = new Map(db.select().from(schema.families).all().map((f) => [f.id, f.name]));
  const rideIds = rows.map((r) => r.rideId).filter(Boolean) as string[];
  const rides = new Map(rideIds.length ? db.select().from(schema.rides).where(inArray(schema.rides.id, rideIds)).all().map((r) => [r.id, r]) : []);
  const placeIds = [...rides.values()].flatMap((r) => [r.fromPlaceId, r.toPlaceId]);
  const places = new Map(placeIds.length ? db.select().from(schema.places).where(inArray(schema.places.id, placeIds)).all().map((p) => [p.id, p.name]) : []);
  return rows.map((c) => {
    const child = kids.get(c.childId) ?? '?';
    const ride = c.rideId ? rides.get(c.rideId) : undefined;
    const route = ride ? `${places.get(ride.fromPlaceId) ?? '?'} → ${places.get(ride.toPlaceId) ?? '?'}` : '';
    const day = formatDayRu(c.dateFrom);
    const title = c.kind === 'cancel' ? `отменить поездку ${child}` : c.kind === 'time' ? `перенести время ${child}` : `${child} не будет`;
    const summary =
      c.kind === 'absence'
        ? c.dateFrom === c.dateTo
          ? `${day}`
          : `с ${formatDateRu(c.dateFrom)} по ${formatDateRu(c.dateTo)}`
        : c.kind === 'cancel'
          ? `${day}, ${ride?.pickupTime ?? ''} ${route}`
          : `${day}, ${route}: ${ride?.pickupTime ?? '?'} → ${c.time}`;
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      familyId: c.familyId,
      familyName: fams.get(c.familyId) ?? '',
      childName: child,
      rideId: c.rideId,
      dateFrom: c.dateFrom,
      dateTo: c.dateTo,
      time: c.time,
      currentTime: ride?.pickupTime ?? null,
      reason: c.reason,
      answer: c.answer,
      title,
      summary,
      createdAt: c.createdAt,
    };
  });
}

export function listChanges(familyIds?: string[]) {
  const q = db.select().from(schema.changeRequests);
  const rows = familyIds
    ? familyIds.length
      ? q.where(inArray(schema.changeRequests.familyId, familyIds)).orderBy(desc(schema.changeRequests.createdAt)).limit(50).all()
      : []
    : q.orderBy(desc(schema.changeRequests.createdAt)).limit(100).all();
  return changeViews(rows);
}

/** Какие поездки ждут ответа диспетчера — чтобы родитель видел это на поездке. */
export function pendingByRide(rideIds: string[]): Map<string, { kind: 'cancel' | 'time'; time: string | null }> {
  if (!rideIds.length) return new Map();
  return new Map(
    db
      .select()
      .from(schema.changeRequests)
      .where(and(inArray(schema.changeRequests.rideId, rideIds), eq(schema.changeRequests.status, 'new')))
      .all()
      .map((c) => [c.rideId!, { kind: c.kind as 'cancel' | 'time', time: c.time }]),
  );
}

function openChange(id: string): Change {
  const c = db.select().from(schema.changeRequests).where(eq(schema.changeRequests.id, id)).get();
  if (!c) throw new HttpError(404, 'Просьба не найдена');
  if (c.status !== 'new') throw new HttpError(409, 'Просьба уже обработана');
  return c;
}

/** Принять. Для переноса диспетчер может поставить своё время («могу в 16:40»). */
export async function acceptChange(id: string, actorUserId: string, adjustedTime?: string) {
  const c = openChange(id);
  const child = db.select().from(schema.children).where(eq(schema.children.id, c.childId)).get()?.firstName ?? '';
  let body: string;
  if (c.kind === 'absence') {
    const rides = db
      .select()
      .from(schema.rides)
      .where(and(eq(schema.rides.childId, c.childId), gte(schema.rides.date, c.dateFrom), lte(schema.rides.date, c.dateTo), inArray(schema.rides.status, CHANGEABLE)))
      .all();
    await recordRideEvents({ rideIds: rides.map((r) => r.id), type: 'cancelled', source: 'dispatcher', actorUserId, reason: c.reason ?? 'Ребёнка не будет' });
    for (const d of new Set(rides.map((r) => r.date))) planDay(d);
    body = `${child}: поездки ${c.dateFrom === c.dateTo ? formatDayRu(c.dateFrom) : `с ${formatDateRu(c.dateFrom)} по ${formatDateRu(c.dateTo)}`} отменены.`;
  } else {
    const ride = getRide(c.rideId!);
    if (!CHANGEABLE.includes(ride.status)) throw new HttpError(409, 'Поездка уже началась или отменена — просьбу можно только отклонить');
    if (c.kind === 'cancel') {
      await recordRideEvents({ rideIds: [ride.id], type: 'cancelled', source: 'dispatcher', actorUserId, reason: c.reason ?? 'По просьбе родителя' });
      body = `${child}, ${formatDayRu(ride.date)} ${ride.pickupTime}: поездка отменена.`;
    } else {
      const time = adjustedTime ?? c.time!;
      db.update(schema.rides).set({ pickupTime: time, updatedAt: new Date() }).where(eq(schema.rides.id, ride.id)).run();
      if (time !== c.time) db.update(schema.changeRequests).set({ time }).where(eq(schema.changeRequests.id, id)).run();
      body = time === c.time ? `${child}, ${formatDayRu(ride.date)}: заберём в ${time}.` : `${child}, ${formatDayRu(ride.date)}: в ${c.time} не получается, заберём в ${time}.`;
    }
    planDay(ride.date);
  }
  db.update(schema.changeRequests)
    .set({ status: 'accepted', decidedAt: new Date(), answer: adjustedTime && adjustedTime !== c.time ? `Время изменено на ${adjustedTime}` : null })
    .where(eq(schema.changeRequests.id, id))
    .run();
  await notifyFamily(c.familyId, 'request', { title: 'Диспетчер подтвердил', body, priority: 'important' }, { url: '/app/week' });
  publish(channel.family(c.familyId), 'rides', { change: id });
  publish(channel.dispatch, 'rides', { change: id });
  return { ok: true };
}

export async function declineChange(id: string, answer: string) {
  const c = openChange(id);
  db.update(schema.changeRequests).set({ status: 'declined', answer, decidedAt: new Date() }).where(eq(schema.changeRequests.id, id)).run();
  await notifyFamily(c.familyId, 'request', { title: 'Диспетчер не смог изменить', body: `${answer} Поездка остаётся по плану.`, priority: 'important' }, { url: '/app/week' });
  publish(channel.family(c.familyId), 'rides', { change: id });
  publish(channel.dispatch, 'rides', { change: id });
  return { ok: true };
}

/** Родитель передумал, пока диспетчер не ответил. */
export function withdrawChange(id: string, familyIds: string[]) {
  const c = openChange(id);
  if (!familyIds.includes(c.familyId)) throw new HttpError(403, 'Это не ваша просьба');
  db.update(schema.changeRequests).set({ status: 'withdrawn', decidedAt: new Date() }).where(eq(schema.changeRequests.id, id)).run();
  publish(channel.dispatch, 'rides', { change: id });
  return { ok: true };
}
