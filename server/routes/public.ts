// Вход по коду приглашения, профиль, выход, уведомления, живые обновления, демо-режим.
// Вход через Яндекс — в routes/yandex-auth.ts, приём координат трекера — в routes/tracker.ts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client';
import { eq, inArray, notInArray } from 'drizzle-orm';
import {
  redeemCode,
  setSessionCookie,
  destroySession,
  destroyAllSessions,
  requireUser,
  createLoginCode,
  createSession,
  familyIdsOf,
  demoUserIds,
  isDemoUser,
  SESSION_COOKIE,
} from '../modules/auth';
import { config } from '../config';
import { notifyNewLogin } from '../modules/login-alert';
import { startDemoTrip, resetDemoDay, demoStatus } from '../modules/demo';
import { vapidPublicKey, saveSubscription, hasSubscription, sendToUser } from '../modules/notify';
import { subscribe, channel } from '../modules/realtime';
import type { Me } from '../../shared/api';

export function meOf(userId: string): Me {
  const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()!;
  const fams = db
    .select({ id: schema.families.id, name: schema.families.name, relation: schema.familyMembers.relation, isOwner: schema.familyMembers.isOwner, canEdit: schema.familyMembers.canEdit })
    .from(schema.familyMembers)
    .innerJoin(schema.families, eq(schema.families.id, schema.familyMembers.familyId))
    .where(eq(schema.familyMembers.userId, userId))
    .all()
    .map(({ isOwner, canEdit, ...f }) => ({ ...f, canEdit: isOwner || canEdit }));
  return { id: u.id, name: u.name, roles: u.roles, families: fams, pushEnabled: hasSubscription(u.id), yandexLinked: !!u.yandexId, lite: config.liteMode };
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));

  app.post('/auth/redeem', async (req, reply) => {
    const { code } = z.object({ code: z.string().min(4).max(20) }).parse(req.body);
    const { token, user } = redeemCode(code, req.ip, req.headers['user-agent']);
    setSessionCookie(reply, token);
    const devices = db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id)).all().length;
    if (devices > 1) void notifyNewLogin(user.id, 'вход по коду', req.headers['user-agent']);
    return meOf(user.id);
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** «Выйти на всех устройствах» — если пришло уведомление о чужом входе. */
  app.post('/auth/logout-all', async (req, reply) => {
    const u = requireUser(req);
    destroyAllSessions(u.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Код для входа на другом устройстве (например, в приложении с экрана «Домой»). */
  app.post('/auth/device-code', async (req) => {
    const u = requireUser(req);
    return createLoginCode(u.id, 'device', u.id);
  });

  app.get('/me', async (req) => meOf(requireUser(req).id));

  // ——— демо-режим: вход одной кнопкой за каждую роль (только демо-аккаунты) ———
  const demoUsers = (): Record<string, string> | null => {
    if (!config.demoMode) return null;
    const row = db.select().from(schema.kv).where(eq(schema.kv.key, 'demo_users')).get();
    return row ? (JSON.parse(row.value) as Record<string, string>) : null;
  };
  const demoKeyOk = (key?: string) => !config.demoKey || key === config.demoKey;
  /** Демо-диспетчер видит все семьи, поэтому демо не включается, если в базе есть настоящие семьи. */
  const realFamiliesExist = () => {
    const ids = demoUserIds();
    const demoFamilies = ids.length
      ? db.select({ id: schema.familyMembers.familyId }).from(schema.familyMembers).where(inArray(schema.familyMembers.userId, ids)).all().map((r) => r.id)
      : [];
    const q = db.select({ id: schema.families.id }).from(schema.families);
    return !!(demoFamilies.length ? q.where(notInArray(schema.families.id, demoFamilies)).get() : q.get());
  };

  app.get('/auth/demo', async (req) => {
    const { key } = z.object({ key: z.string().max(100).optional() }).parse(req.query);
    return { enabled: !!demoUsers() && !realFamiliesExist() && (demoKeyOk(key) || isDemoUser(req.user?.id)), ...demoStatus() };
  });
  // демо-поездкой управляют только демо-аккаунты: настоящие поездки она не трогает
  app.post('/demo/start', async (req, reply) => {
    const u = requireUser(req);
    if (!demoUsers() || !isDemoUser(u.id)) return reply.code(404).send({ error: 'Демо-режим выключен' });
    return startDemoTrip();
  });
  app.post('/demo/reset', async (req, reply) => {
    const u = requireUser(req);
    if (!demoUsers() || !isDemoUser(u.id)) return reply.code(404).send({ error: 'Демо-режим выключен' });
    return resetDemoDay();
  });
  app.post('/auth/demo', async (req, reply) => {
    const { role, key } = z.object({ role: z.enum(['parent', 'grandma', 'driver']), key: z.string().max(100).optional() }).parse(req.body);
    const users = demoUsers();
    if (!users?.[role] || !demoKeyOk(key)) return reply.code(404).send({ error: 'Демо-режим выключен' });
    if (realFamiliesExist()) return reply.code(404).send({ error: 'Демо недоступно: в базе уже есть настоящие семьи' });
    // демо-сессия живёт полдня
    setSessionCookie(reply, createSession(users[role], req.headers['user-agent'], 0.5), 0.5);
    return meOf(users[role]);
  });

  app.get('/push/key', async () => ({ publicKey: vapidPublicKey }));

  app.post('/push/subscribe', async (req) => {
    const u = requireUser(req);
    const sub = z
      .object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })
      .parse(req.body);
    saveSubscription(u.id, sub, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/push/test', async (req) => {
    const u = requireUser(req);
    await sendToUser(u.id, { title: 'Уведомления работают', body: 'Так будут приходить статусы поездок.', priority: 'info', url: '/' }, { kind: 'test' });
    return { ok: true };
  });

  app.get('/stream', async (req, reply) => {
    const u = requireUser(req);
    const channels = familyIdsOf(u.id).map(channel.family);
    if (u.roles.includes('driver')) channels.push(channel.driver(u.id));
    if (u.roles.includes('dispatcher')) channels.push(channel.dispatch);
    if (u.roles.includes('dispatcher') || u.roles.includes('driver')) channels.push(channel.staff);
    subscribe(req, reply, channels);
  });
}
