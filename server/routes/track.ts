// Отслеживание без входа: по ссылке на один день и маршрут по улицам для карты.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newToken } from '../lib/ids';
import { HttpError, requireRole, familyIdsOf } from '../modules/auth';
import { rideViews, ridesForFamilies } from '../modules/rides';
import { lastPosition } from '../modules/tracking';
import { routePath } from '../modules/geo';
import { atLocal, formatDayRu, localDate, addDays } from '../../shared/time';
import { isActive } from '../../shared/domain';
import type { ParentDay } from '../../shared/api';

function validLink(token: string) {
  const row = db
    .select()
    .from(schema.trackLinks)
    .where(and(eq(schema.trackLinks.token, token), gt(schema.trackLinks.expiresAt, new Date())))
    .get();
  if (!row) throw new HttpError(404, 'Ссылка устарела. Попросите новую у родителя.');
  return row;
}

/** По ссылке видно только имя ребёнка: заметки, класс, кому передавать и кресло остаются в семье. */
function scrubChild<T extends ParentDay['children'][number]>(c: T): T {
  return { ...c, grade: '', notes: null, handoverTo: [], seat: 'none' };
}

/** Адреса, телефоны и подсказки скрыты, координаты округлены до ~100 м: ссылку могут переслать дальше. */
function scrubPlace<T extends ParentDay['rides'][number]['from']>(p: T): T {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { ...p, address: '', contactPhone: null, entranceNote: null, lat: round(p.lat), lon: round(p.lon) };
}

/** День семьи для экрана отслеживания. Телефоны и адреса не показываем — только названия мест. */
function dayFor(familyIds: string[], date: string, publicView: boolean): ParentDay {
  const rides = rideViews(ridesForFamilies(familyIds, date, date)).map((r) =>
    publicView
      ? {
          ...r,
          familyId: '',
          child: scrubChild(r.child),
          from: scrubPlace(r.from),
          to: scrubPlace(r.to),
          driver: r.driver ? { ...r.driver, phone: null } : null,
          priceRub: 0,
        }
      : r,
  );
  const active = rides.find((r) => isActive(r.status) && r.runId);
  let live: ParentDay['live'] = null;
  if (active?.runId) {
    const run = db.select().from(schema.runs).where(eq(schema.runs.id, active.runId)).get();
    live = { runId: active.runId, position: run ? lastPosition(run.driverId) : null };
  }
  const kids = [...new Map(rides.map((r) => [r.child.id, r.child])).values()];
  return { date, dayLabel: formatDayRu(date), children: kids, rides, live };
}

const routeCache = new Map<string, [number, number][]>();

export async function trackRoutes(app: FastifyInstance) {
  /** Родитель создаёт ссылку на сегодня. Повторный запрос возвращает ту же ссылку. */
  app.post('/parent/track-link', async (req) => {
    const u = requireRole(req, 'parent', 'dispatcher');
    const familyId = familyIdsOf(u.id)[0];
    if (!familyId) throw new HttpError(400, 'Вы пока не привязаны к семье');
    const date = localDate();
    const existing = db
      .select()
      .from(schema.trackLinks)
      .where(and(eq(schema.trackLinks.familyId, familyId), eq(schema.trackLinks.date, date), gt(schema.trackLinks.expiresAt, new Date())))
      .get();
    const token = existing?.token ?? newToken(16);
    if (!existing) {
      db.insert(schema.trackLinks)
        .values({ token, familyId, date, createdBy: u.id, expiresAt: atLocal(addDays(date, 1), '03:00') })
        .run();
    }
    return { url: `${config.publicUrl}/t/${token}` };
  });

  app.get('/track/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.params);
    const link = validLink(token);
    return dayFor([link.familyId], link.date, true);
  });

  /** Линия маршрута по улицам. Только для вошедших или по действующей ссылке отслеживания. */
  app.get('/route', async (req) => {
    const q = z
      .object({ from: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/), to: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/), t: z.string().optional() })
      .parse(req.query);
    if (!req.user) {
      if (!q.t) throw new HttpError(401, 'Нужно войти');
      validLink(q.t);
    }
    const [flat, flon] = q.from.split(',').map(Number);
    const [tlat, tlon] = q.to.split(',').map(Number);
    const key = [flat, flon, tlat, tlon].map((n) => n.toFixed(4)).join(',');
    let coords = routeCache.get(key);
    if (!coords) {
      coords = (await routePath({ lat: flat, lon: flon }, { lat: tlat, lon: tlon })).map((p) => [p.lon, p.lat] as [number, number]);
      if (routeCache.size > 500) routeCache.clear();
      routeCache.set(key, coords);
    }
    return { coords };
  });
}
