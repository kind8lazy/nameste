// Разговор бота с новой семьёй: короткие вопросы по одному, в конце — проверка и «Отправить».
// Чистая логика без сети: на вход — состояние и что прислал человек, на выход — новое состояние,
// ответы бота и (когда человек подтвердил) готовая заявка. Так разговор легко проверить тестами.
import { normalizePhone, formatPhone } from '../shared/phone';

export type Step = 'idle' | 'name' | 'phone' | 'children' | 'from' | 'to' | 'schedule' | 'comment' | 'confirm';

export interface Draft {
  name?: string;
  phone?: string;
  children?: string;
  fromText?: string;
  toText?: string;
  schedule?: string;
  comment?: string;
}

export interface State {
  step: Step;
  draft: Draft;
}

/** Клавиатура под сообщением бота. */
export type Keyboard = 'start' | 'contact' | 'skip' | 'confirm' | 'none';

export interface Reply {
  text: string;
  keyboard: Keyboard;
}

export interface Input {
  /** обычный текст или команда (/start, /new, /cancel) */
  text?: string;
  /** номер из кнопки «Отправить номер» — Телеграм его подтвердил */
  contactPhone?: string;
  /** нажатие кнопки под сообщением */
  button?: 'new' | 'send' | 'edit' | 'skip';
}

export interface Lead extends Required<Omit<Draft, 'comment'>> {
  comment?: string;
}

export const START: State = { step: 'idle', draft: {} };

const MAX = 300;

export const TEXT = {
  hello: 'Здравствуйте! Это «НА МЕСТЕ» — развозка детей по Петербургу.\n\nОставьте заявку — диспетчер перезвонит и всё согласует.',
  name: 'Как к вам обращаться?',
  phone: 'Ваш телефон для связи. Нажмите кнопку ниже или напишите номер.',
  phoneBad: 'Не получилось разобрать номер. Напишите его так: +7 921 123-45-67',
  children: 'Кого возим? Имя и класс, например: «Маша, 4 класс». Если детей несколько — через запятую.',
  from: 'Откуда забирать? Адрес или место, например: «Школа № 56, Петроградская».',
  to: 'Куда отвозить?',
  schedule: 'Когда? Дни и время, например: «пн, ср, пт в 14:20» или «разово 12 ноября в 9:00».',
  comment: 'Что ещё важно знать? Например: бустер, передать тренеру. Или нажмите «Пропустить».',
  tooLong: `Слишком длинно — уложитесь, пожалуйста, в ${MAX} символов.`,
  empty: 'Напишите, пожалуйста, ответ текстом.',
  sent: 'Спасибо! Заявка отправлена. Диспетчер свяжется с вами в ближайшее время.\n\nНовая заявка — /new',
  cancelled: 'Заявку отменили. Начать заново — /new',
  idle: 'Чтобы оставить заявку, нажмите кнопку ниже или отправьте /new',
};

export function summary(d: Draft): string {
  return [
    'Проверьте заявку:',
    '',
    `👤 ${d.name}, ${formatPhone(d.phone) || d.phone}`,
    `🧒 ${d.children}`,
    `📍 ${d.fromText} → ${d.toText}`,
    `🕒 ${d.schedule}`,
    d.comment ? `💬 ${d.comment}` : '',
    '',
    'Нажимая «Отправить», вы соглашаетесь, что диспетчер получит эти данные, чтобы связаться с вами.',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

const ask: Record<Exclude<Step, 'idle' | 'confirm'>, Reply> = {
  name: { text: TEXT.name, keyboard: 'none' },
  phone: { text: TEXT.phone, keyboard: 'contact' },
  children: { text: TEXT.children, keyboard: 'none' },
  from: { text: TEXT.from, keyboard: 'none' },
  to: { text: TEXT.to, keyboard: 'none' },
  schedule: { text: TEXT.schedule, keyboard: 'none' },
  comment: { text: TEXT.comment, keyboard: 'skip' },
};

const ORDER: Step[] = ['name', 'phone', 'children', 'from', 'to', 'schedule', 'comment', 'confirm'];

function next(step: Step): Step {
  return ORDER[ORDER.indexOf(step) + 1] ?? 'confirm';
}

function goTo(step: Step, draft: Draft): { state: State; replies: Reply[] } {
  const state = { step, draft };
  if (step === 'confirm') return { state, replies: [{ text: summary(draft), keyboard: 'confirm' }] };
  if (step === 'idle') return { state, replies: [{ text: TEXT.idle, keyboard: 'start' }] };
  return { state, replies: [ask[step]] };
}

/** Один шаг разговора. */
export function handle(state: State, input: Input): { state: State; replies: Reply[]; lead?: Lead } {
  const text = input.text?.trim() ?? '';
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : '';

  if (cmd === '/start') return { state: START, replies: [{ text: TEXT.hello, keyboard: 'start' }] };
  if (cmd === '/new' || input.button === 'new' || (input.button === 'edit' && state.step === 'confirm')) return goTo('name', {});
  if (cmd === '/cancel') return { state: START, replies: [{ text: TEXT.cancelled, keyboard: 'start' }] };

  if (state.step === 'idle') return goTo('idle', {});

  if (state.step === 'confirm') {
    if (input.button === 'send') {
      const d = state.draft;
      const lead: Lead = { name: d.name!, phone: d.phone!, children: d.children!, fromText: d.fromText!, toText: d.toText!, schedule: d.schedule!, ...(d.comment ? { comment: d.comment } : {}) };
      return { state: START, replies: [{ text: TEXT.sent, keyboard: 'start' }], lead };
    }
    return { state, replies: [{ text: summary(state.draft), keyboard: 'confirm' }] };
  }

  if (state.step === 'phone') {
    const phone = normalizePhone(input.contactPhone ?? text);
    if (!phone) return { state, replies: [{ text: TEXT.phoneBad, keyboard: 'contact' }] };
    return goTo(next('phone'), { ...state.draft, phone });
  }

  if (state.step === 'comment' && input.button === 'skip') return goTo('confirm', { ...state.draft, comment: undefined });

  if (!text || cmd) return { state, replies: [{ text: TEXT.empty, keyboard: 'none' }, ask[state.step]] };
  if (text.length > MAX) return { state, replies: [{ text: TEXT.tooLong, keyboard: state.step === 'comment' ? 'skip' : 'none' }] };

  const field: Record<string, keyof Draft> = { name: 'name', children: 'children', from: 'fromText', to: 'toText', schedule: 'schedule', comment: 'comment' };
  return goTo(next(state.step), { ...state.draft, [field[state.step]]: text });
}
