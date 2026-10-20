// Экраны водителя и диспетчера: рейс по точкам с детьми на каждой точке.
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { rideViews, placeView } from './rides';
import { positionsForDrivers } from './tracking';
import { distanceM } from '../../shared/geo';
import { formatDayRu, localTime } from '../../shared/time';
import type { AdminDay, ShiftView, StopView } from '../../shared/api';

const hhmm = (d: Date | null) => (d ? localTime(d) : null);

function stopViews(runId: string): StopView[] {
  const stops = db.select().from(schema.stops).where(eq(schema.stops.runId, runId)).orderBy(asc(schema.stops.seq)).all();
  if (!stops.length) return [];
  const rides = db.select().from(schema.rides).where(eq(schema.rides.runId, runId)).all();
  const views = new Map(rideViews(rides).map((v) => [v.id, v]));
  const familyIds = [...new Set(rides.map((r) => r.familyId))];
  const owners = new Map<string, { name: string; phone: string | null }>();
  if (familyIds.length) {
    const rows = db
      .select({ m: schema.familyMembers, u: schema.users })
      .from(schema.familyMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
      .where(and(inArray(schema.familyMembers.familyId, familyIds), eq(schema.familyMembers.isOwner, true)))
      .all();
    for (const r of rows) owners.set(r.m.familyId, { name: r.u.name, phone: r.u.phone });
  }
  const places = new Map(
    db.select().from(schema.places).where(inArray(schema.places.id, [...new Set(stops.map((s) => s.placeId))])).all().map((p) => [p.id, placeView(p)]),
  );
  return stops.map((s) => ({
    id: s.id,
    seq: s.seq,
    kind: s.kind,
    plannedAt: s.plannedAt,
    place: places.get(s.placeId)!,
    departedAt: hhmm(s.departedAt),
    arrivedAt: hhmm(s.arrivedAt),
    doneAt: hhmm(s.doneAt),
    eta: hhmm(s.etaAt),
    rides: rides
      .filter((r) => (s.kind === 'pickup' ? r.pickupStopId === s.id : r.dropoffStopId === s.id))
      .map((r) => ({ ...views.get(r.id)!, parentName: owners.get(r.familyId)?.name ?? null, parentPhone: owners.get(r.familyId)?.phone ?? null })),
  }));
}

export function shiftView(driverId: string, date: string): ShiftView {
  const run = db.select().from(schema.runs).where(and(eq(schema.runs.driverId, driverId), eq(schema.runs.date, date))).get();
  const driver = db.select().from(schema.drivers).where(eq(schema.drivers.userId, driverId)).get();
  const vehicle = run?.vehicleId ? db.select().from(schema.vehicles).where(eq(schema.vehicles.id, run.vehicleId)).get() : null;
  return {
    date,
    dayLabel: formatDayRu(date),
    run: run ? { id: run.id, status: run.status, vehicle: vehicle?.title ?? null, plate: vehicle?.plate ?? null } : null,
    stops: run ? stopViews(run.id) : [],
    trackerHint: driver ? { url: `${config.publicUrl}/api/osmand`, deviceId: driver.trackerToken } : null,
  };
}

export function adminDayView(date: string): AdminDay {
  const runs = db.select().from(schema.runs).where(eq(schema.runs.date, date)).all();
  const users = new Map(db.select().from(schema.users).all().map((u) => [u.id, u]));
  const vehicles = new Map(db.select().from(schema.vehicles).all().map((v) => [v.id, v]));
  const runViews = runs.map((r) => ({
    id: r.id,
    status: r.status,
    vehicle: r.vehicleId ? (vehicles.get(r.vehicleId)?.title ?? null) : null,
    plate: r.vehicleId ? (vehicles.get(r.vehicleId)?.plate ?? null) : null,
    driverName: users.get(r.driverId)?.name ?? '—',
    stops: stopViews(r.id),
  }));
  const unassigned = rideViews(
    db
      .select()
      .from(schema.rides)
      .where(and(eq(schema.rides.date, date), isNull(schema.rides.runId), ne(schema.rides.status, 'cancelled')))
      .all(),
  );
  const all = db.select().from(schema.rides).where(and(eq(schema.rides.date, date), ne(schema.rides.status, 'cancelled'))).all();
  const places = new Map(db.select().from(schema.places).all().map((p) => [p.id, p]));
  const km = (a?: { lat: number; lon: number }, b?: { lat: number; lon: number }) => (a && b ? (distanceM(a, b) * 1.4) / 1000 : 0);
  const paidKm = all.reduce((s, r) => s + km(places.get(r.fromPlaceId), places.get(r.toPlaceId)), 0);
  let totalKm = 0;
  for (const rv of runViews) {
    for (let i = 1; i < rv.stops.length; i++) totalKm += km(rv.stops[i - 1].place, rv.stops[i].place);
  }
  return {
    date,
    dayLabel: formatDayRu(date),
    runs: runViews,
    unassigned,
    positions: positionsForDrivers([...new Set(runs.map((r) => r.driverId))]),
    stats: {
      rides: all.length,
      children: new Set(all.map((r) => r.childId)).size,
      revenueRub: all.reduce((s, r) => s + r.priceRub, 0),
      paidKm: Math.round(paidKm * 10) / 10,
      emptyKm: Math.max(0, Math.round((totalKm - paidKm) * 10) / 10),
    },
  };
}
