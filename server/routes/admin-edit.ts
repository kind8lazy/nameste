// Диспетчер правит и убирает ошибки в данных клиентов, заводит сотрудников и отключает доступ.
// Удалять можно только то, на чём не держится история поездок: иначе — понятный отказ.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId, newToken } from '../lib/ids';
import { requireRole, HttpError, destroyAllSessions, isDemoUser } from '../modules/auth';
import { planDay } from '../modules/planner';
import { placeInput, requireFamily } from '../modules/places';
import { localDate } from '../../shared/time';
import { normalizePhone, formatPhone } from '../../shared/phone';

const id = z.object({ id: z.string().min(1) });
const name = (max: number) => z.string().trim().min(2, 'слишком коротко').max(max, 'слишком длинно');
const FUTURE_OPEN = ['planned', 'confirmed'] as const;

export async function adminEditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    requireRole(req, 'dispatcher');
  });

  // ——— семья
  app.patch('/admin/families/:id', async (req) => {
    const { id: familyId } = id.parse(req.params);
    const b = z.object({ name: name(80), note: z.string().trim().max(500).optional() }).parse(req.body);
    requireFamily(familyId);
    db.update(schema.families).set(b).where(eq(schema.families.id, familyId)).run();
    return { ok: true };
  });

  app.delete('/admin/families/:id', async (req) => {
    const { id: familyId } = id.parse(req.params);
    requireFamily(familyId);
    if (db.select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.familyId, familyId)).get()) {
      throw new HttpError(409, 'У семьи уже были поездки, их история нужна для отчётов. Остановите расписание и отключите доступ взрослым.');
    }
    db.delete(schema.families).where(eq(schema.families.id, familyId)).run();
    return { ok: true };
  });

  // ——— взрослые
  app.delete('/admin/families/:id/members/:userId', async (req) => {
    const { id: familyId, userId } = z.object({ id: z.string(), userId: z.string() }).parse(req.params);
    const members = db.select().from(schema.familyMembers).where(eq(schema.familyMembers.familyId, familyId)).all();
    const m = members.find((x) => x.userId === userId);
    if (!m) throw new HttpError(404, 'Этого человека нет в семье');
    if (m.isOwner && members.filter((x) => x.isOwner).length === 1) throw new HttpError(409, 'Нельзя убрать единственного владельца семьи. Сначала сделайте владельцем другого взрослого.');
    db.delete(schema.familyMembers).where(and(eq(schema.familyMembers.familyId, familyId), eq(schema.familyMembers.userId, userId))).run();
    destroyAllSessions(userId); // убранный человек сразу теряет вход
    return { ok: true };
  });

  // ——— дети
  app.patch('/admin/children/:id', async (req) => {
    const { id: childId } = id.parse(req.params);
    const b = z
      .object({
        firstName: z.string().trim().min(1).max(40),
        grade: z.string().trim().max(20).optional(),
        notes: z.string().trim().max(500).optional(),
        seat: z.enum(['none', 'booster', 'seat']).optional(),
      })
      .parse(req.body);
    if (!db.select({ id: schema.children.id }).from(schema.children).where(eq(schema.children.id, childId)).get()) throw new HttpError(404, 'Ребёнок не найден');
    db.update(schema.children).set(b).where(eq(schema.children.id, childId)).run();
    return { ok: true };
  });

  app.delete('/admin/children/:id', async (req) => {
    const { id: childId } = id.parse(req.params);
    if (db.select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.childId, childId)).get()) {
      throw new HttpError(409, 'У ребёнка уже были поездки, историю не удаляем. Остановите его поездки по расписанию.');
    }
    db.delete(schema.children).where(eq(schema.children.id, childId)).run();
    return { ok: true };
  });

  // ——— места
  app.patch('/admin/places/:id', async (req) => {
    const { id: placeId } = id.parse(req.params);
    const b = placeInput.partial().parse(req.body);
    if (!db.select({ id: schema.places.id }).from(schema.places).where(eq(schema.places.id, placeId)).get()) throw new HttpError(404, 'Место не найдено');
    db.update(schema.places).set({ ...b, entranceNote: b.entranceNote === undefined ? undefined : b.entranceNote || null }).where(eq(schema.places.id, placeId)).run();
    return { ok: true };
  });

  app.delete('/admin/places/:id', async (req) => {
    const { id: placeId } = id.parse(req.params);
    const used =
      db.select({ id: schema.rideTemplates.id }).from(schema.rideTemplates).where(and(eq(schema.rideTemplates.active, true), or(eq(schema.rideTemplates.fromPlaceId, placeId), eq(schema.rideTemplates.toPlaceId, placeId)))).get() ||
      db.select({ id: schema.rides.id }).from(schema.rides).where(or(eq(schema.rides.fromPlaceId, placeId), eq(schema.rides.toPlaceId, placeId))).get();
    if (used) throw new HttpError(409, 'Место используется в поездках. Сначала остановите эти поездки.');
    db.delete(schema.rideTemplates).where(or(eq(schema.rideTemplates.fromPlaceId, placeId), eq(schema.rideTemplates.toPlaceId, placeId))).run();
    db.delete(schema.places).where(eq(schema.places.id, placeId)).run();
    return { ok: true };
  });

  // ——— поездки по расписанию: остановить
  app.delete('/admin/templates/:id', async (req) => {
    const { id: tplId } = id.parse(req.params);
    const t = db.select().from(schema.rideTemplates).where(eq(schema.rideTemplates.id, tplId)).get();
    if (!t) throw new HttpError(404, 'Поездка по расписанию не найдена');
    db.update(schema.rideTemplates).set({ active: false }).where(eq(schema.rideTemplates.id, tplId)).run();
    // будущие поездки, которые ещё не начались, убираем; прошедшие и начатые остаются в истории
    const today = localDate();
    const future = db
      .select({ id: schema.rides.id, date: schema.rides.date })
      .from(schema.rides)
      .where(and(eq(schema.rides.templateId, tplId), gte(schema.rides.date, today), inArray(schema.rides.status, [...FUTURE_OPEN])))
      .all();
    if (future.length) db.delete(schema.rides).where(inArray(schema.rides.id, future.map((r) => r.id))).run();
    for (const d of new Set(future.map((r) => r.date))) planDay(d);
    return { ok: true, removed: future.length };
  });

  // ——— сотрудники
  app.post('/admin/staff', async (req) => {
    const b = z
      .object({
        name: name(80),
        role: z.enum(['driver', 'dispatcher']),
        phone: z.string().trim().max(30).refine((v) => !v || normalizePhone(v), 'неверный номер, пример: +7 921 123-45-67').optional(),
        email: z.string().trim().email().max(120).optional().or(z.literal('')),
      })
      .parse(req.body);
    const phone = b.phone ? formatPhone(b.phone) : null;
    for (const u of db.select().from(schema.users).all()) {
      if (isDemoUser(u.id)) continue;
      if (phone && normalizePhone(u.phone) === normalizePhone(phone)) throw new HttpError(409, `Этот телефон уже записан у «${u.name}».`);
    }
    const userId = newId('u');
    db.insert(schema.users).values({ id: userId, name: b.name, phone, email: b.email?.toLowerCase() || null, roles: [b.role] }).run();
    if (b.role === 'driver') {
      const vehicle = db.select().from(schema.vehicles).all().find((v) => v.available) ?? db.select().from(schema.vehicles).get();
      db.insert(schema.drivers).values({ userId, vehicleId: vehicle?.id ?? null, trackerToken: newToken(12) }).run();
    }
    return { userId };
  });

  /** Отключить человеку вход: все его устройства сразу выходят, неиспользованные коды гаснут. */
  app.post('/admin/users/:id/revoke', async (req) => {
    const { id: userId } = id.parse(req.params);
    if (userId === req.user!.id) throw new HttpError(400, 'Себя так отключать нельзя: воспользуйтесь «Выйти на всех устройствах»');
    destroyAllSessions(userId);
    db.delete(schema.loginCodes).where(eq(schema.loginCodes.userId, userId)).run();
    return { ok: true };
  });
}
