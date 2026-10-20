// Вход без платных SMS: код приглашения от диспетчера и перенос входа на другое устройство.
// На iPhone приложение с экрана «Домой» не видит вход, сделанный в Safari, поэтому
// код вводится уже внутри установленного приложения.
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/client';
import { config } from '../config';
import { digitCode, newToken, sha256 } from '../lib/ids';
import { localTime } from '../../shared/time';
import type { Role } from '../../shared/domain';

export const SESSION_COOKIE = 'nm_s';

export interface SessionUser {
  id: string;
  name: string;
  phone: string | null;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ——— демо-аккаунты ———

/** Демо-аккаунты из npm run seed. Вне демо-режима они не входят и не могут ничего привязать. */
export function demoUserIds(): string[] {
  const row = db.select().from(schema.kv).where(eq(schema.kv.key, 'demo_users')).get();
  if (!row) return [];
  try {
    return Object.values(JSON.parse(row.value) as Record<string, string>);
  } catch {
    return [];
  }
}

export function isDemoUser(userId: string | undefined | null): boolean {
  return !!userId && demoUserIds().includes(userId);
}

/** При запуске без демо-режима гасим всё, что осталось от демо: сессии, коды входа, привязки Яндекса. */
export function enforceDemoPolicy(log: (m: string) => void) {
  if (config.demoMode) return;
  const ids = demoUserIds();
  if (!ids.length) return;
  db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids)).run();
  db.delete(schema.loginCodes).where(inArray(schema.loginCodes.userId, ids)).run();
  db.update(schema.users).set({ yandexId: null }).where(inArray(schema.users.id, ids)).run();
  log('Демо-режим выключен: сессии и коды демо-аккаунтов удалены');
}

// ——— ограничение попыток ———

/** Ключ для лимита: IPv4 целиком, IPv6 — по подсети /64 (у одного абонента их миллионы). */
export function rateKey(ip: string): string {
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
  return ip.split(':').slice(0, 4).join(':');
}

class Limiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  /** true — лимит превышен */
  hit(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.until < now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return false;
    }
    h.n++;
    return h.n > this.max;
  }
  sweep() {
    const now = Date.now();
    for (const [k, h] of this.hits) if (h.until < now) this.hits.delete(k);
  }
}

// 10 попыток кода за 15 минут с одного адреса
const perAddress = new Limiter(10, 15 * 60_000);
// и не больше 30 неудачных попыток за 10 минут на весь сервер — перебор с тысяч адресов не пройдёт
const globalFailures = new Limiter(30, 10 * 60_000);
let lockedUntil = 0;

export const limiters = { perAddress, globalFailures };
export function sweepLimiters() {
  perAddress.sweep();
  globalFailures.sweep();
}

// ——— коды входа ———

export function createLoginCode(userId: string, kind: 'invite' | 'device', createdBy?: string): { code: string; expiresAt: Date } {
  if (isDemoUser(userId) && !config.demoMode) throw new HttpError(403, 'Демо-аккаунт недоступен');
  const length = kind === 'invite' ? 8 : 6;
  // новый код отменяет прежний того же вида: так выданный по ошибке или утёкший код можно погасить
  db.delete(schema.loginCodes).where(and(eq(schema.loginCodes.userId, userId), eq(schema.loginCodes.kind, kind))).run();
  // приглашение: 3 дня и 2 входа (Safari + приложение с экрана «Домой»); код для другого устройства: 10 минут, 1 вход
  const ttlMs = kind === 'invite' ? 3 * 86_400_000 : 10 * 60_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = digitCode(length);
    const exists = db.select().from(schema.loginCodes).where(eq(schema.loginCodes.code, code)).get();
    if (exists) continue;
    const expiresAt = new Date(Date.now() + ttlMs);
    db.insert(schema.loginCodes)
      .values({ code, userId, kind, createdBy, expiresAt, maxUses: kind === 'invite' ? 2 : 1 })
      .run();
    return { code, expiresAt };
  }
  throw new HttpError(500, 'Не удалось создать код, попробуйте ещё раз');
}

/** После привязки Яндекса неиспользованные приглашения человека больше не нужны. */
export function revokeInvites(userId: string) {
  db.delete(schema.loginCodes)
    .where(and(eq(schema.loginCodes.userId, userId), eq(schema.loginCodes.kind, 'invite')))
    .run();
}

export function redeemCode(rawCode: string, ip: string, userAgent?: string): { token: string; user: SessionUser } {
  if (Date.now() < lockedUntil) throw new HttpError(429, 'Вход по коду временно закрыт из-за подозрительных попыток. Попробуйте через 10 минут или войдите через Яндекс.');
  if (perAddress.hit(rateKey(ip))) throw new HttpError(429, 'Слишком много попыток. Подождите 15 минут.');
  const code = rawCode.replace(/\D/g, '');
  const row = db
    .select()
    .from(schema.loginCodes)
    .where(and(eq(schema.loginCodes.code, code), gt(schema.loginCodes.expiresAt, new Date())))
    .get();
  if (!row || row.uses >= row.maxUses || (isDemoUser(row.userId) && !config.demoMode)) {
    if (globalFailures.hit('all')) {
      lockedUntil = Date.now() + 10 * 60_000;
      console.log('[Вход по коду] слишком много неудачных попыток — вход по коду закрыт на 10 минут');
    }
    throw new HttpError(400, 'Код не подходит или устарел. Код для другого устройства получите в разделе «Семья», приглашение — у диспетчера.');
  }
  db.update(schema.loginCodes)
    .set({ uses: row.uses + 1 })
    .where(eq(schema.loginCodes.code, code))
    .run();
  const user = db.select().from(schema.users).where(eq(schema.users.id, row.userId)).get();
  if (!user) throw new HttpError(400, 'Пользователь не найден');
  const token = createSession(user.id, userAgent);
  return { token, user: pickUser(user) };
}

// ——— сессии ———

export function createSession(userId: string, userAgent?: string, days = config.sessionDays): string {
  const token = newToken();
  db.insert(schema.sessions)
    .values({
      idHash: sha256(token),
      userId,
      userAgent: userAgent?.slice(0, 300),
      expiresAt: new Date(Date.now() + days * 86_400_000),
    })
    .run();
  return token;
}

export function destroySession(token: string) {
  db.delete(schema.sessions).where(eq(schema.sessions.idHash, sha256(token))).run();
}

/** «Выйти на всех устройствах»: например, если пришло уведомление о чужом входе. */
export function destroyAllSessions(userId: string) {
  db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
  db.delete(schema.loginCodes).where(and(eq(schema.loginCodes.userId, userId), eq(schema.loginCodes.kind, 'device'))).run();
}

function pickUser(u: typeof schema.users.$inferSelect): SessionUser {
  return { id: u.id, name: u.name, phone: u.phone, roles: u.roles };
}

export function userFromToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.idHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .get();
  if (!row) return null;
  // демо-сессия вне демо-режима не действует, даже если ещё не истекла
  if (!config.demoMode && isDemoUser(row.user.id)) return null;
  const last = row.session.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - last > 3_600_000) {
    db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.idHash, row.session.idHash)).run();
  }
  return pickUser(row.user);
}

export function cleanupAuth() {
  const now = new Date();
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run();
  db.delete(schema.loginCodes).where(lt(schema.loginCodes.expiresAt, now)).run();
  sweepLimiters();
}

export function setSessionCookie(reply: FastifyReply, token: string, days = config.sessionDays) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    maxAge: days * 86_400,
  });
}

/** «iPhone, Safari» — чтобы человек узнал своё устройство в уведомлении о входе. */
export function describeDevice(ua: string | undefined): string {
  const s = ua ?? '';
  const device = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : 'устройство';
  const browser = /YaBrowser/.test(s) ? 'Яндекс Браузер' : /Firefox|FxiOS/.test(s) ? 'Firefox' : /Edg\//.test(s) ? 'Edge' : /Chrome|CriOS/.test(s) ? 'Chrome' : /Safari/.test(s) ? 'Safari' : 'браузер';
  return `${device}, ${browser}`;
}

/** Текст уведомления о новом входе — уходит на уже привязанные устройства и на почту. */
export function newLoginMessage(via: string, ua: string | undefined) {
  return {
    title: 'Новый вход в НА МЕСТЕ',
    body: `${localTime()} · ${via} · ${describeDevice(ua)}. Если это не вы — откройте приложение → «Семья» → «Выйти на всех устройствах» и позвоните диспетчеру.`,
  };
}

// ——— проверки доступа ———

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Нужно войти');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const u = requireUser(req);
  if (!roles.some((r) => u.roles.includes(r))) throw new HttpError(403, 'Нет доступа к этому разделу');
  return u;
}

export function familyIdsOf(userId: string): string[] {
  return db
    .select({ id: schema.familyMembers.familyId })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.userId, userId))
    .all()
    .map((r) => r.id);
}
