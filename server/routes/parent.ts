// Родитель: день, неделя, подтверждение и отмена.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { dateField, timeField, planDateField } from '../lib/validate';
import { requireRole, familyIdsOf, HttpError } from '../modules/auth';
import { rideViews, ridesForFamilies, getRide, recordRideEvents } from '../modules/rides';
import { lastPosition } from '../modules/tracking';
import { planDay } from '../modules/planner';
import { addDays, formatDayRu, localDate, weekStart } from '../../shared/time';
import { isActive } from '../../shared/domain';
import type { ParentDay, WeekDay, ChildView } from '../../shared/api';
import { createRequest, listRequests } from '../modules/requests';
import { geocode } from '../modules/geo';
import { placeInput, addFamilyPlace } from '../modules/places';
import { quote } from '../../shared/pricing';

const dateSchema = dateField;

function parentFamilies(req: FastifyRequest) {
  const u = requireRole(req, 'parent', 'dispatcher');
  return { user: u, familyIds: familyIdsOf(u.id) };
}

/** В простом режиме родитель не получает ни цены, ни данных о водителе и машине, ни времени прибытия. */
function liteRides<T extends { priceRub: number; driver: unknown; eta: string | null }>(rides: T[]): T[] {
  return config.liteMode ? rides.map((r) => ({ ...r, priceRub: 0, driver: null, eta: null })) : rides;
}

function ownRide(req: FastifyRequest, id: string) {
  const { user, familyIds } = parentFamilies(req);
  const ride = getRide(id);
  if (!familyIds.includes(ride.familyId)) throw new HttpError(403, 'Это не ваша поездка');
  requireEditor(user.id, ride.familyId);
  return { user, ride };
}

function canEditFamily(userId: string, familyId: string): boolean {
  const m = db
    .select()
    .from(schema.familyMembers)
    .where(and(eq(schema.familyMembers.userId, userId), eq(schema.familyMembers.familyId, familyId)))
    .get();
  return !!m && (m.isOwner || m.canEdit);
}

const geoHits = new Map<string, number[]>();
/** Поиск адреса: не больше 20 запросов в минуту от одного человека (бесплатный сервис карт просит не частить). */
function geoTooFast(userId: string): boolean {
  const now = Date.now();
  const recent = (geoHits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  geoHits.set(userId, recent);
  return recent.length > 20;
}

/** Отменять, подтверждать и заказывать может владелец семьи или тот, кому он разрешил. */
function requireEditor(userId: string, familyId: string) {
  if (!canEditFamily(userId, familyId)) throw new HttpError(403, 'Менять поездки может только владелец семьи. Попросите его или диспетчера.');
}

export async function parentRoutes(app: FastifyInstance) {
  app.get('/parent/day', async (req): Promise<ParentDay> => {
    const { familyIds } = parentFamilies(req);
    const { date = localDate() } = z.object({ date: dateSchema.optional() }).parse(req.query);
    const rides = liteRides(rideViews(ridesForFamilies(familyIds, date, date)));
    const kids = familyIds.length
      ? db.select().from(schema.children).where(inArray(schema.children.familyId, familyIds)).all()
      : [];
    const children: ChildView[] = kids.map((c) => rides.find((r) => r.child.id === c.id)?.child ?? {
      id: c.id,
      firstName: c.firstName,
      grade: c.grade,
      photoUrl: c.photoUrl,
      color: c.color ?? '#5D7F8E',
      seat: c.seat,
      notes: c.notes,
      handoverTo: c.handoverTo,
    });
    const active = rides.find((r) => isActive(r.status) && r.runId);
    let live: ParentDay['live'] = null;
    if (active?.runId && !config.liteMode) {
      const run = db.select().from(schema.runs).where(eq(schema.runs.id, active.runId)).get();
      live = { runId: active.runId, position: run ? lastPosition(run.driverId) : null };
    }
    return { date, dayLabel: formatDayRu(date), children, rides, live };
  });

  app.get('/parent/week', async (req): Promise<WeekDay[]> => {
    const { familyIds } = parentFamilies(req);
    const { date = localDate() } = z.object({ date: dateSchema.optional() }).parse(req.query);
    const from = weekStart(date);
    const to = addDays(from, 6);
    const rides = liteRides(rideViews(ridesForFamilies(familyIds, from, to)));
    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      days.push({ date: d, dayLabel: formatDayRu(d), rides: rides.filter((r) => r.date === d) });
    }
    return days;
  });

  app.post('/parent/rides/:id/confirm', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { user, ride } = ownRide(req, id);
    if (ride.status !== 'planned') return { ok: true };
    await recordRideEvents({ rideIds: [id], type: 'confirmed', source: 'parent', actorUserId: user.id });
    return { ok: true };
  });

  app.post('/parent/rides/:id/cancel', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
    const { user, ride } = ownRide(req, id);
    await recordRideEvents({ rideIds: [id], type: 'cancelled', source: 'parent', actorUserId: user.id, reason: reason ?? 'Отменил родитель' });
    planDay(ride.date); // пересобрать рейс, если он ещё не начат
    return { ok: true };
  });

  /** «Всё в силе» — подтвердить все поездки семьи на день одной кнопкой. */
  app.post('/parent/days/:date/confirm', async (req) => {
    const { date } = z.object({ date: dateSchema }).parse(req.params);
    const { user, familyIds } = parentFamilies(req);
    if (!familyIds.length) return { ok: true, confirmed: 0 };
    familyIds.forEach((f) => requireEditor(user.id, f));
    const rides = db
      .select()
      .from(schema.rides)
      .where(and(inArray(schema.rides.familyId, familyIds), eq(schema.rides.date, date), eq(schema.rides.status, 'planned')))
      .all();
    const res = await recordRideEvents({ rideIds: rides.map((r) => r.id), type: 'confirmed', source: 'parent', actorUserId: user.id });
    return { ok: true, confirmed: res.applied.length };
  });

  /** Места, из которых родитель выбирает «откуда» и «куда»: свои и общие (школы, секции). */
  app.get('/parent/places', async (req) => {
    const { familyIds } = parentFamilies(req);
    return db
      .select({ id: schema.places.id, name: schema.places.name, address: schema.places.address, familyId: schema.places.familyId })
      .from(schema.places)
      .where(inArray(schema.places.familyId, familyIds.length ? familyIds : ['-']))
      .all();
  });

  /** Клиент добавляет место в своём профиле. Менять места может владелец семьи или тот, кому он разрешил. */
  app.post('/parent/places', async (req) => {
    const { user, familyIds } = parentFamilies(req);
    if (!familyIds.length) throw new HttpError(400, 'Вы пока не привязаны к семье');
    const familyId = familyIds.find((f) => canEditFamily(user.id, f));
    if (!familyId) throw new HttpError(403, 'Добавлять места может только владелец семьи. Попросите его или диспетчера.');
    const p = placeInput.parse(req.body);
    return { id: addFamilyPlace(familyId, p) };
  });

  app.get('/parent/geocode', async (req) => {
    const { user } = parentFamilies(req);
    const { q } = z.object({ q: z.string().trim().min(3).max(120) }).parse(req.query);
    if (geoTooFast(user.id)) throw new HttpError(429, 'Слишком часто. Подождите минуту.');
    return geocode(q);
  });

  app.post('/parent/quote', async (req) => {
    const b = z.object({ children: z.number().int().min(1).max(6), escort: z.enum(['to_door', 'to_entrance']), rule: z.string(), startDate: dateSchema }).parse(req.body);
    return quote(b.children, b.escort, b.rule, b.startDate);
  });

  app.get('/parent/requests', async (req) => {
    const rows = listRequests(parentFamilies(req).familyIds);
    return config.liteMode ? rows.map((r) => ({ ...r, priceRub: 0 })) : rows;
  });

  app.post('/parent/requests', async (req) => {
    const { user, familyIds } = parentFamilies(req);
    if (!familyIds.length) throw new HttpError(400, 'Вы пока не привязаны к семье');
    requireEditor(user.id, familyIds[0]);
    const b = z
      .object({
        childIds: z.array(z.string()).min(1).max(10).transform((a) => [...new Set(a)]),
        fromPlaceId: z.string().nullish(),
        fromAddress: z.string().max(200).nullish(),
        toPlaceId: z.string().nullish(),
        toAddress: z.string().max(200).nullish(),
        time: timeField,
        rule: z.string(),
        startDate: planDateField,
        escort: z.enum(['to_door', 'to_entrance']).default('to_door'),
        comment: z.string().max(500).nullish(),
      })
      .parse(req.body);
    return createRequest(familyIds[0], user.id, b);
  });
}
