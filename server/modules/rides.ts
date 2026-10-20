// Поездки: чтение для экранов и запись событий по правилам из shared/domain.ts.
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { HttpError } from './auth';
import { publish, channel } from './realtime';
import { notifyFamily, notifyUsers } from './notify';
import {
  applyEvent,
  parentStep,
  statusTone,
  STATUS_LABELS,
  type RideEventType,
  type EventSource,
} from '../../shared/domain';
import { eventMessage, smsText, type MessageContext } from '../../shared/messages';
import { smsFamily } from './sms';
import { emailFamily } from './mail';
import { localTime } from '../../shared/time';
import type { ChildView, DriverView, PlaceView, RideView } from '../../shared/api';

type RideRow = typeof schema.rides.$inferSelect;

const AVATAR_COLORS = ['#B97A5B', '#5D7F8E', '#7C8F5E', '#8E6A9B', '#B08D4A', '#5F8A7A'];

function childView(c: typeof schema.children.$inferSelect, i = 0): ChildView {
  return {
    id: c.id,
    firstName: c.firstName,
    grade: c.grade,
    photoUrl: c.photoUrl,
    color: c.color ?? AVATAR_COLORS[i % AVATAR_COLORS.length],
    seat: c.seat,
    notes: c.notes,
    handoverTo: c.handoverTo,
  };
}

export function placeView(p: typeof schema.places.$inferSelect): PlaceView {
  return { id: p.id, name: p.name, address: p.address, lat: p.lat, lon: p.lon, entranceNote: p.entranceNote, contactPhone: p.contactPhone };
}

const hhmm = (d: Date | null | undefined) => (d ? localTime(d) : null);

/** Собрать представления поездок одним проходом по связанным таблицам. */
export function rideViews(rows: RideRow[]): RideView[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const childIds = [...new Set(rows.map((r) => r.childId))];
  const placeIds = [...new Set(rows.flatMap((r) => [r.fromPlaceId, r.toPlaceId]))];
  const runIds = [...new Set(rows.map((r) => r.runId).filter(Boolean))] as string[];
  const stopIds = [...new Set(rows.flatMap((r) => [r.pickupStopId, r.dropoffStopId]).filter(Boolean))] as string[];

  const kids = new Map(db.select().from(schema.children).where(inArray(schema.children.id, childIds)).all().map((c) => [c.id, c]));
  const allKidsOrder = new Map<string, number>();
  for (const c of kids.values()) {
    if (!allKidsOrder.has(c.id)) allKidsOrder.set(c.id, allKidsOrder.size);
  }
  const places = new Map(db.select().from(schema.places).where(inArray(schema.places.id, placeIds)).all().map((p) => [p.id, placeView(p)]));
  const stops = new Map(stopIds.length ? db.select().from(schema.stops).where(inArray(schema.stops.id, stopIds)).all().map((s) => [s.id, s]) : []);
  const drivers = new Map<string, DriverView>();
  if (runIds.length) {
    const rows2 = db
      .select({ run: schema.runs, user: schema.users, vehicle: schema.vehicles })
      .from(schema.runs)
      .innerJoin(schema.users, eq(schema.users.id, schema.runs.driverId))
      .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.runs.vehicleId))
      .where(inArray(schema.runs.id, runIds))
      .all();
    for (const r of rows2) {
      drivers.set(r.run.id, { name: r.user.name, phone: r.user.phone, vehicle: r.vehicle?.title ?? null, plate: r.vehicle?.plate ?? null });
    }
  }
  const events = db
    .select()
    .from(schema.rideEvents)
    .where(inArray(schema.rideEvents.rideId, ids))
    .orderBy(asc(schema.rideEvents.at))
    .all();
  const times = new Map<string, RideView['times']>();
  for (const e of events) {
    const t = times.get(e.rideId) ?? {};
    const at = localTime(e.at);
    if (e.type === 'driver_departed') t.departed = at;
    if (e.type === 'arrived_pickup') t.arrived = at;
    if (e.type === 'boarded') t.boarded = at;
    if (e.type === 'handed_over') t.delivered = at;
    times.set(e.rideId, t);
  }

  return rows.map((r) => {
    const kid = kids.get(r.childId)!;
    const pickup = r.pickupStopId ? stops.get(r.pickupStopId) : undefined;
    const dropoff = r.dropoffStopId ? stops.get(r.dropoffStopId) : undefined;
    let eta: string | null = null;
    if (r.status === 'on_board') eta = hhmm(dropoff?.etaAt) ?? dropoff?.plannedAt ?? null;
    else if (r.status === 'driver_en_route' || r.status === 'driver_arrived') eta = hhmm(pickup?.etaAt) ?? pickup?.plannedAt ?? null;
    return {
      id: r.id,
      date: r.date,
      familyId: r.familyId,
      child: childView(kid, allKidsOrder.get(kid.id)),
      from: places.get(r.fromPlaceId)!,
      to: places.get(r.toPlaceId)!,
      pickupTime: r.pickupTime,
      arriveBy: r.arriveBy,
      escort: r.escort,
      priceRub: r.priceRub,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status],
      step: parentStep(r.status),
      tone: statusTone(r.status),
      runId: r.runId,
      pickupStopId: r.pickupStopId,
      dropoffStopId: r.dropoffStopId,
      eta,
      plannedDropoff: dropoff?.plannedAt ?? null,
      times: times.get(r.id) ?? {},
      receiver: r.receiver,
      cancelReason: r.cancelReason,
      driver: r.runId ? (drivers.get(r.runId) ?? null) : null,
    };
  });
}

export function ridesForFamilies(familyIds: string[], from: string, to: string): RideRow[] {
  if (!familyIds.length) return [];
  return db
    .select()
    .from(schema.rides)
    .where(and(inArray(schema.rides.familyId, familyIds), gte(schema.rides.date, from), lte(schema.rides.date, to)))
    .orderBy(asc(schema.rides.date), asc(schema.rides.pickupTime))
    .all();
}

export function getRide(id: string): RideRow {
  const r = db.select().from(schema.rides).where(eq(schema.rides.id, id)).get();
  if (!r) throw new HttpError(404, 'Поездка не найдена');
  return r;
}

// ——— запись событий ———

export interface EventInput {
  rideIds: string[];
  type: RideEventType;
  source: EventSource;
  actorUserId?: string;
  lat?: number;
  lon?: number;
  receiver?: string;
  reason?: string;
  meta?: Record<string, unknown>;
}

export interface EventResult {
  applied: string[];
  rejected: { rideId: string; reason: string }[];
}

export async function recordRideEvents(input: EventInput): Promise<EventResult> {
  if (!input.rideIds.length) return { applied: [], rejected: [] };
  const rows = db.select().from(schema.rides).where(inArray(schema.rides.id, input.rideIds)).all();
  const result: EventResult = { applied: [], rejected: [] };
  const now = new Date();

  db.transaction((tx) => {
    for (const r of rows) {
      const t = applyEvent(r.status, input.type);
      if (!t.ok) {
        result.rejected.push({ rideId: r.id, reason: t.reason });
        continue;
      }
      tx.insert(schema.rideEvents)
        .values({
          id: newId('ev'),
          rideId: r.id,
          type: input.type,
          at: now,
          actorUserId: input.actorUserId,
          source: input.source,
          lat: input.lat,
          lon: input.lon,
          meta: { ...(input.meta ?? {}), ...(input.receiver ? { receiver: input.receiver } : {}), ...(input.reason ? { reason: input.reason } : {}) },
        })
        .run();
      tx.update(schema.rides)
        .set({
          status: t.next,
          updatedAt: now,
          ...(input.type === 'handed_over' ? { receiver: input.receiver ?? null } : {}),
          ...(input.type === 'cancelled' ? { cancelReason: input.reason ?? null } : {}),
        })
        .where(eq(schema.rides.id, r.id))
        .run();
      result.applied.push(r.id);
    }
  });

  if (result.applied.length) {
    const applied = rows.filter((r) => result.applied.includes(r.id));
    updateStopsAndRuns(applied);
    broadcastRideChange(applied);
    await notifyAboutEvents(input, applied).catch((e) => console.error('Уведомление не отправлено:', e));
  }
  if (input.rideIds.length === 1 && result.rejected.length) throw new HttpError(409, result.rejected[0].reason);
  return result;
}

/** Точка завершена, когда у неё не осталось детей, которых надо забрать или высадить. */
function updateStopsAndRuns(changed: RideRow[]) {
  const stopIds = [...new Set(changed.flatMap((r) => [r.pickupStopId, r.dropoffStopId]).filter(Boolean))] as string[];
  const now = new Date();
  for (const stopId of stopIds) {
    const stop = db.select().from(schema.stops).where(eq(schema.stops.id, stopId)).get();
    if (!stop || stop.doneAt) continue;
    const col = stop.kind === 'pickup' ? schema.rides.pickupStopId : schema.rides.dropoffStopId;
    const rides = db.select().from(schema.rides).where(eq(col, stopId)).all();
    const pending = stop.kind === 'pickup'
      ? rides.filter((r) => ['planned', 'confirmed', 'driver_en_route', 'driver_arrived'].includes(r.status))
      : rides.filter((r) => r.status === 'on_board');
    const anyServed = stop.kind === 'pickup' ? rides.some((r) => r.status !== 'cancelled') : rides.some((r) => r.status === 'delivered');
    if (!pending.length && (anyServed || rides.every((r) => r.status === 'cancelled'))) {
      db.update(schema.stops).set({ doneAt: now, arrivedAt: stop.arrivedAt ?? now }).where(eq(schema.stops.id, stopId)).run();
    }
  }
  const runIds = [...new Set(changed.map((r) => r.runId).filter(Boolean))] as string[];
  for (const runId of runIds) {
    const open = db.select().from(schema.stops).where(and(eq(schema.stops.runId, runId))).all().filter((s) => !s.doneAt);
    if (!open.length) db.update(schema.runs).set({ status: 'done', finishedAt: now }).where(and(eq(schema.runs.id, runId), ne(schema.runs.status, 'done'))).run();
  }
}

export function broadcastRideChange(changed: Pick<RideRow, 'familyId' | 'runId' | 'id'>[]) {
  const families = [...new Set(changed.map((r) => r.familyId))];
  publish(families.map(channel.family), 'rides', { rideIds: changed.map((r) => r.id) });
  const runIds = [...new Set(changed.map((r) => r.runId).filter(Boolean))] as string[];
  const drivers = runIds.length ? db.select({ d: schema.runs.driverId }).from(schema.runs).where(inArray(schema.runs.id, runIds)).all() : [];
  publish([channel.dispatch, ...drivers.map((d) => channel.driver(d.d))], 'rides', { rideIds: changed.map((r) => r.id) });
}

async function notifyAboutEvents(input: EventInput, changed: RideRow[]) {
  const views = rideViews(changed);
  const byFamily = new Map<string, RideView[]>();
  for (const v of views) byFamily.set(v.familyId, [...(byFamily.get(v.familyId) ?? []), v]);
  for (const [familyId, list] of byFamily) {
    const first = list[0];
    const ctx: MessageContext = {
      children: list.map((v) => v.child.firstName),
      time: localTime(),
      driver: first.driver?.name,
      driverPhone: first.driver?.phone ?? undefined,
      fromPlace: first.from.name,
      toPlace: [...new Set(list.map((v) => v.to.name))].join(', '),
      eta: input.type === 'boarded' ? (first.plannedDropoff ?? undefined) : (first.eta ?? undefined),
      receiver: input.receiver,
      reason: input.reason,
      pickupTime: first.pickupTime,
    };
    // SMS — выключены по умолчанию (SMS_PROVIDER=none); код оставлен на случай, если понадобятся
    const sms = smsText(input.type, ctx);
    if (sms) await smsFamily(familyId, input.type, sms, first.id);
    const msg = eventMessage(input.type, ctx);
    if (!msg) continue;
    // письмо на почту из Яндекс ID — доходит, даже если приложение не установлено
    await emailFamily(familyId, input.type, msg.title, msg.body, first.id);
    // одна «карточка» на забор: следующее сообщение заменяет предыдущее на экране блокировки
    const tag = `trip-${first.pickupStopId ?? first.id}`;
    await notifyFamily(familyId, input.type, msg, { tag, rideId: first.id });
  }
  // диспетчеру важно знать об отменах и неявках
  if (input.type === 'cancelled' || input.type === 'no_show') {
    const dispatchers = db.select().from(schema.users).all().filter((u) => u.roles.includes('dispatcher') && u.id !== input.actorUserId);
    const v = views[0];
    await notifyUsers(
      dispatchers.map((d) => d.id),
      `admin_${input.type}`,
      {
        title: input.type === 'cancelled' ? `Отмена: ${views.map((x) => x.child.firstName).join(', ')}` : `Не вышел: ${views.map((x) => x.child.firstName).join(', ')}`,
        body: `${v.date} ${v.pickupTime} · ${v.from.name} → ${v.to.name}${input.reason ? `. ${input.reason}` : ''}`,
        priority: 'important',
        url: '/admin',
      },
    );
  }
}
