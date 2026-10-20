// Планировщик дня: из поездок детей собирает рейс машины — упорядоченные точки забора и высадки.
// Простое жадное правило: до следующего забора развозим тех, кого успеваем, ближайших первыми.
// Для 1–2 машин этого достаточно; оптимизацию сцепок (VRP) добавим на этапе масштаба.
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { estimateDriveMin, type LatLon } from '../../shared/geo';
import { hhmmOf, minutesOf } from '../../shared/time';
import type { Escort } from '../../shared/domain';

export interface PlanRide {
  id: string;
  pickupTime: string;
  escort: Escort;
  from: LatLon & { id: string };
  to: LatLon & { id: string };
}

export interface PlannedStop {
  kind: 'pickup' | 'dropoff';
  placeId: string;
  plannedAt: string;
  rideIds: string[];
  /** на сколько минут машина не успевает к этому забору */
  lateMin?: number;
}

const BOARDING_MIN = 3;
const handoverMin = (e: Escort) => (e === 'to_door' ? 5 : 2);

export function planStops(rides: PlanRide[], travel: (a: LatLon, b: LatLon) => number = estimateDriveMin): PlannedStop[] {
  const groups = new Map<string, PlanRide[]>();
  for (const r of [...rides].sort((a, b) => a.pickupTime.localeCompare(b.pickupTime))) {
    const k = `${r.pickupTime}|${r.from.id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: PlannedStop[] = [];
  let clock: number | null = null;
  let loc: LatLon | null = null;
  let onboard: PlanRide[] = [];

  const deliverNearest = (limitAt?: { at: number; place: LatLon }): boolean => {
    if (!onboard.length || clock === null || !loc) return false;
    const here = loc;
    const next = onboard.reduce((best, r) => (travel(here, r.to) < travel(here, best.to) ? r : best));
    const arrive: number = clock + travel(here, next.to);
    const sameDest = onboard.filter((r) => r.to.id === next.to.id);
    const busy = Math.max(...sameDest.map((r) => handoverMin(r.escort)));
    if (limitAt && arrive + busy + travel(next.to, limitAt.place) > limitAt.at + 5) return false;
    const last = out[out.length - 1];
    if (last && last.kind === 'dropoff' && last.placeId === next.to.id) last.rideIds.push(...sameDest.map((r) => r.id));
    else out.push({ kind: 'dropoff', placeId: next.to.id, plannedAt: hhmmOf(arrive), rideIds: sameDest.map((r) => r.id) });
    clock = arrive + busy;
    loc = next.to;
    onboard = onboard.filter((r) => r.to.id !== next.to.id);
    return true;
  };

  for (const group of groups.values()) {
    const at = minutesOf(group[0].pickupTime);
    const place = group[0].from;
    while (deliverNearest({ at, place }));
    let arrival = at;
    if (clock !== null && loc) arrival = Math.max(clock + travel(loc, place), at);
    const stop: PlannedStop = { kind: 'pickup', placeId: place.id, plannedAt: group[0].pickupTime, rideIds: group.map((r) => r.id) };
    if (arrival > at) stop.lateMin = arrival - at;
    out.push(stop);
    clock = Math.max(arrival, at) + BOARDING_MIN;
    loc = place;
    onboard.push(...group);
  }
  while (deliverNearest());
  return out;
}

/** Пересобрать рейс на дату, пока он не начат. Возвращает id рейса и конфликты по времени. */
export function planDay(date: string): { runId: string | null; late: { placeId: string; plannedAt: string; lateMin: number }[] } {
  const existing = db.select().from(schema.runs).where(eq(schema.runs.date, date)).all();
  const started = existing.find((r) => r.status !== 'planned');
  if (started) return appendToStartedRun(started.id, date);

  const rides = db
    .select()
    .from(schema.rides)
    .where(and(eq(schema.rides.date, date), ne(schema.rides.status, 'cancelled')))
    .all();
  const driver = db.select().from(schema.drivers).all()[0];
  if (!driver) return { runId: null, late: [] };

  // старые точки и привязки убираем — план собирается заново
  if (existing.length) {
    db.update(schema.rides)
      .set({ runId: null, pickupStopId: null, dropoffStopId: null })
      .where(inArray(schema.rides.runId, existing.map((r) => r.id)))
      .run();
    db.delete(schema.runs).where(inArray(schema.runs.id, existing.map((r) => r.id))).run();
  }
  if (!rides.length) return { runId: null, late: [] };

  const placeIds = [...new Set(rides.flatMap((r) => [r.fromPlaceId, r.toPlaceId]))];
  const places = new Map(db.select().from(schema.places).where(inArray(schema.places.id, placeIds)).all().map((p) => [p.id, p]));
  const plan = planStops(
    rides.map((r) => ({
      id: r.id,
      pickupTime: r.pickupTime,
      escort: r.escort,
      from: { id: r.fromPlaceId, lat: places.get(r.fromPlaceId)!.lat, lon: places.get(r.fromPlaceId)!.lon },
      to: { id: r.toPlaceId, lat: places.get(r.toPlaceId)!.lat, lon: places.get(r.toPlaceId)!.lon },
    })),
  );

  const runId = newId('run');
  db.transaction((tx) => {
    tx.insert(schema.runs).values({ id: runId, date, driverId: driver.userId, vehicleId: driver.vehicleId }).run();
    plan.forEach((s, i) => {
      const stopId = newId('st');
      tx.insert(schema.stops).values({ id: stopId, runId, seq: i + 1, placeId: s.placeId, kind: s.kind, plannedAt: s.plannedAt }).run();
      tx.update(schema.rides)
        .set(s.kind === 'pickup' ? { runId, pickupStopId: stopId } : { runId, dropoffStopId: stopId })
        .where(inArray(schema.rides.id, s.rideIds))
        .run();
    });
  });
  return {
    runId,
    late: plan.filter((s) => s.lateMin).map((s) => ({ placeId: s.placeId, plannedAt: s.plannedAt, lateMin: s.lateMin! })),
  };
}

/**
 * Рейс уже идёт: новые поездки дня вставляем в него, не трогая пройденные точки.
 * Точки, которые ещё впереди, переупорядочиваем по плановому времени.
 */
function appendToStartedRun(runId: string, date: string) {
  const fresh = db
    .select()
    .from(schema.rides)
    .where(and(eq(schema.rides.date, date), isNull(schema.rides.runId), ne(schema.rides.status, 'cancelled')))
    .all();
  if (!fresh.length) return { runId, late: [] as { placeId: string; plannedAt: string; lateMin: number }[] };
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()!;
  if (run.status === 'done') db.update(schema.runs).set({ status: 'active', finishedAt: null }).where(eq(schema.runs.id, runId)).run();
  const placeIds = [...new Set(fresh.flatMap((r) => [r.fromPlaceId, r.toPlaceId]))];
  const places = new Map(db.select().from(schema.places).where(inArray(schema.places.id, placeIds)).all().map((p) => [p.id, p]));
  const late: { placeId: string; plannedAt: string; lateMin: number }[] = [];
  db.transaction((tx) => {
    for (const r of fresh) {
      const from = places.get(r.fromPlaceId)!;
      const to = places.get(r.toPlaceId)!;
      const pickupId = newId('st');
      const dropId = newId('st');
      const dropAt = hhmmOf(minutesOf(r.pickupTime) + BOARDING_MIN + estimateDriveMin(from, to));
      tx.insert(schema.stops).values({ id: pickupId, runId, seq: 0, placeId: r.fromPlaceId, kind: 'pickup', plannedAt: r.pickupTime }).run();
      tx.insert(schema.stops).values({ id: dropId, runId, seq: 0, placeId: r.toPlaceId, kind: 'dropoff', plannedAt: dropAt }).run();
      tx.update(schema.rides).set({ runId, pickupStopId: pickupId, dropoffStopId: dropId }).where(eq(schema.rides.id, r.id)).run();
    }
    const all = tx.select().from(schema.stops).where(eq(schema.stops.runId, runId)).all();
    const done = all.filter((s) => s.doneAt).sort((a, b) => a.seq - b.seq);
    const ahead = all.filter((s) => !s.doneAt).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt) || (a.kind === 'pickup' ? -1 : 1));
    [...done, ...ahead].forEach((s, i) => tx.update(schema.stops).set({ seq: i + 1 }).where(eq(schema.stops.id, s.id)).run());
    // успевает ли машина: от каждой точки до следующей по плану
    for (let i = 1; i < ahead.length; i++) {
      const a = ahead[i - 1];
      const b = ahead[i];
      const pa = tx.select().from(schema.places).where(eq(schema.places.id, a.placeId)).get()!;
      const pb = tx.select().from(schema.places).where(eq(schema.places.id, b.placeId)).get()!;
      const ready = minutesOf(a.plannedAt) + (a.kind === 'pickup' ? BOARDING_MIN : 5) + estimateDriveMin(pa, pb);
      if (b.kind === 'pickup' && ready > minutesOf(b.plannedAt)) late.push({ placeId: b.placeId, plannedAt: b.plannedAt, lateMin: ready - minutesOf(b.plannedAt) });
    }
  });
  return { runId, late };
}
