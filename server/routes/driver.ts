// Водитель: смена по точкам и отметки. Каждое действие проверяет, что точка из его рейса.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dateField } from '../lib/validate';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { requireRole, HttpError } from '../modules/auth';
import { shiftView } from '../modules/views';
import { recordRideEvents, getRide } from '../modules/rides';
import { departToStop, arriveAtStop, ingestPosition, lastPosition } from '../modules/tracking';
import { localDate } from '../../shared/time';

function ownStop(req: FastifyRequest, stopId: string) {
  const u = requireRole(req, 'driver');
  const stop = db.select().from(schema.stops).where(eq(schema.stops.id, stopId)).get();
  if (!stop) throw new HttpError(404, 'Точка не найдена');
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, stop.runId)).get();
  if (!run || run.driverId !== u.id) throw new HttpError(403, 'Это точка другого рейса');
  return { user: u, stop, run };
}

function ownRide(req: FastifyRequest, rideId: string) {
  const u = requireRole(req, 'driver');
  const ride = getRide(rideId);
  const run = ride.runId ? db.select().from(schema.runs).where(eq(schema.runs.id, ride.runId)).get() : null;
  if (!run || run.driverId !== u.id) throw new HttpError(403, 'Этого ребёнка нет в вашем рейсе');
  return { user: u, ride };
}

export async function driverRoutes(app: FastifyInstance) {
  app.get('/driver/shift', async (req) => {
    const u = requireRole(req, 'driver');
    const { date = localDate() } = z.object({ date: dateField.optional() }).parse(req.query);
    return shiftView(u.id, date);
  });

  app.post('/driver/stops/:id/depart', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { user } = ownStop(req, id);
    await departToStop(id, user.id);
    return { ok: true };
  });

  app.post('/driver/stops/:id/arrive', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { user } = ownStop(req, id);
    await arriveAtStop(id, 'driver', user.id, lastPosition(user.id));
    return { ok: true };
  });

  /** Посадка: водитель сверил детей по фото и отметил, кто сел. */
  app.post('/driver/stops/:id/board', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { rideIds } = z.object({ rideIds: z.array(z.string()).min(1) }).parse(req.body);
    const { user } = ownStop(req, id);
    const rides = db.select().from(schema.rides).where(inArray(schema.rides.id, rideIds)).all();
    if (rides.some((r) => r.pickupStopId !== id)) throw new HttpError(400, 'Этих детей забирают на другой точке');
    await arriveAtStop(id, 'driver', user.id, lastPosition(user.id));
    const pos = lastPosition(user.id);
    return recordRideEvents({ rideIds, type: 'boarded', source: 'driver', actorUserId: user.id, lat: pos?.lat, lon: pos?.lon });
  });

  app.post('/driver/rides/:id/no-show', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { user } = ownRide(req, id);
    await recordRideEvents({ rideIds: [id], type: 'no_show', source: 'driver', actorUserId: user.id });
    return { ok: true };
  });

  app.post('/driver/rides/:id/handover', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { receiver } = z.object({ receiver: z.string().min(2).max(80) }).parse(req.body);
    const { user, ride } = ownRide(req, id);
    if (ride.dropoffStopId) await arriveAtStop(ride.dropoffStopId, 'driver', user.id, lastPosition(user.id));
    const pos = lastPosition(user.id);
    await recordRideEvents({ rideIds: [id], type: 'handed_over', source: 'driver', actorUserId: user.id, receiver, lat: pos?.lat, lon: pos?.lon });
    return { ok: true };
  });

  /** Координаты из открытого приложения водителя (когда экран включён). */
  app.post('/driver/position', async (req) => {
    const u = requireRole(req, 'driver');
    const p = z
      .object({
        lat: z.number(),
        lon: z.number(),
        accuracy: z.number().nullish(),
        speed: z.number().nullish(),
        heading: z.number().nullish(),
      })
      .parse(req.body);
    await ingestPosition(u.id, p, 'app');
    return { ok: true };
  });
}
