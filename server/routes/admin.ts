// Диспетчер: день целиком, семьи, места, шаблоны недели, приглашения.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newId } from '../lib/ids';
import { requireRole, createLoginCode, HttpError, isDemoUser } from '../modules/auth';
import { adminDayView } from '../modules/views';
import { planDay } from '../modules/planner';
import { materialize, setException } from '../modules/schedule';
import { geocode } from '../modules/geo';
import { placeInput, addFamilyPlace, requireFamilyPlace, requireFamilyChild, requireFamily, requireNoDuplicateTemplate } from '../modules/places';
import { hasSubscription, recentNotifications } from '../modules/notify';
import { listRequests, acceptRequest, declineRequest } from '../modules/requests';
import { sendSms } from '../modules/sms';
import { sendMail } from '../modules/mail';
import { parseRule, describeRule } from '../../shared/recurrence';
import { localDate } from '../../shared/time';
import { normalizePhone, formatPhone } from '../../shared/phone';
import { dateField, timeField, planDateField } from '../lib/validate';

const date = dateField;
const time = timeField;
const nameStr = (max: number) => z.string().trim().min(2, 'слишком коротко').max(max, 'слишком длинно');
const noteStr = z.string().trim().max(500, 'слишком длинно');
const pastDate = date.refine((d) => d <= localDate(), 'дата рождения в будущем');
/** Телефон: пусто или настоящий номер; хранится в одном виде, чтобы вход через Яндекс находил человека. */
const phoneStr = z
  .string()
  .trim()
  .max(30)
  .refine((v) => !v || normalizePhone(v), 'неверный номер, пример: +7 921 123-45-67')
  .transform((v) => (v ? formatPhone(v) : undefined));

/** Один телефон или почта — один человек: иначе вход через Яндекс не поймёт, в какую семью вести. */
function assertContactFree(phone: string | undefined | null, email: string | undefined | null, exceptUserId?: string) {
  const p = normalizePhone(phone);
  const e = email?.trim().toLowerCase();
  if (!p && !e) return;
  for (const u of db.select().from(schema.users).all()) {
    if (u.id === exceptUserId || isDemoUser(u.id)) continue;
    if (p && normalizePhone(u.phone) === p) throw new HttpError(409, `Этот телефон уже записан у «${u.name}». Найдите этого человека в списке семей, а не заводите заново.`);
    if (e && u.email?.toLowerCase() === e) throw new HttpError(409, `Эта почта уже записана у «${u.name}». Найдите этого человека в списке семей.`);
  }
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    requireRole(req, 'dispatcher');
  });

  app.get('/admin/day', async (req) => {
    const q = z.object({ date: date.optional() }).parse(req.query);
    return adminDayView(q.date ?? localDate());
  });

  app.post('/admin/days/:date/plan', async (req) => {
    const p = z.object({ date }).parse(req.params);
    return planDay(p.date);
  });

  app.post('/admin/materialize', async () => ({ created: materialize() }));

  app.get('/admin/families', async () => {
    const families = db.select().from(schema.families).orderBy(asc(schema.families.name)).all();
    const members = db
      .select({ m: schema.familyMembers, u: schema.users })
      .from(schema.familyMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
      .all();
    const kids = db.select().from(schema.children).all();
    const templates = db.select().from(schema.rideTemplates).all();
    return families.map((f) => ({
      ...f,
      members: members
        .filter((x) => x.m.familyId === f.id)
        .map((x) => ({ userId: x.u.id, name: x.u.name, phone: x.u.phone, email: x.u.email, yandex: !!x.u.yandexId, relation: x.m.relation, isOwner: x.m.isOwner, notify: x.m.notify, push: hasSubscription(x.u.id) })),
      children: kids.filter((k) => k.familyId === f.id),
      templates: templates
        .filter((t) => t.familyId === f.id)
        .map((t) => ({ ...t, ruleText: describeRule(parseRule(t.rule)) })),
    }));
  });

  /** Все люди в системе и как они входят: чтобы выдать код тем, у кого не получается вход через Яндекс. */
  app.get('/admin/people', async () => {
    const users = db.select().from(schema.users).all().filter((u) => !isDemoUser(u.id));
    const members = db
      .select({ userId: schema.familyMembers.userId, relation: schema.familyMembers.relation, family: schema.families.name })
      .from(schema.familyMembers)
      .innerJoin(schema.families, eq(schema.families.id, schema.familyMembers.familyId))
      .all();
    const lastLogin = new Map<string, Date>();
    for (const s of db.select().from(schema.sessions).all()) {
      const prev = lastLogin.get(s.userId);
      if (!prev || s.createdAt > prev) lastLogin.set(s.userId, s.createdAt);
    }
    return users
      .map((u) => ({
        id: u.id,
        name: u.name,
        roles: u.roles,
        phone: u.phone,
        email: u.email,
        yandex: !!u.yandexId,
        families: members.filter((m) => m.userId === u.id).map((m) => `${m.family} (${m.relation})`),
        lastLogin: lastLogin.get(u.id)?.toISOString() ?? null,
      }))
      .sort((a, b) => Number(b.roles.includes('dispatcher')) - Number(a.roles.includes('dispatcher')) || a.name.localeCompare(b.name, 'ru'));
  });

  app.post('/admin/families', async (req) => {
    const body = z
      .object({
        name: nameStr(80),
        note: noteStr.optional(),
        parent: z.object({ name: nameStr(80), phone: phoneStr.optional(), email: z.string().trim().email().max(120).optional().or(z.literal('')), relation: z.string().trim().max(30).default('мама') }),
        children: z
          .array(
            z.object({
              firstName: z.string().trim().min(1).max(40),
              grade: z.string().trim().max(20).optional(),
              birthDate: pastDate.optional(),
              seat: z.enum(['none', 'booster', 'seat']).default('none'),
              notes: noteStr.optional(),
            }),
          )
          .max(10)
          .default([]),
      })
      .parse(req.body);
    assertContactFree(body.parent.phone, body.parent.email);
    const familyId = newId('fam');
    const userId = newId('u');
    db.transaction((tx) => {
      tx.insert(schema.families).values({ id: familyId, name: body.name, note: body.note }).run();
      tx.insert(schema.users).values({ id: userId, name: body.parent.name, phone: body.parent.phone, email: body.parent.email?.trim().toLowerCase() || null, roles: ['parent'] }).run();
      tx.insert(schema.familyMembers).values({ familyId, userId, relation: body.parent.relation, isOwner: true, canEdit: true }).run();
      for (const c of body.children) tx.insert(schema.children).values({ id: newId('ch'), familyId, ...c }).run();
    });
    return { familyId, userId };
  });

  app.post('/admin/families/:id/members', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ name: nameStr(80), phone: phoneStr.optional(), relation: z.string().trim().min(2).max(30), level: z.enum(['all', 'key', 'handover']).default('key') })
      .parse(req.body);
    assertContactFree(body.phone, null);
    requireFamily(id);
    const userId = newId('u');
    db.insert(schema.users).values({ id: userId, name: body.name, phone: body.phone, roles: ['parent'] }).run();
    db.insert(schema.familyMembers).values({ familyId: id, userId, relation: body.relation, notify: { level: body.level } }).run();
    return { userId };
  });

  app.post('/admin/families/:id/children', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const c = z
      .object({
        firstName: z.string().trim().min(1).max(40),
        grade: z.string().trim().max(20).optional(),
        birthDate: pastDate.optional(),
        seat: z.enum(['none', 'booster', 'seat']).default('none'),
        notes: noteStr.optional(),
        handoverTo: z.array(z.string()).default([]),
      })
      .parse(req.body);
    requireFamily(id);
    const childId = newId('ch');
    db.insert(schema.children).values({ id: childId, familyId: id, ...c }).run();
    return { childId };
  });

  /** Приглашение: 8-значный код, действует 3 дня. Отправьте его родителю любым мессенджером. */
  app.post('/admin/users/:id/invite', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!user) throw new HttpError(404, 'Пользователь не найден');
    const admin = req.user!;
    const { code, expiresAt } = createLoginCode(id, 'invite', admin.id);
    return { code, expiresAt, link: `${config.publicUrl}/login?code=${code}`, name: user.name };
  });

  app.get('/admin/places', async (req) => {
    const q = z.object({ familyId: z.string().min(1) }).parse(req.query);
    return db.select().from(schema.places).where(eq(schema.places.familyId, q.familyId)).orderBy(asc(schema.places.name)).all();
  });

  app.get('/admin/geocode', async (req) => {
    const { q } = z.object({ q: z.string().min(3) }).parse(req.query);
    return geocode(q);
  });

  /** Место добавляется в карточке клиента: оно принадлежит семье. */
  app.post('/admin/places', async (req) => {
    const p = placeInput.extend({ familyId: z.string().min(1) }).parse(req.body);
    return { id: addFamilyPlace(p.familyId, p) };
  });

  app.post('/admin/templates', async (req) => {
    const t = z
      .object({
        familyId: z.string(),
        childId: z.string(),
        fromPlaceId: z.string(),
        toPlaceId: z.string(),
        time,
        arriveBy: time.optional(),
        rule: z.string().max(120),
        startDate: planDateField,
        endDate: date.optional(),
        escort: z.enum(['to_door', 'to_entrance']).default('to_door'),
        priceRub: z.number().int().min(0).max(100_000).default(1000),
      })
      .parse(req.body);
    try {
      parseRule(t.rule); // проверка формата
    } catch {
      throw new HttpError(400, 'Неверный повтор поездки');
    }
    requireFamilyChild(t.familyId, t.childId);
    requireFamilyPlace(t.familyId, t.fromPlaceId);
    requireFamilyPlace(t.familyId, t.toPlaceId);
    if (t.fromPlaceId === t.toPlaceId) throw new HttpError(400, 'Откуда и куда — одно и то же место');
    requireNoDuplicateTemplate(t.childId, t.time, t.rule, t.startDate);
    const id = newId('tpl');
    db.insert(schema.rideTemplates).values({ id, ...t }).run();
    const created = materialize();
    return { id, created };
  });

  app.post('/admin/templates/:id/exception', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('skip'), date, reason: z.string().optional() }),
        z.object({ action: z.literal('time'), date, time, reason: z.string().optional() }),
      ])
      .parse(req.body);
    await setException(id, body.date, body, req.user!.id);
    planDay(body.date);
    return { ok: true };
  });

  app.get('/admin/notifications', async () => {
    const users = db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).all();
    const names = new Map(users.map((u) => [u.id, u.name]));
    return recentNotifications(users.map((u) => u.id), 100).map((n) => ({ ...n, userName: names.get(n.userId) }));
  });

  app.get('/admin/vehicles', async () => db.select().from(schema.vehicles).all());

  app.post('/admin/vehicles/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const v = z.object({ available: z.boolean().optional(), note: z.string().nullish() }).parse(req.body);
    db.update(schema.vehicles).set(v).where(eq(schema.vehicles.id, id)).run();
    return { ok: true };
  });

  app.get('/admin/requests', async () => listRequests());
  app.post('/admin/requests/:id/accept', async (req) => acceptRequest(z.object({ id: z.string() }).parse(req.params).id));
  app.post('/admin/requests/:id/decline', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { answer } = z.object({ answer: z.string().min(2).max(300) }).parse(req.body);
    return declineRequest(id, answer);
  });

  /** Люди, которые вошли через Яндекс, но ещё не привязаны ни к одной семье. */
  app.get('/admin/pending-users', async () => {
    const members = new Set(db.select({ id: schema.familyMembers.userId }).from(schema.familyMembers).all().map((m) => m.id));
    return db
      .select()
      .from(schema.users)
      .all()
      .filter((u) => u.roles.length === 1 && u.roles[0] === 'parent' && !members.has(u.id))
      .map((u) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, yandex: !!u.yandexId, createdAt: u.createdAt }));
  });

  app.post('/admin/families/:id/attach', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ userId: z.string(), relation: z.string().min(2).default('родитель'), isOwner: z.boolean().default(false) }).parse(req.body);
    requireFamily(id);
    if (!db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, b.userId)).get()) throw new HttpError(404, 'Человек не найден');
    db.insert(schema.familyMembers)
      .values({ familyId: id, userId: b.userId, relation: b.relation, isOwner: b.isOwner, canEdit: b.isOwner })
      .onConflictDoNothing()
      .run();
    return { ok: true };
  });

  app.get('/admin/sms', async () => ({
    provider: config.sms.provider,
    testMode: config.sms.testMode,
    events: config.sms.events,
    mail: config.mail.provider,
    mailFrom: config.mail.user,
    yandex: config.yandex.enabled,
    demo: config.demoMode,
  }));

  /** Проверочное SMS на любой номер — убедиться, что сервис подключён. */
  app.post('/admin/sms/test', async (req) => {
    const { phone } = z.object({ phone: z.string().min(10) }).parse(req.body);
    return sendSms(phone, 'Проверка: SMS от НА МЕСТЕ работают.');
  });

  /** Проверочное письмо — убедиться, что почта подключена. */
  app.post('/admin/mail/test', async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    return sendMail(email, 'Проверка: письма от НА МЕСТЕ работают', 'Так будут приходить сообщения «ребёнок на месте».');
  });

  /** Записать или поправить почту и телефон взрослого. */
  app.post('/admin/users/:id/contacts', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ email: z.string().trim().email().max(120).or(z.literal('')).optional(), phone: phoneStr.optional() }).parse(req.body);
    assertContactFree(b.phone, b.email, id);
    db.update(schema.users)
      .set({ ...(b.email !== undefined ? { email: b.email.trim().toLowerCase() || null } : {}), ...(b.phone !== undefined ? { phone: b.phone || null } : {}) })
      .where(eq(schema.users.id, id))
      .run();
    return { ok: true };
  });
}
