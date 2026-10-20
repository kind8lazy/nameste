import { describe, expect, it } from 'vitest';
import { parseRule, formatRule, occursOn, expandDates, describeRule } from './recurrence';
import { applyEvent, parentStep, joinNames } from './domain';
import { localDate, localTime, atLocal, weekday, weekStart, addDays, formatDayRu, addMinutes } from './time';
import { distanceM, estimateDriveMin } from './geo';
import { eventMessage, reminderMessage } from './messages';

describe('время по Петербургу', () => {
  it('переводит UTC в местные дату и время', () => {
    const d = new Date('2026-10-04T22:30:00Z'); // 01:30 5 октября по Москве
    expect(localDate(d)).toBe('2026-10-05');
    expect(localTime(d)).toBe('01:30');
    expect(atLocal('2026-10-05', '14:20').toISOString()).toBe('2026-10-05T11:20:00.000Z');
  });
  it('считает дни недели и недели', () => {
    expect(weekday('2026-10-05')).toBe(1); // понедельник
    expect(weekday('2026-10-11')).toBe(7);
    expect(weekStart('2026-10-09')).toBe('2026-10-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatDayRu('2026-10-05')).toBe('понедельник, 5 октября');
    expect(addMinutes('23:50', 20)).toBe('00:10');
  });
});

describe('повторы поездок', () => {
  it('читает и пишет правило', () => {
    const r = parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR,TU');
    expect(r).toEqual({ freq: 'WEEKLY', interval: 2, byDay: [2, 5] });
    expect(formatRule(r)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR');
    expect(() => parseRule('FREQ=MONTHLY')).toThrow();
  });
  it('по вторникам и пятницам', () => {
    const r = parseRule('FREQ=WEEKLY;BYDAY=TU,FR');
    expect(expandDates(r, '2026-10-01', '2026-10-05', '2026-10-18')).toEqual(['2026-10-06', '2026-10-09', '2026-10-13', '2026-10-16']);
  });
  it('неделя через неделю — считает от недели начала', () => {
    const r = parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR');
    // начало в четверг 1 октября: неделя 28.09 — «наша», 05.10 — пропуск, 12.10 — «наша»
    expect(expandDates(r, '2026-10-01', '2026-10-01', '2026-10-18')).toEqual(['2026-10-02', '2026-10-13', '2026-10-16']);
  });
  it('каждый учебный день и разово', () => {
    expect(occursOn(parseRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), '2026-09-01', '2026-10-10')).toBe(false); // суббота
    expect(occursOn(parseRule('ONCE'), '2026-10-07', '2026-10-07')).toBe(true);
    expect(occursOn(parseRule('ONCE'), '2026-10-07', '2026-10-14')).toBe(false);
    expect(occursOn(parseRule('FREQ=DAILY'), '2026-10-01', '2026-10-20', '2026-10-15')).toBe(false); // после окончания
  });
  it('описывает правило по-человечески', () => {
    expect(describeRule(parseRule('FREQ=WEEKLY;BYDAY=MO,FR'))).toBe('по пн и пт');
    expect(describeRule(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR'))).toBe('через неделю по вт и пт');
    expect(describeRule(parseRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'))).toBe('по будням');
    expect(describeRule(parseRule('ONCE'))).toBe('разово');
  });
});

describe('состояния поездки', () => {
  it('проходит основной путь', () => {
    let s = 'planned' as const as Parameters<typeof applyEvent>[0];
    for (const ev of ['confirmed', 'driver_departed', 'arrived_pickup', 'boarded', 'arrived_dropoff', 'handed_over'] as const) {
      const r = applyEvent(s, ev);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.next;
    }
    expect(s).toBe('delivered');
    expect(parentStep(s)).toBe(4);
  });
  it('не даёт отменить ребёнка, который уже в машине', () => {
    const r = applyEvent('on_board', 'cancelled');
    expect(r.ok).toBe(false);
  });
  it('«не вышел» возможен только у точки и снимается посадкой', () => {
    expect(applyEvent('driver_en_route', 'no_show').ok).toBe(false);
    expect(applyEvent('driver_arrived', 'no_show')).toEqual({ ok: true, next: 'no_show', changed: true });
    expect(applyEvent('no_show', 'boarded')).toEqual({ ok: true, next: 'on_board', changed: true });
  });
  it('информационные события не меняют состояние', () => {
    expect(applyEvent('on_board', 'arrived_dropoff')).toEqual({ ok: true, next: 'on_board', changed: false });
  });
});

describe('гео', () => {
  it('считает расстояние и время в пути', () => {
    const home = { lat: 59.9611, lon: 30.2785 };
    const tennis = { lat: 59.9795, lon: 30.2985 };
    const d = distanceM(home, tennis);
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(3000);
    expect(estimateDriveMin(home, tennis)).toBeGreaterThanOrEqual(8);
  });
});

describe('тексты уведомлений', () => {
  it('имя, действие, время', () => {
    expect(joinNames(['Маша', 'Лёва', 'Вика'])).toBe('Маша, Лёва и Вика');
    const m = eventMessage('boarded', { children: ['Маша', 'Лёва'], time: '14:21', fromPlace: 'Школа', toPlace: 'Теннис', eta: '14:34' });
    expect(m?.title).toBe('Маша и Лёва в машине · 14:21');
    expect(m?.priority).toBe('critical');
    const h = eventMessage('handed_over', { children: ['Маша'], time: '14:34', toPlace: 'Теннис', receiver: 'тренер' });
    expect(h?.body).toBe('«Теннис». Принял: тренер.');
  });
  it('напоминание накануне', () => {
    const m = reminderMessage([
      { time: '14:20', children: ['Маша', 'Лёва'], fromPlace: 'Школа', toPlace: 'Теннис' },
      { time: '20:00', children: ['Маша'], fromPlace: 'Музыкалка', toPlace: 'Дом' },
    ]);
    expect(m.title).toBe('Завтра 2 поездки. Всё в силе?');
  });
});

import { plural, TRIPS } from './ru';
describe('окончания', () => {
  it('поездка, поездки, поездок', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, TRIPS))).toEqual(['поездка', 'поездки', 'поездок', 'поездок', 'поездка', 'поездки', 'поездок', 'поездок']);
  });
});

import { normalizePhone, formatPhone } from './phone';
import { smsText } from './messages';
describe('телефоны и SMS', () => {
  it('приводит номер к одному виду', () => {
    expect(normalizePhone('8 (921) 123-45-67')).toBe('79211234567');
    expect(normalizePhone('+7 921 123 45 67')).toBe('79211234567');
    expect(normalizePhone('9211234567')).toBe('79211234567');
    expect(normalizePhone('123')).toBeNull();
    expect(formatPhone('89211234567')).toBe('+7 921 123-45-67');
  });
  it('SMS «на месте» помещается в одно сообщение (70 знаков)', () => {
    const t = smsText('handed_over', { children: ['Маша'], time: '14:34', toPlace: 'Теннис', receiver: 'тренер' })!;
    expect(t).toBe('Маша на месте: Теннис, 14:34. Принял: тренер. НА МЕСТЕ');
    const long = smsText('handed_over', { children: ['Александра', 'Константин', 'Елизавета'], time: '14:34', toPlace: 'Музыкальная школа имени Римского-Корсакова', receiver: 'администратор' })!;
    expect(long.length).toBeLessThanOrEqual(70);
    expect(long).toContain('на месте');
    expect(smsText('confirmed', { children: ['Маша'], time: '10:00' })).toBeNull();
  });
});
