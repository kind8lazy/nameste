// Координаты водителя: из приложения (пока открыто) и из бесплатного Traccar Client (в фоне).
// По координатам: живая карта у родителя, геозоны («водитель на месте»), время прибытия и задержки.
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { publish, channel } from './realtime';
import { driveMinutes } from './geo';
import { recordRideEvents, broadcastRideChange, rideViews } from './rides';
import { notifyFamily } from './notify';
import { withinRadius } from '../../shared/geo';
import { atLocal, localDate, localTime } from '../../shared/time';
import { delayMessage } from '../../shared/messages';
import { isActive } from '../../shared/domain';
import type { Position } from '../../shared/api';

export interface PositionInput {
  lat: number;
  lon: number;
  at?: Date;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  battery?: number | null;
}

const last = new Map<string, Position>();
const etaCheckedAt = new Map<string, number>();
const delayNotified = new Set<string>();

export function forgetPosition(driverId: string) {
  last.delete(driverId);
  etaCheckedAt.clear();
  delayNotified.clear();
}

export function lastPosition(driverId: string): Position | null {
  if (last.has(driverId)) return last.get(driverId)!;
  const row = db
    .select()
    .from(schema.positions)
    .where(eq(schema.positions.driverId, driverId))
    .orderBy(desc(schema.positions.at))
    .limit(1)
    .get();
  return row ? { lat: row.lat, lon: row.lon, at: row.at.getTime(), heading: row.heading } : null;
}

export function driverByTrackerToken(token: string) {
  return db.select().from(schema.drivers).where(eq(schema.drivers.trackerToken, token)).get() ?? null;
}

export async function ingestPosition(driverId: string, p: PositionInput, source: 'app' | 'tracker') {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return;
  const at = p.at ?? new Date();
  db.insert(schema.positions)
    .values({ driverId, at, lat: p.lat, lon: p.lon, speed: p.speed, heading: p.heading, accuracy: p.accuracy, battery: p.battery, source })
    .run();
  const pos: Position = { lat: p.lat, lon: p.lon, at: at.getTime(), heading: p.heading ?? null };
  last.set(driverId, pos);

  const run = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.driverId, driverId), eq(schema.runs.date, localDate(at)), eq(schema.runs.status, 'active')))
    .get();
  publish(channel.dispatch, 'position', { driverId, runId: run?.id ?? null, ...pos });
  if (!run) return;

  // родителям — только пока их ребёнок в активной поездке этого рейса
  const rides = db.select().from(schema.rides).where(eq(schema.rides.runId, run.id)).all();
  const families = [...new Set(rides.filter((r) => isActive(r.status)).map((r) => r.familyId))];
  if (families.length) publish(families.map(channel.family), 'position', { runId: run.id, ...pos });

  const stops = db.select().from(schema.stops).where(eq(schema.stops.runId, run.id)).orderBy(asc(schema.stops.seq)).all();
  const next = stops.find((s) => !s.doneAt);
  if (!next) return;
  const place = db.select().from(schema.places).where(eq(schema.places.id, next.placeId)).get();
  if (!place) return;

  // геозона: водитель подъехал к следующей точке
  // забор — только после «Еду сюда»; высадка — сразу, дети уже в машине
  if (!next.arrivedAt && (next.departedAt || next.kind === 'dropoff') && withinRadius(pos, place, place.radiusM)) {
    await arriveAtStop(next.id, 'geofence', undefined, pos);
    return;
  }

  // время прибытия пересчитываем не чаще раза в минуту
  const lastCheck = etaCheckedAt.get(run.id) ?? 0;
  if (Date.now() - lastCheck < 60_000 || next.arrivedAt) return;
  etaCheckedAt.set(run.id, Date.now());
  const minutes = await driveMinutes(pos, place, at);
  const etaAt = new Date(at.getTime() + minutes * 60_000);
  db.update(schema.stops).set({ etaAt }).where(eq(schema.stops.id, next.id)).run();
  const affected = rides.filter((r) => r.pickupStopId === next.id || r.dropoffStopId === next.id);
  broadcastRideChange(affected);

  // задержка к забору больше 5 минут — предупреждаем семью один раз
  if (next.kind === 'pickup' && !delayNotified.has(next.id)) {
    const planned = atLocal(run.date, next.plannedAt);
    const lateMin = Math.round((etaAt.getTime() - planned.getTime()) / 60_000);
    if (lateMin >= 5) {
      delayNotified.add(next.id);
      const waiting = rideViews(affected.filter((r) => r.pickupStopId === next.id && r.status !== 'cancelled'));
      const byFamily = new Map<string, typeof waiting>();
      for (const v of waiting) byFamily.set(v.familyId, [...(byFamily.get(v.familyId) ?? []), v]);
      for (const [familyId, list] of byFamily) {
        await notifyFamily(
          familyId,
          'delay',
          delayMessage({ children: list.map((v) => v.child.firstName), time: localTime(), minutes: lateMin, eta: localTime(etaAt), driver: list[0].driver?.name }),
          { tag: `trip-${next.id}` },
        );
      }
    }
  }
}

/** Водитель выехал к точке забора: семьи получают «водитель выехал». */
export async function departToStop(stopId: string, actorUserId?: string) {
  const stop = db.select().from(schema.stops).where(eq(schema.stops.id, stopId)).get();
  if (!stop) return;
  const now = new Date();
  db.update(schema.stops).set({ departedAt: stop.departedAt ?? now }).where(eq(schema.stops.id, stopId)).run();
  db.update(schema.runs).set({ status: 'active', startedAt: now }).where(and(eq(schema.runs.id, stop.runId), eq(schema.runs.status, 'planned'))).run();
  if (stop.kind !== 'pickup') return broadcastStop(stop.runId);
  // первичная оценка прибытия, чтобы в уведомлении было время
  const place = db.select().from(schema.places).where(eq(schema.places.id, stop.placeId)).get();
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, stop.runId)).get();
  const pos = run ? lastPosition(run.driverId) : null;
  if (place && pos && Date.now() - pos.at < 10 * 60_000) {
    const minutes = await driveMinutes(pos, place);
    db.update(schema.stops).set({ etaAt: new Date(Date.now() + minutes * 60_000) }).where(eq(schema.stops.id, stopId)).run();
  }
  const rides = db.select().from(schema.rides).where(eq(schema.rides.pickupStopId, stopId)).all();
  await recordRideEvents({
    rideIds: rides.filter((r) => r.status === 'planned' || r.status === 'confirmed').map((r) => r.id),
    type: 'driver_departed',
    source: 'driver',
    actorUserId,
  });
  broadcastStop(stop.runId);
}

/** Водитель у точки: вручную или по геозоне. */
export async function arriveAtStop(stopId: string, source: 'driver' | 'geofence', actorUserId?: string, pos?: Position | null) {
  const stop = db.select().from(schema.stops).where(eq(schema.stops.id, stopId)).get();
  if (!stop || stop.arrivedAt) return;
  const now = new Date();
  db.update(schema.stops).set({ arrivedAt: now, departedAt: stop.departedAt ?? now }).where(eq(schema.stops.id, stopId)).run();
  db.update(schema.runs).set({ status: 'active', startedAt: now }).where(and(eq(schema.runs.id, stop.runId), eq(schema.runs.status, 'planned'))).run();
  if (stop.kind === 'pickup') {
    const rides = db.select().from(schema.rides).where(eq(schema.rides.pickupStopId, stopId)).all();
    await recordRideEvents({
      rideIds: rides.filter((r) => ['planned', 'confirmed', 'driver_en_route'].includes(r.status)).map((r) => r.id),
      type: 'arrived_pickup',
      source,
      actorUserId,
      lat: pos?.lat,
      lon: pos?.lon,
    });
  } else {
    const rides = db.select().from(schema.rides).where(eq(schema.rides.dropoffStopId, stopId)).all();
    await recordRideEvents({
      rideIds: rides.filter((r) => r.status === 'on_board').map((r) => r.id),
      type: 'arrived_dropoff',
      source,
      actorUserId,
      lat: pos?.lat,
      lon: pos?.lon,
    });
  }
  broadcastStop(stop.runId);
}

function broadcastStop(runId: string) {
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
  if (run) publish([channel.dispatch, channel.driver(run.driverId)], 'rides', { runId });
}

/** Геоданные храним 30 дней — для разбора спорных случаев, дольше не нужно. */
export function cleanupPositions() {
  db.delete(schema.positions).where(lt(schema.positions.at, new Date(Date.now() - 30 * 86_400_000))).run();
}

export function positionsForDrivers(driverIds: string[]): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const id of driverIds) {
    const p = lastPosition(id);
    if (p) out[id] = p;
  }
  return out;
}

