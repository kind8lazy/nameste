// Время сервиса — всегда Петербург (UTC+3, без перехода на летнее время с 2014 года).
export const TZ = 'Europe/Moscow';
const OFFSET = '+03:00';
const OFFSET_MS = 3 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Дата по Петербургу в формате YYYY-MM-DD. */
export function localDate(d: Date | number = new Date()): string {
  const t = new Date((typeof d === 'number' ? d : d.getTime()) + OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Время по Петербургу в формате HH:MM. */
export function localTime(d: Date | number = new Date()): string {
  const t = new Date((typeof d === 'number' ? d : d.getTime()) + OFFSET_MS);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Момент времени для даты и HH:MM по Петербургу. */
export function atLocal(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00${OFFSET}`);
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function hhmmOf(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function addMinutes(hhmm: string, delta: number): string {
  return hhmmOf(minutesOf(hhmm) + delta);
}

// ——— календарные даты без часовых поясов ———

function toUtcDays(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromUtcDays(days: number): string {
  const t = new Date(days * 86_400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addDays(date: string, n: number): string {
  return fromUtcDays(toUtcDays(date) + n);
}

export function diffDays(from: string, to: string): number {
  return toUtcDays(to) - toUtcDays(from);
}

/** День недели: 1 — понедельник … 7 — воскресенье. */
export function weekday(date: string): number {
  const d = new Date(toUtcDays(date) * 86_400_000).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Понедельник недели, в которую входит дата. */
export function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date));
}

export function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** «понедельник, 5 октября» */
export function formatDayRu(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekday(date) - 1]}, ${d} ${MONTHS_GEN[m - 1]}`;
}

/** «5 октября» */
export function formatDateRu(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}
