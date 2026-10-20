// Письма родителям на почту из Яндекс ID. У Яндекс ID нет своей доставки сообщений,
// поэтому «сообщение через Яндекс» — это письмо в Яндекс Почту человека. Бесплатно.
import nodemailer from 'nodemailer';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newId } from '../lib/ids';
import type { NotifyPrefs } from '../db/schema';

export interface MailResult {
  ok: boolean;
  error?: string;
}

export function mailEnabled() {
  return config.mail.provider !== 'none';
}

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: { user: config.mail.user, pass: config.mail.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

const isEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Отправить одно письмо. Никогда не бросает исключение — поездка не должна ломаться из-за почты. */
export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  if (!isEmail(to)) return { ok: false, error: 'неверный адрес почты' };
  const body = `${text}\n\n—\nНА МЕСТЕ · развозка детей\n${config.publicUrl}`;
  try {
    if (config.mail.provider === 'log') {
      console.log(`[Письмо, проверка без отправки] ${to}: ${subject} | ${text}`);
      return { ok: true };
    }
    if (config.mail.provider === 'smtp') {
      if (!config.mail.user || !config.mail.pass) return { ok: false, error: 'не заданы SMTP_USER и SMTP_PASS' };
      await getTransport().sendMail({ from: { name: config.mail.fromName, address: config.mail.user }, to, subject, text: body });
      return { ok: true };
    }
    return { ok: false, error: 'письма выключены' };
  } catch (e) {
    const msg = (e as Error).message;
    if (/535|auth/i.test(msg)) return { ok: false, error: 'почта не приняла пароль: нужен пароль приложения для почты, а не пароль от аккаунта' };
    return { ok: false, error: msg.slice(0, 200) };
  }
}

const LEVEL_KINDS: Record<NotifyPrefs['level'], (kind: string) => boolean> = {
  all: () => true,
  key: (k) => ['boarded', 'handed_over', 'no_show', 'cancelled'].includes(k),
  handover: (k) => k === 'handed_over',
};

/** Письмо членам семьи, у которых есть почта. Одному адресу — одно письмо. Всё пишется в журнал. */
export async function emailFamily(familyId: string, kind: string, subject: string, text: string, rideId?: string) {
  if (!mailEnabled() || !config.mail.events.includes(kind)) return;
  const members = db
    .select({ m: schema.familyMembers, u: schema.users })
    .from(schema.familyMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
    .where(eq(schema.familyMembers.familyId, familyId))
    .all();
  const seen = new Set<string>();
  for (const { m, u } of members) {
    const email = u.email?.trim().toLowerCase();
    if (!isEmail(email) || seen.has(email) || !LEVEL_KINDS[m.notify?.level ?? 'all'](kind)) continue;
    seen.add(email);
    const r = await sendMail(email, subject, text);
    db.insert(schema.notifications)
      .values({ id: newId('n'), userId: u.id, rideId, kind, channel: 'email', title: subject, body: text, status: r.ok ? 'sent' : 'failed', error: r.error })
      .run();
  }
}
