// Вход через Яндекс ID (OAuth). Тот же аккаунт родители используют в LeStart.
// Человека узнаём так: 1) Яндекс уже привязан; 2) совпал телефон, который диспетчер записал в семью;
// 3) иначе создаём «ожидающего» — диспетчер привяжет его к семье.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newId, newToken } from '../lib/ids';
import { HttpError, isDemoUser, demoUserIds, revokeInvites } from './auth';
import { normalizePhone, strictIntlPhone } from '../../shared/phone';

export const redirectUri = () => `${config.publicUrl}/api/auth/yandex/callback`;

export function authorizeUrl(state: string) {
  const q = new URLSearchParams({ response_type: 'code', client_id: config.yandex.clientId, redirect_uri: redirectUri(), state });
  return `https://oauth.yandex.ru/authorize?${q}`;
}

export interface YandexProfile {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

async function postForm(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** Обменять код из адреса возврата на токен и профиль (обычный вход с перенаправлением). */
export async function fetchProfile(code: string): Promise<YandexProfile> {
  const token = await postForm('https://oauth.yandex.ru/token', {
    grant_type: 'authorization_code',
    code,
    client_id: config.yandex.clientId,
    client_secret: config.yandex.clientSecret,
  });
  if (typeof token.access_token !== 'string') {
    throw new HttpError(400, `Яндекс не подтвердил вход${token.error_description ? `: ${token.error_description}` : ''}`);
  }
  return profileByToken(token.access_token);
}

export async function profileByToken(accessToken: string): Promise<YandexProfile> {
  const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const info = (await infoRes.json()) as {
    id: string;
    login?: string;
    real_name?: string;
    display_name?: string;
    first_name?: string;
    default_phone?: { number?: string };
    default_email?: string;
  };
  if (!info.id) throw new HttpError(400, 'Яндекс не вернул данные профиля');
  return {
    id: String(info.id),
    name: info.real_name || info.first_name || info.display_name || info.login || 'Без имени',
    phone: strictIntlPhone(info.default_phone?.number),
    email: info.default_email?.trim().toLowerCase() || null,
  };
}

// ——— вход по коду (как на телевизорах): без возврата из браузера ———
// Нужен на iPhone: приложение с экрана «Домой» и Safari не видят вход друг друга,
// а ещё выручает, когда страница Яндекса не возвращает человека обратно (VPN, расширения).

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
}

export async function requestDeviceCode(deviceId: string): Promise<DeviceCode> {
  const r = await postForm('https://oauth.yandex.ru/device/code', {
    client_id: config.yandex.clientId,
    device_id: deviceId,
    // имя видно на странице подтверждения Яндекса — напоминаем, что код должен быть с экрана самого человека
    device_name: 'НА МЕСТЕ — вход по коду с вашего экрана',
  });
  if (typeof r.device_code !== 'string' || typeof r.user_code !== 'string') {
    throw new HttpError(502, `Яндекс не выдал код входа${r.error_description ? `: ${r.error_description}` : r.error ? `: ${r.error}` : ''}`);
  }
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUrl: typeof r.verification_url === 'string' ? r.verification_url : 'https://ya.ru/device',
    interval: Number(r.interval ?? 5),
    expiresIn: Number(r.expires_in ?? 300),
  };
}

export type DevicePoll = { status: 'pending' } | { status: 'slow_down' } | { status: 'expired' } | { status: 'denied'; error: string } | { status: 'ok'; accessToken: string };

/** Один опрос: подтвердил ли человек код в Яндексе. */
export async function pollDeviceToken(deviceCode: string): Promise<DevicePoll> {
  const r = await postForm('https://oauth.yandex.ru/token', {
    grant_type: 'device_code',
    code: deviceCode,
    client_id: config.yandex.clientId,
    client_secret: config.yandex.clientSecret,
  });
  if (typeof r.access_token === 'string') return { status: 'ok', accessToken: r.access_token };
  const err = String(r.error ?? '');
  if (err === 'authorization_pending') return { status: 'pending' };
  if (err === 'slow_down') return { status: 'slow_down' };
  // истёкший или неверный код Яндекс возвращает как invalid_grant (expired_token он не использует)
  if (err === 'invalid_grant' || err === 'expired_token' || err === 'bad_verification_code') return { status: 'expired' };
  return { status: 'denied', error: String(r.error_description ?? err ?? 'неизвестная ошибка') };
}

/** Найти или создать пользователя по профилю Яндекса. currentUserId — если человек уже вошёл и привязывает Яндекс. */
export function resolveUser(profile: YandexProfile, currentUserId?: string): string {
  const demo = new Set(demoUserIds());
  const linked = db.select().from(schema.users).where(eq(schema.users.yandexId, profile.id)).get();
  if (linked && demo.has(linked.id)) throw new HttpError(409, 'Этот Яндекс привязан к демо-аккаунту. Обратитесь к диспетчеру.');

  const link = (userId: string) => {
    const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!u) throw new HttpError(404, 'Пользователь не найден');
    // уже привязанный Яндекс молча не заменяем: перепривязку делает только диспетчер
    if (u.yandexId && u.yandexId !== profile.id) throw new HttpError(409, 'К этому аккаунту уже привязан другой Яндекс. Обратитесь к диспетчеру.');
    // телефон из ADMIN_PHONES даёт права диспетчера и водителя — и при первом входе, и при привязке
    const isAdmin = !!profile.phone && config.adminPhones.includes(profile.phone);
    const roles = isAdmin ? [...new Set([...u.roles, 'driver' as const, 'dispatcher' as const])] : u.roles;
    db.update(schema.users)
      .set({ yandexId: profile.id, email: u.email || profile.email, roles })
      .where(eq(schema.users.id, userId))
      .run();
    if (isAdmin && !db.select().from(schema.drivers).where(eq(schema.drivers.userId, userId)).get()) {
      db.insert(schema.drivers).values({ userId, trackerToken: newToken(12) }).run();
    }
    revokeInvites(userId);
    return userId;
  };

  if (currentUserId) {
    if (isDemoUser(currentUserId)) throw new HttpError(403, 'В демо-режиме привязка Яндекса недоступна.');
    if (linked && linked.id !== currentUserId) throw new HttpError(409, 'Этот Яндекс уже привязан к другому человеку. Обратитесь к диспетчеру.');
    return link(currentUserId);
  }
  if (linked) return link(linked.id);

  // телефон в Яндексе подтверждён — по нему находим человека, которого завёл диспетчер (демо-аккаунты не в счёт)
  const candidates = db.select().from(schema.users).all().filter((u) => !u.yandexId && !demo.has(u.id));
  if (profile.phone) {
    const byPhone = candidates.filter((u) => normalizePhone(u.phone) === profile.phone);
    if (byPhone.length === 1) return link(byPhone[0].id);
  }
  // или по почте, которую диспетчер записал в семью
  if (profile.email) {
    const byEmail = candidates.filter((u) => u.email?.trim().toLowerCase() === profile.email);
    if (byEmail.length === 1) return link(byEmail[0].id);
  }

  const id = newId('u');
  const isAdmin = !!profile.phone && config.adminPhones.includes(profile.phone);
  db.insert(schema.users)
    .values({ id, name: profile.name, phone: profile.phone ? `+${profile.phone}` : null, email: profile.email, roles: isAdmin ? ['driver', 'dispatcher'] : ['parent'], yandexId: profile.id })
    .run();
  if (isAdmin) db.insert(schema.drivers).values({ userId: id, trackerToken: newToken(12) }).run();
  return id;
}
