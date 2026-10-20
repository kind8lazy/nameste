// Уведомления на телефон через Web Push — бесплатно, без аккаунтов Apple и Google.
// На iPhone работают, когда приложение добавлено на экран «Домой» (iOS 16.4+).
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newId } from '../lib/ids';
import type { Message, Priority } from '../../shared/messages';
import type { NotifyPrefs } from '../db/schema';

interface Vapid {
  publicKey: string;
  privateKey: string;
}

const vapidFile = path.join(config.dataDir, 'vapid.json');

function loadVapid(): Vapid {
  if (fs.existsSync(vapidFile)) return JSON.parse(fs.readFileSync(vapidFile, 'utf8')) as Vapid;
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

const vapid = loadVapid();
webpush.setVapidDetails(config.vapidSubject, vapid.publicKey, vapid.privateKey);

export const vapidPublicKey = vapid.publicKey;

export interface PushPayload {
  title: string;
  body: string;
  /** одинаковый tag заменяет прошлое уведомление — «живой статус» поездки на экране блокировки */
  tag?: string;
  url?: string;
  priority: Priority;
}

export function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  const existing = db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, sub.endpoint)).get();
  if (existing) {
    db.update(schema.pushSubscriptions)
      .set({ userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, failures: 0 })
      .where(eq(schema.pushSubscriptions.id, existing.id))
      .run();
    return;
  }
  db.insert(schema.pushSubscriptions)
    .values({ id: newId('ps'), userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) })
    .run();
}

export function hasSubscription(userId: string): boolean {
  return !!db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId)).get();
}

/** Отправить уведомление человеку на все его устройства. Результат пишется в журнал. */
export async function sendToUser(userId: string, payload: PushPayload, meta: { kind: string; rideId?: string }) {
  const subs = db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId)).all();
  const log = (status: 'sent' | 'failed' | 'no_device', error?: string) =>
    db.insert(schema.notifications)
      .values({ id: newId('n'), userId, rideId: meta.rideId, kind: meta.kind, channel: 'webpush', title: payload.title, body: payload.body, status, error })
      .run();
  if (!subs.length) {
    log('no_device');
    return;
  }
  const urgency = payload.priority === 'info' ? 'normal' : 'high';
  let delivered = false;
  let lastError = '';
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        TTL: payload.priority === 'info' ? 900 : 6 * 3600,
        urgency,
      });
      delivered = true;
      db.update(schema.pushSubscriptions).set({ lastOkAt: new Date(), failures: 0 }).where(eq(schema.pushSubscriptions.id, s.id)).run();
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      lastError = `${err.statusCode ?? ''} ${err.body ?? err.message ?? ''}`.trim();
      if (err.statusCode === 404 || err.statusCode === 410 || s.failures >= 5) {
        db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).run();
      } else {
        db.update(schema.pushSubscriptions).set({ failures: s.failures + 1 }).where(eq(schema.pushSubscriptions.id, s.id)).run();
      }
    }
  }
  log(delivered ? 'sent' : 'failed', delivered ? undefined : lastError.slice(0, 300));
}

const LEVEL_KINDS: Record<NotifyPrefs['level'], (kind: string) => boolean> = {
  all: () => true,
  key: (k) => ['boarded', 'handed_over', 'no_show', 'cancelled', 'delay', 'reminder'].includes(k),
  handover: (k) => k === 'handed_over',
};

/** Разослать сообщение членам семьи с учётом их настроек. */
export async function notifyFamily(familyId: string, kind: string, msg: Message, opts: { tag?: string; rideId?: string; url?: string } = {}) {
  const members = db.select().from(schema.familyMembers).where(eq(schema.familyMembers.familyId, familyId)).all();
  const targets = members.filter((m) => LEVEL_KINDS[m.notify?.level ?? 'all'](kind));
  await Promise.all(
    targets.map((m) =>
      sendToUser(m.userId, { title: msg.title, body: msg.body, priority: msg.priority, tag: opts.tag, url: opts.url ?? '/app' }, { kind, rideId: opts.rideId }),
    ),
  );
}

export async function notifyUsers(userIds: string[], kind: string, payload: PushPayload) {
  if (!userIds.length) return;
  await Promise.all(userIds.map((id) => sendToUser(id, payload, { kind })));
}

export function recentNotifications(userIds: string[], limit = 50) {
  if (!userIds.length) return [];
  return db
    .select()
    .from(schema.notifications)
    .where(inArray(schema.notifications.userId, userIds))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)
    .all();
}
