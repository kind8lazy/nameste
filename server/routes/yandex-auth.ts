// Вход через Яндекс ID: обычный (перенаправление) и по коду (как на телевизорах).
//
// Меры безопасности по итогам проверки:
// - адрес возврата после входа — только внутренние разделы приложения (нет перенаправления на чужие сайты);
// - ошибки передаются кодом, текст выбирает приложение (на странице входа нельзя показать чужую инструкцию);
// - вход по коду закрыт для диспетчера и водителя: их можно обмануть «подтвердите мой код» и получить доступ ко всем семьям;
// - о каждом новом входе приходит уведомление «Не вы? Выйти на всех устройствах»;
// - сессия после входа по коду короче (30 дней);
// - незавершённый вход по коду хранится в базе и переживает перезапуск сервера.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, like, and } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newToken } from '../lib/ids';
import {
  HttpError,
  createSession,
  setSessionCookie,
  isDemoUser,
  rateKey,
  newLoginMessage,
} from '../modules/auth';
import { authorizeUrl, fetchProfile, resolveUser, requestDeviceCode, pollDeviceToken, profileByToken } from '../modules/yandex';
import { notifyNewLogin } from '../modules/login-alert';
import { meOf } from './public';

const OAUTH_COOKIE = 'nm_oauth';
const DEVICE_COOKIE = 'nm_ydev';
const CODE_LOGIN_DAYS = 30;

/** Куда можно вернуть человека после входа: только разделы приложения. */
export function safeNext(next: string | undefined | null): string {
  if (!next) return '/';
  if (next === '/') return '/';
  return /^\/(app|driver|admin|t)(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_\-=&%.]*)?$/.test(next) ? next : '/';
}

/** Ошибка → код в адресе. Текст для человека выбирает приложение по коду. */
type ErrCode = 'cancelled' | 'state' | 'conflict' | 'demo' | 'failed' | 'disabled';
function errCode(e: unknown): ErrCode {
  if (e instanceof HttpError) {
    if (e.status === 409) return 'conflict';
    if (e.status === 403) return 'demo';
  }
  return 'failed';
}

const secure = () => config.publicUrl.startsWith('https://');

// ——— незавершённый вход по коду: в базе, чтобы перезапуск сервера его не терял ———
interface DeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
  expiresAt: number;
  lastPollAt: number;
  linkUserId?: string;
  accessToken?: string; // Яндекс уже подтвердил, но профиль ещё не получен (сеть)
}
const flowKey = (id: string) => `ydev:${id}`;
function loadFlow(id: string | undefined): DeviceFlow | null {
  if (!id || !/^[A-Za-z0-9_-]{10,40}$/.test(id)) return null;
  const row = db.select().from(schema.kv).where(eq(schema.kv.key, flowKey(id))).get();
  if (!row) return null;
  try {
    const f = JSON.parse(row.value) as DeviceFlow;
    return f.expiresAt > Date.now() ? f : null;
  } catch {
    return null;
  }
}
function saveFlow(id: string, f: DeviceFlow) {
  db.insert(schema.kv).values({ key: flowKey(id), value: JSON.stringify(f) }).onConflictDoUpdate({ target: schema.kv.key, set: { value: JSON.stringify(f) } }).run();
}
function dropFlow(id: string) {
  db.delete(schema.kv).where(eq(schema.kv.key, flowKey(id))).run();
}
export function sweepFlows() {
  const rows = db.select().from(schema.kv).where(like(schema.kv.key, 'ydev:%')).all();
  for (const r of rows) {
    try {
      if ((JSON.parse(r.value) as DeviceFlow).expiresAt < Date.now()) dropFlow(r.key.slice(5));
    } catch {
      db.delete(schema.kv).where(and(eq(schema.kv.key, r.key))).run();
    }
  }
}

// не больше 10 новых кодов за 15 минут с одного адреса
const starts = new Map<string, { n: number; until: number }>();
function startLimited(ip: string) {
  const now = Date.now();
  for (const [k, v] of starts) if (v.until < now) starts.delete(k);
  const key = rateKey(ip);
  const s = starts.get(key);
  if (!s || s.until < now) {
    starts.set(key, { n: 1, until: now + 15 * 60_000 });
    return false;
  }
  return ++s.n > 10;
}

export async function yandexAuthRoutes(app: FastifyInstance) {
  app.get('/auth/yandex', async () => ({ enabled: config.yandex.enabled }));
  // вход через Яндекс выключен — все остальные его адреса закрыты
  app.addHook('onRequest', async (req, reply) => {
    if (!config.yandex.enabled && req.url.startsWith('/api/auth/yandex/') && !req.url.startsWith('/api/auth/yandex/start')) {
      return reply.code(404).send({ error: 'Вход через Яндекс сейчас выключен. Войдите по коду от диспетчера.' });
    }
  });

  // ——— обычный вход: перенаправление на Яндекс и обратно ———
  app.get('/auth/yandex/start', async (req, reply) => {
    if (!config.yandex.enabled) return reply.redirect('/login?error=disabled');
    if (req.user && isDemoUser(req.user.id)) return reply.redirect('/app/family?yandex=demo');
    const { next } = z.object({ next: z.string().max(300).optional() }).parse(req.query);
    const state = newToken(16);
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, next: safeNext(next) }), { path: '/', httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 600 });
    return reply.redirect(authorizeUrl(state));
  });

  app.get('/auth/yandex/callback', async (req, reply) => {
    const q = z.object({ code: z.string().max(200).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
    let saved: { state?: string; next?: string } = {};
    try {
      saved = JSON.parse(req.cookies[OAUTH_COOKIE] ?? '{}');
    } catch {
      /* испорченная cookie — ниже откажем */
    }
    reply.clearCookie(OAUTH_COOKIE, { path: '/' });
    const next = safeNext(saved.next);
    // тот, кто уже вошёл и привязывает Яндекс, видит результат на своей странице, а не на странице входа
    const finish = (code: ErrCode | 'linked') => {
      if (req.user) return reply.redirect(`${next.split('?')[0]}?yandex=${code}`);
      return reply.redirect(code === 'linked' ? next : `/login?error=${code}`);
    };
    console.log(`[Яндекс вход] ошибка от Яндекса: ${q.error ?? 'нет'}; код: ${q.code ? 'есть' : 'нет'}; state совпал: ${!!saved.state && q.state === saved.state}`);
    if (q.error) return finish('cancelled');
    if (!q.code || !q.state || q.state !== saved.state) return finish('state');
    try {
      const profile = await fetchProfile(q.code);
      const userId = resolveUser(profile, req.user?.id);
      if (!req.user) {
        setSessionCookie(reply, createSession(userId, req.headers['user-agent']));
        await notifyNewLogin(userId, 'вход через Яндекс', req.headers['user-agent']);
      } else {
        await notifyNewLogin(userId, 'к аккаунту привязан Яндекс', req.headers['user-agent']);
      }
      return finish('linked');
    } catch (e) {
      console.log(`[Яндекс вход] ошибка: ${(e as Error).message}`);
      return finish(errCode(e));
    }
  });

  // ——— вход по коду: без возврата из браузера (iPhone, VPN, расширения) ———
  app.post('/auth/yandex/device', async (req, reply) => {
    if (!config.yandex.enabled) throw new HttpError(404, 'Вход через Яндекс пока не настроен');
    if (req.user && isDemoUser(req.user.id)) throw new HttpError(403, 'В демо-режиме привязка Яндекса недоступна.');
    if (startLimited(req.ip)) throw new HttpError(429, 'Слишком много попыток. Подождите 15 минут.');
    sweepFlows();
    const code = await requestDeviceCode(newToken(12));
    const flowId = newToken(18);
    saveFlow(flowId, {
      deviceCode: code.deviceCode,
      userCode: code.userCode,
      verificationUrl: code.verificationUrl,
      intervalMs: Math.max(2, code.interval) * 1000,
      expiresAt: Date.now() + code.expiresIn * 1000,
      lastPollAt: 0,
      linkUserId: req.user?.id,
    });
    reply.setCookie(DEVICE_COOKIE, flowId, { path: '/api/auth/yandex', httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: code.expiresIn });
    console.log('[Яндекс вход по коду] выдан код');
    return { userCode: code.userCode, verificationUrl: code.verificationUrl, interval: code.interval, expiresIn: code.expiresIn };
  });

  /** Восстановить начатый вход по коду, если приложение перезагрузилось, пока человек был в браузере. */
  app.get('/auth/yandex/device/current', async (req) => {
    const f = loadFlow(req.cookies[DEVICE_COOKIE]);
    if (!f) return { active: false };
    return {
      active: true,
      userCode: f.userCode,
      verificationUrl: f.verificationUrl,
      interval: Math.round(f.intervalMs / 1000),
      expiresIn: Math.max(0, Math.round((f.expiresAt - Date.now()) / 1000)),
    };
  });

  app.post('/auth/yandex/device/poll', async (req, reply) => {
    const flowId = req.cookies[DEVICE_COOKIE];
    const flow = loadFlow(flowId);
    if (!flow || !flowId) return { status: 'expired' };
    const end = (body: Record<string, unknown>) => {
      dropFlow(flowId);
      reply.clearCookie(DEVICE_COOKIE, { path: '/api/auth/yandex' });
      return body;
    };

    let accessToken = flow.accessToken;
    if (!accessToken) {
      // спрашиваем Яндекс не чаще, чем он разрешил
      if (Date.now() - flow.lastPollAt < flow.intervalMs) return { status: 'pending' };
      flow.lastPollAt = Date.now();
      saveFlow(flowId, flow);
      const r = await pollDeviceToken(flow.deviceCode);
      if (r.status === 'pending') return { status: 'pending' };
      if (r.status === 'slow_down') {
        flow.intervalMs += 5000;
        saveFlow(flowId, flow);
        return { status: 'pending' };
      }
      if (r.status === 'expired') return end({ status: 'expired' });
      if (r.status === 'denied') {
        console.log(`[Яндекс вход по коду] отказ: ${r.error}`);
        return end({ status: 'denied', code: 'failed' });
      }
      accessToken = r.accessToken;
      // запоминаем токен: если профиль сейчас не получится, следующий опрос попробует снова
      flow.accessToken = accessToken;
      saveFlow(flowId, flow);
    }

    let profile;
    try {
      profile = await profileByToken(accessToken);
    } catch (e) {
      if (e instanceof HttpError) return end({ status: 'denied', code: 'failed' });
      console.log(`[Яндекс вход по коду] профиль пока не получен: ${(e as Error).message}`);
      return { status: 'pending' };
    }

    try {
      const userId = resolveUser(profile, flow.linkUserId);
      if (flow.linkUserId) {
        await notifyNewLogin(userId, 'к аккаунту привязан Яндекс (по коду)', req.headers['user-agent']);
        console.log('[Яндекс вход по коду] Яндекс привязан');
        return end({ status: 'ok', me: meOf(userId) });
      }
      // диспетчер и водитель видят все семьи — им вход по коду закрыт (код могут выманить мошенники)
      const roles = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()?.roles ?? [];
      if (roles.includes('dispatcher') || roles.includes('driver')) {
        console.log('[Яндекс вход по коду] отказ: сотрудник');
        return end({ status: 'denied', code: 'staff' });
      }
      setSessionCookie(reply, createSession(userId, req.headers['user-agent'], CODE_LOGIN_DAYS), CODE_LOGIN_DAYS);
      await notifyNewLogin(userId, 'вход через Яндекс по коду', req.headers['user-agent']);
      console.log('[Яндекс вход по коду] вход выполнен');
      return end({ status: 'ok', me: meOf(userId) });
    } catch (e) {
      console.log(`[Яндекс вход по коду] ошибка: ${(e as Error).message}`);
      return end({ status: 'denied', code: errCode(e) });
    }
  });
}

