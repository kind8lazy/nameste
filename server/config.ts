import path from 'node:path';
import fs from 'node:fs';
import { normalizePhone } from '../shared/phone';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
// ключи внешних сервисов (Яндекс, SMS) лежат отдельно и в git не попадают
const secretsFile = path.join(root, 'secrets.env');
if (fs.existsSync(secretsFile)) process.loadEnvFile(secretsFile);
// secrets.env читается первым: его значения главнее, чем в .env
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  root,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: path.resolve(root, process.env.DATA_DIR ?? 'data'),
  get dbFile() {
    return process.env.DB_FILE ?? path.join(this.dataDir, 'na-meste.db');
  },
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  isProd: process.env.NODE_ENV === 'production',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'https://na-meste.invalid',
  osrmUrl: (process.env.OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, ''),
  nominatimUrl: (process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
  /** Представляемся бесплатным сервисам карт так, как требуют их правила. */
  userAgent: 'NaMeste/0.1 (child transport pilot, St Petersburg)',
  sessionDays: 180,
  /**
   * Простой режим: видны только имена детей, маршруты, календарь, имена родителей и сообщения.
   * Карта, слежение за машиной, цены, ссылка для близких и демо скрыты и на сервере закрыты.
   */
  liteMode: process.env.LITE_MODE === '1',
  /** Демо-режим: вход кнопкой за демо-маму, демо-бабушку и демо-водителя. Выключить, когда появятся настоящие клиенты. */
  demoMode: process.env.DEMO_MODE === '1',
  /** Ключ демо-входа: если задан, демо-кнопки видны только по ссылке /login?demo=КЛЮЧ. Нужен, когда адрес открыт в интернет. */
  demoKey: process.env.DEMO_KEY ?? '',
  /** Вход через Яндекс ID. Приложение регистрируется на oauth.yandex.ru. */
  yandex: {
    clientId: process.env.YANDEX_CLIENT_ID ?? '',
    clientSecret: process.env.YANDEX_CLIENT_SECRET ?? '',
    /** YANDEX_LOGIN=0 — вход только по кодам диспетчера (например, на время тестирования). */
    get enabled() {
      return process.env.YANDEX_LOGIN !== '0' && !!(this.clientId && this.clientSecret);
    },
  },
  /**
   * SMS родителям. provider: none — выключено, log — только запись в журнал (проверка без денег),
   * yandex — Yandex Cloud Notification Service, smsru — сервис sms.ru. events — какие события слать по SMS.
   */
  sms: {
    // в демо-режиме настоящие SMS не уходят: телефоны там выдуманные и могут принадлежать чужим людям
    provider: (process.env.DEMO_MODE === '1' && process.env.SMS_PROVIDER && process.env.SMS_PROVIDER !== 'none' ? 'log' : (process.env.SMS_PROVIDER ?? 'none')) as 'none' | 'log' | 'yandex' | 'smsru',
    // Yandex Cloud Notification Service: статический ключ сервисного аккаунта
    ycKeyId: process.env.YC_SMS_KEY_ID ?? '',
    ycSecret: process.env.YC_SMS_SECRET ?? '',
    smsruApiId: process.env.SMSRU_API_ID ?? '',
    sender: process.env.SMS_SENDER ?? '',
    testMode: process.env.SMS_TEST === '1',
    events: (process.env.SMS_EVENTS ?? 'handed_over').split(',').map((x) => x.trim()).filter(Boolean),
  },
  /**
   * Письма родителям на почту из Яндекс ID. provider: none — выключено, log — только запись в журнал,
   * smtp — отправка через почтовый ящик (для Яндекс Почты: smtp.yandex.ru, порт 465, пароль приложения).
   */
  mail: {
    provider: (process.env.DEMO_MODE === '1' && process.env.MAIL_PROVIDER && process.env.MAIL_PROVIDER !== 'none' ? 'log' : (process.env.MAIL_PROVIDER ?? 'none')) as 'none' | 'log' | 'smtp',
    host: process.env.SMTP_HOST ?? 'smtp.yandex.ru',
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    fromName: process.env.MAIL_FROM_NAME ?? 'НА МЕСТЕ',
    events: (process.env.MAIL_EVENTS ?? 'handed_over').split(',').map((x) => x.trim()).filter(Boolean),
  },
  /** Телефоны, которые при первом входе через Яндекс получают роли диспетчера и водителя. */
  // «8 921…», «+7 921…» и «921…» — один и тот же номер
  adminPhones: (process.env.ADMIN_PHONES ?? '').split(',').map((x) => normalizePhone(x)).filter((x): x is string => !!x),
};

fs.mkdirSync(config.dataDir, { recursive: true });
