// Телеграм-бот «НА МЕСТЕ» для заявок новых семей.
//
// Работает отдельно от сайта: боевой сервер в России не достаёт до api.telegram.org, поэтому бот запускают там,
// где Телеграм доступен (зарубежный сервер, домашний сервер, Mac). Готовую заявку бот:
//   1) сразу присылает диспетчеру в Телеграм (TELEGRAM_ADMIN_CHAT_IDS);
//   2) передаёт в приложение — во «Входящие» диспетчера (APP_URL + LEADS_SECRET).
// Если сайт недоступен, заявка ждёт в очереди на диске и досылается раз в минуту — ничего не теряется.
//
// Запуск: npm run bot   (настройки — в bot.env, см. bot.env.example и docs/TELEGRAM-BOT.md)
import fs from 'node:fs';
import path from 'node:path';
import { handle, START, type Input, type Keyboard, type Lead, type State } from './dialog';
import { formatPhone } from '../shared/phone';

const root = path.resolve(import.meta.dirname, '..');
for (const f of [path.join(root, 'bot.env'), path.join(import.meta.dirname, 'bot.env')]) if (fs.existsSync(f)) process.loadEnvFile(f);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const API = `${(process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/$/, '')}/bot${TOKEN}`;
const ADMINS = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const APP_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');
const SECRET = process.env.LEADS_SECRET ?? '';
const DATA = path.resolve(root, process.env.BOT_DATA_DIR ?? 'data/bot');
const LIMIT_PER_DAY = 5;

if (!TOKEN) {
  console.error('Нет TELEGRAM_BOT_TOKEN. Создайте бота у @BotFather и впишите токен в bot.env (пример — bot.env.example).');
  process.exit(1);
}
if (!ADMINS.length) console.warn('TELEGRAM_ADMIN_CHAT_IDS не задан: заявки не будут приходить диспетчеру в Телеграм. Узнать номер чата — команда /id боту.');
if (!APP_URL || !SECRET) console.warn('APP_URL или LEADS_SECRET не заданы: заявки не будут попадать во «Входящие» приложения.');
fs.mkdirSync(DATA, { recursive: true });

// ——— хранение на диске: разговоры (чтобы перезапуск не обрывал заявку) и очередь отправки в приложение
const statesFile = path.join(DATA, 'states.json');
const queueFile = path.join(DATA, 'queue.json');
const sentFile = path.join(DATA, 'sent.json');
const readJson = <T>(f: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as T;
  } catch {
    return fallback;
  }
};
const writeJson = (f: string, v: unknown) => {
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v));
  fs.renameSync(`${f}.tmp`, f);
};
const states = new Map<string, State>(Object.entries(readJson<Record<string, State>>(statesFile, {})));
let queue = readJson<{ payload: Record<string, unknown>; tries: number }[]>(queueFile, []);
/** когда чат отправлял заявки — не больше LIMIT_PER_DAY в сутки, защита от спама */
const sent = readJson<Record<string, number[]>>(sentFile, {});
let saveTimer: NodeJS.Timeout | undefined;
const saveStates = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(statesFile, Object.fromEntries(states)), 500);
};

// ——— Bot API
async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(65_000) });
  const data = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

function markup(k: Keyboard): Record<string, unknown> {
  switch (k) {
    case 'start':
      return { inline_keyboard: [[{ text: 'Оставить заявку', callback_data: 'new' }]] };
    case 'contact':
      return { keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
    case 'skip':
      return { inline_keyboard: [[{ text: 'Пропустить', callback_data: 'skip' }]] };
    case 'confirm':
      return { inline_keyboard: [[{ text: '✅ Отправить', callback_data: 'send' }, { text: 'Исправить', callback_data: 'edit' }]] };
    default:
      return { remove_keyboard: true };
  }
}

const say = (chatId: string, text: string, k: Keyboard = 'none') => tg('sendMessage', { chat_id: chatId, text, reply_markup: markup(k), disable_web_page_preview: true });

// ——— готовая заявка
function adminText(lead: Lead, username?: string) {
  return [
    '🆕 Заявка из Телеграма',
    `👤 ${lead.name}, ${formatPhone(lead.phone) || lead.phone}${username ? ` · @${username}` : ''}`,
    `🧒 ${lead.children}`,
    `📍 ${lead.fromText} → ${lead.toText}`,
    `🕒 ${lead.schedule}`,
    lead.comment ? `💬 ${lead.comment}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function deliver(payload: Record<string, unknown>): Promise<boolean> {
  if (!APP_URL || !SECRET) return true; // приложение не подключено — хватит сообщения диспетчеру
  try {
    const res = await fetch(`${APP_URL}/api/leads`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-secret': SECRET }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    if (res.ok) return true;
    // 400 — заявка не прошла проверку: повторять бессмысленно, диспетчер её уже видел в Телеграме
    if (res.status === 400) {
      console.error('Приложение отклонило заявку:', await res.text());
      return true;
    }
    console.error('Приложение не приняло заявку:', res.status);
  } catch (e) {
    console.error('Сайт недоступен, заявка подождёт в очереди:', (e as Error).message);
  }
  return false;
}

async function flushQueue() {
  if (!queue.length) return;
  const left: typeof queue = [];
  for (const item of queue) if (!(await deliver(item.payload))) left.push({ ...item, tries: item.tries + 1 });
  queue = left;
  writeJson(queueFile, queue);
}

async function submit(chatId: string, username: string | undefined, lead: Lead) {
  const payload = { externalId: `tg-${chatId}-${Date.now()}`, tgChatId: chatId, ...(username ? { tgUsername: username } : {}), ...lead };
  for (const admin of ADMINS) await say(admin, adminText(lead, username)).catch((e) => console.error('Не дошло диспетчеру', admin, (e as Error).message));
  if (!(await deliver(payload))) {
    queue.push({ payload, tries: 1 });
    writeJson(queueFile, queue);
  }
}

// ——— входящие сообщения
interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string }; from?: { id: number; username?: string }; text?: string; contact?: { phone_number: string; user_id?: number } };
  callback_query?: { id: string; from: { id: number; username?: string }; message?: { chat: { id: number; type: string } }; data?: string };
}

async function onUpdate(u: Update) {
  const chat = u.message?.chat ?? u.callback_query?.message?.chat;
  if (!chat || chat.type !== 'private') return; // заявки — только в личной переписке с ботом
  const chatId = String(chat.id);
  const from = u.message?.from ?? u.callback_query?.from;

  if (u.callback_query) await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id }).catch(() => {});

  // /id — номер этого чата: его вписывают в TELEGRAM_ADMIN_CHAT_IDS, чтобы получать заявки
  if (u.message?.text?.trim() === '/id') return void (await say(chatId, `Номер этого чата: ${chatId}`));

  const input: Input = {};
  if (u.message?.text) input.text = u.message.text;
  // номер берём из кнопки, только если человек отправил свой собственный контакт
  if (u.message?.contact && (!u.message.contact.user_id || u.message.contact.user_id === from?.id)) input.contactPhone = u.message.contact.phone_number;
  const data = u.callback_query?.data;
  if (data === 'new' || data === 'send' || data === 'edit' || data === 'skip') input.button = data;

  const before = states.get(chatId) ?? START;
  if (input.button === 'send' && before.step === 'confirm') {
    const now = Date.now();
    const recent = (sent[chatId] ?? []).filter((t) => now - t < 864e5);
    if (recent.length >= LIMIT_PER_DAY) return void (await say(chatId, 'Сегодня вы уже отправили несколько заявок. Диспетчер свяжется с вами — или напишите позже.'));
    sent[chatId] = [...recent, now];
    writeJson(sentFile, sent);
  }

  const { state, replies, lead } = handle(before, input);
  states.set(chatId, state);
  saveStates();
  if (lead) await submit(chatId, from?.username, lead);
  for (const r of replies) await say(chatId, r.text, r.keyboard);
}

// ——— длинный опрос Телеграма: вебхук и свой домен не нужны
let offset = 0;
let running = true;
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    running = false;
    writeJson(statesFile, Object.fromEntries(states));
    process.exit(0);
  });

const me = await tg<{ username: string }>('getMe', {}).catch((e) => {
  console.error('Телеграм не отвечает или неверный токен:', (e as Error).message);
  process.exit(1);
});
await tg('setMyCommands', { commands: [{ command: 'new', description: 'Оставить заявку' }, { command: 'cancel', description: 'Отменить заявку' }] }).catch(() => {});
console.log(`Бот @${me.username} запущен. Диспетчеров: ${ADMINS.length}. Приложение: ${APP_URL || 'не подключено'}.`);
setInterval(() => void flushQueue(), 60_000).unref();
void flushQueue();

while (running) {
  try {
    const updates = await tg<Update[]>('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
    for (const u of updates) {
      offset = u.update_id + 1;
      await onUpdate(u).catch((e) => console.error('Ошибка в разговоре:', (e as Error).message));
    }
  } catch (e) {
    console.error('Нет связи с Телеграмом, повтор через 5 секунд:', (e as Error).message);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
