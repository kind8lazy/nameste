// Повторы поездок. Храним подмножество стандартного RRULE (RFC 5545),
// чтобы правило читалось однозначно и переносилось в любой календарь:
//   ONCE                                   — разовая поездка в дату начала
//   FREQ=DAILY                             — каждый день
//   FREQ=WEEKLY;BYDAY=MO,FR                — по понедельникам и пятницам
//   FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR     — неделя через неделю
import { diffDays, weekStart, weekday, rangeDates, WEEKDAYS_SHORT } from './time';

export type Freq = 'ONCE' | 'DAILY' | 'WEEKLY';
export interface Rule {
  freq: Freq;
  interval: number;
  /** 1 — понедельник … 7 — воскресенье; пусто — без ограничения */
  byDay: number[];
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function parseRule(src: string): Rule {
  const s = src.trim().toUpperCase();
  if (s === 'ONCE' || s === '') return { freq: 'ONCE', interval: 1, byDay: [] };
  const parts = Object.fromEntries(
    s.split(';').filter(Boolean).map((p) => {
      const [k, v = ''] = p.split('=');
      return [k.trim(), v.trim()];
    }),
  );
  const freq = parts.FREQ as Freq;
  if (freq !== 'DAILY' && freq !== 'WEEKLY') throw new Error(`Неизвестный повтор: ${src}`);
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 8) throw new Error(`Неверный интервал: ${src}`);
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(',').map((c) => {
        const i = DAY_CODES.indexOf(c.trim());
        if (i < 0) throw new Error(`Неверный день недели: ${c}`);
        return i + 1;
      })
    : [];
  return { freq, interval, byDay: [...new Set(byDay)].sort((a, b) => a - b) };
}

export function formatRule(r: Rule): string {
  if (r.freq === 'ONCE') return 'ONCE';
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay.length) parts.push(`BYDAY=${r.byDay.map((d) => DAY_CODES[d - 1]).join(',')}`);
  return parts.join(';');
}

/** Выпадает ли поездка по правилу на дату. */
export function occursOn(rule: Rule, startDate: string, date: string, endDate?: string | null): boolean {
  if (date < startDate) return false;
  if (endDate && date > endDate) return false;
  if (rule.freq === 'ONCE') return date === startDate;
  const wd = weekday(date);
  if (rule.freq === 'DAILY') {
    if (rule.byDay.length && !rule.byDay.includes(wd)) return false;
    return diffDays(startDate, date) % rule.interval === 0;
  }
  // WEEKLY: недели считаем от понедельника недели начала
  const days = rule.byDay.length ? rule.byDay : [weekday(startDate)];
  if (!days.includes(wd)) return false;
  const weeks = diffDays(weekStart(startDate), weekStart(date)) / 7;
  return weeks % rule.interval === 0;
}

export function expandDates(rule: Rule, startDate: string, from: string, to: string, endDate?: string | null): string[] {
  return rangeDates(from, to).filter((d) => occursOn(rule, startDate, d, endDate));
}

/** Человеческое описание: «по пн и пт», «через неделю по вт и пт», «каждый день», «разово». */
export function describeRule(r: Rule): string {
  if (r.freq === 'ONCE') return 'разово';
  const days = r.byDay.map((d) => WEEKDAYS_SHORT[d - 1]);
  const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} и ${days[days.length - 1]}` : days[0];
  if (r.freq === 'DAILY') return r.interval === 1 ? (list ? `по ${list}` : 'каждый день') : `раз в ${r.interval} дня`;
  const every = r.interval === 1 ? '' : r.interval === 2 ? 'через неделю ' : `раз в ${r.interval} недели `;
  if (r.byDay.length === 5 && r.byDay.join() === '1,2,3,4,5') return `${every}по будням`.trim();
  return `${every}по ${list ?? ''}`.trim();
}
