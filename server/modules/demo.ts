// Демо-поездка: машина сама проезжает ближайший забор и развозит детей по точкам.
// Идут настоящие события, статусы, карта и уведомления — как в реальной смене.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { routePath } from './geo';
import { departToStop, ingestPosition, forgetPosition, arriveAtStop } from './tracking';
import { recordRideEvents, broadcastRideChange } from './rides';
import { distanceM, type LatLon } from '../../shared/geo';
import { localDate } from '../../shared/time';

let running = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEP_MS = 1500;
const STEP_M = 140;

export function demoStatus() {
  return { running };
}

function todayRun() {
  return db.select().from(schema.runs).where(eq(schema.runs.date, localDate())).get() ?? null;
}

/** Проехать по улицам от точки до точки, отправляя координаты как трекер. */
async function drive(driverId: string, from: LatLon, to: LatLon) {
  const path = await routePath(from, to);
  const pts: LatLon[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(distanceM(a, b) / STEP_M));
    for (let k = 1; k <= n; k++) pts.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
  }
  // прореживаем до шагов ~140 м
  const out: LatLon[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += distanceM(pts[i - 1], pts[i]);
    if (i === 0 || acc >= STEP_M || i === pts.length - 1) {
      out.push(pts[i]);
      acc = 0;
    }
  }
  for (const p of out) {
    await ingestPosition(driverId, { lat: p.lat, lon: p.lon, speed: 8 }, 'tracker');
    await sleep(STEP_MS);
  }
}

export async function startDemoTrip(): Promise<{ ok: boolean; message: string }> {
  if (running) return { ok: false, message: 'Демо-поездка уже идёт' };
  const run = todayRun();
  if (!run) return { ok: false, message: 'На сегодня нет рейса' };
  const stops = db.select().from(schema.stops).where(eq(schema.stops.runId, run.id)).orderBy(asc(schema.stops.seq)).all();
  const startIdx = stops.findIndex((s) => s.kind === 'pickup' && !s.doneAt);
  if (startIdx < 0) return { ok: false, message: 'Все заборы на сегодня пройдены. Нажмите «Начать демо заново».' };
  const segment = [stops[startIdx]];
  for (let i = startIdx + 1; i < stops.length && stops[i].kind === 'dropoff'; i++) segment.push(stops[i]);

  running = true;
  void (async () => {
    try {
      const places = new Map(
        db.select().from(schema.places).where(inArray(schema.places.id, segment.map((s) => s.placeId))).all().map((p) => [p.id, p]),
      );
      const pickup = places.get(segment[0].placeId)!;
      let here: LatLon = { lat: pickup.lat - 0.012, lon: pickup.lon + 0.004 }; // машина стартует ~1,3 км от точки
      await ingestPosition(run.driverId, here, 'tracker');
      await departToStop(segment[0].id, run.driverId);
      await sleep(2500);
      await drive(run.driverId, here, pickup); // геозона сама отметит «на месте»
      await arriveAtStop(segment[0].id, 'geofence', undefined, { lat: pickup.lat, lon: pickup.lon, at: Date.now() }); // если дорога прошла дальше 150 м от точки
      here = pickup;
      await sleep(5000);
      const waiting = db
        .select()
        .from(schema.rides)
        .where(eq(schema.rides.pickupStopId, segment[0].id))
        .all()
        .filter((r) => ['planned', 'confirmed', 'driver_en_route', 'driver_arrived'].includes(r.status));
      await recordRideEvents({ rideIds: waiting.map((r) => r.id), type: 'boarded', source: 'driver', actorUserId: run.driverId });
      for (const stop of segment.slice(1)) {
        const place = places.get(stop.placeId)!;
        await sleep(2000);
        await drive(run.driverId, here, place);
        await arriveAtStop(stop.id, 'geofence', undefined, { lat: place.lat, lon: place.lon, at: Date.now() });
        here = place;
        await sleep(3000);
        const onBoard = db
          .select()
          .from(schema.rides)
          .where(and(eq(schema.rides.dropoffStopId, stop.id), eq(schema.rides.status, 'on_board')))
          .all();
        for (const r of onBoard) {
          const child = db.select().from(schema.children).where(eq(schema.children.id, r.childId)).get();
          await recordRideEvents({ rideIds: [r.id], type: 'handed_over', source: 'driver', actorUserId: run.driverId, receiver: child?.handoverTo[0] ?? 'педагог' });
        }
      }
    } catch (e) {
      console.error('Демо-поездка прервалась:', e);
    } finally {
      running = false;
    }
  })();
  return { ok: true, message: 'Демо-поездка началась' };
}

/** Вернуть сегодняшний демо-день в исходное состояние. */
export function resetDemoDay() {
  if (running) return { ok: false, message: 'Дождитесь конца демо-поездки' };
  const run = todayRun();
  if (!run) return { ok: false, message: 'На сегодня нет рейса' };
  const rides = db.select().from(schema.rides).where(eq(schema.rides.runId, run.id)).all();
  db.transaction((tx) => {
    if (rides.length) tx.delete(schema.rideEvents).where(inArray(schema.rideEvents.rideId, rides.map((r) => r.id))).run();
    tx.update(schema.rides).set({ status: 'planned', receiver: null, cancelReason: null, updatedAt: new Date() }).where(eq(schema.rides.runId, run.id)).run();
    tx.update(schema.stops).set({ departedAt: null, arrivedAt: null, doneAt: null, etaAt: null }).where(eq(schema.stops.runId, run.id)).run();
    tx.update(schema.runs).set({ status: 'planned', startedAt: null, finishedAt: null }).where(eq(schema.runs.id, run.id)).run();
    tx.delete(schema.positions).where(eq(schema.positions.driverId, run.driverId)).run();
  });
  forgetPosition(run.driverId);
  broadcastRideChange(rides);
  return { ok: true, message: 'Демо-день начат заново' };
}
