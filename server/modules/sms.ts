// SMS родителям. Провайдер спрятан за одной функцией: сменить сервис — поменять только этот файл.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { config } from '../config';
import { newId } from '../lib/ids';
import { normalizePhone } from '../../shared/phone';
import { signV4 } from '../lib/sigv4';
import type { NotifyPrefs } from '../db/schema';

export interface SmsResult {
  ok: boolean;
  error?: string;
}

export function smsEnabled() {
  return config.sms.provider !== 'none';
}

async function sendViaSmsRu(to: string, text: string): Promise<SmsResult> {
  const params = new URLSearchParams({ api_id: config.sms.smsruApiId, to, msg: text, json: '1' });
  if (config.sms.sender) params.set('from', config.sms.sender);
  if (config.sms.testMode) params.set('test', '1');
  const res = await fetch(`https://sms.ru/sms/send?${params}`, { signal: AbortSignal.timeout(10_000) });
  const data = (await res.json()) as { status: string; status_text?: string; sms?: Record<string, { status: string; status_text?: string }> };
  const one = data.sms?.[to];
  if (data.status === 'OK' && one?.status === 'OK') return { ok: true };
  return { ok: false, error: one?.status_text ?? data.status_text ?? 'сервис SMS вернул ошибку' };
}

const YC_HOST = 'notifications.yandexcloud.net';
const YC_ERRORS: Record<string, string> = {
  SMSSandboxNumberNotVerified: 'номер не подтверждён в Яндексе: добавьте его как тестовый в канале SMS и введите код из SMS',
  WrongSMSChannelState: 'канал SMS в Яндексе ещё не готов к отправке',
  SMSChannelIsBanned: 'канал SMS в Яндексе заблокирован',
  InvalidPhoneNumberRegion: 'Яндекс отправляет SMS только на российские номера',
  MessageLimitExceeded: 'исчерпан месячный лимит SMS в Яндексе',
  InvalidClientTokenId: 'неверный ключ доступа Яндекса',
  SignatureDoesNotMatch: 'неверный секретный ключ Яндекса',
  AccessDenied: 'у сервисного аккаунта Яндекса нет прав на отправку SMS',
  PermissionDenied: 'у сервисного аккаунта Яндекса нет прав на отправку SMS',
  Unauthenticated: 'Яндекс не принял ключ доступа: проверьте YC_SMS_KEY_ID и YC_SMS_SECRET',
};

/** Yandex Cloud Notification Service: API совместим с Amazon SNS, действие Publish. */
async function sendViaYandex(to: string, text: string): Promise<SmsResult> {
  const form = new URLSearchParams({ Action: 'Publish', PhoneNumber: `+${to}`, Message: text, ResponseFormat: 'JSON' });
  if (config.sms.sender) {
    form.set('MessageAttributes.entry.1.key', 'AWS.SNS.SMS.SenderID');
    form.set('MessageAttributes.entry.1.value', JSON.stringify({ DataType: 'String', StringValue: config.sms.sender }));
  }
  const body = form.toString();
  const contentType = 'application/x-www-form-urlencoded; charset=utf-8';
  const headers = signV4({ method: 'POST', host: YC_HOST, body, contentType, accessKeyId: config.sms.ycKeyId, secretKey: config.sms.ycSecret, region: 'ru-central1', service: 'sns' });
  const res = await fetch(`https://${YC_HOST}/`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
  if (res.ok) return { ok: true };
  const raw = await res.text();
  const known = Object.keys(YC_ERRORS).find((k) => raw.includes(k));
  return { ok: false, error: known ? YC_ERRORS[known] : `Яндекс ответил ${res.status}: ${raw.replace(/\s+/g, ' ').slice(0, 200)}` };
}

/** Отправить одно SMS. Никогда не бросает исключение — поездка не должна ломаться из-за SMS. */
export async function sendSms(rawPhone: string, text: string): Promise<SmsResult> {
  const to = normalizePhone(rawPhone);
  if (!to) return { ok: false, error: 'неверный номер телефона' };
  try {
    if (config.sms.provider === 'log') {
      console.log(`[SMS, проверка без отправки] ${to}: ${text}`);
      return { ok: true };
    }
    if (config.sms.provider === 'yandex') {
      if (!config.sms.ycKeyId || !config.sms.ycSecret) return { ok: false, error: 'не заданы ключи YC_SMS_KEY_ID и YC_SMS_SECRET' };
      if (config.sms.testMode) {
        console.log(`[SMS, тестовый режим — в Яндекс не отправлено] ${to}: ${text}`);
        return { ok: true };
      }
      return await sendViaYandex(to, text);
    }
    if (config.sms.provider === 'smsru') {
      if (!config.sms.smsruApiId) return { ok: false, error: 'не задан ключ SMSRU_API_ID' };
      return await sendViaSmsRu(to, text);
    }
    return { ok: false, error: 'SMS выключены' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const LEVEL_KINDS: Record<NotifyPrefs['level'], (kind: string) => boolean> = {
  all: () => true,
  key: (k) => ['boarded', 'handed_over', 'no_show'].includes(k),
  handover: (k) => k === 'handed_over',
};

/** SMS членам семьи, у которых указан телефон. Одному номеру — одно сообщение. Всё пишется в журнал. */
export async function smsFamily(familyId: string, kind: string, text: string, rideId?: string) {
  if (!smsEnabled() || !config.sms.events.includes(kind)) return;
  const members = db
    .select({ m: schema.familyMembers, u: schema.users })
    .from(schema.familyMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
    .where(eq(schema.familyMembers.familyId, familyId))
    .all();
  const seen = new Set<string>();
  for (const { m, u } of members) {
    const phone = normalizePhone(u.phone);
    if (!phone || seen.has(phone) || !LEVEL_KINDS[m.notify?.level ?? 'all'](kind)) continue;
    seen.add(phone);
    const r = await sendSms(phone, text);
    db.insert(schema.notifications)
      .values({ id: newId('n'), userId: u.id, rideId, kind, channel: 'sms', title: text, body: '', status: r.ok ? 'sent' : 'failed', error: r.error })
      .run();
  }
}
