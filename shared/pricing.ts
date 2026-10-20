// Предварительная цена. Окончательную подтверждает диспетчер.
// Пока правило из переписок: 1 000 ₽ за ребёнка за поездку в одну сторону,
// второй и следующие дети в той же поездке — 700 ₽, без сопровождения до кабинета — на 200 ₽ дешевле.
import type { Escort } from './domain';
import { expandDates, parseRule } from './recurrence';
import { addDays } from './time';

export const TARIFF = { first: 1000, next: 700, entranceDiscount: 200 };

export function childPrice(index: number, escort: Escort): number {
  const base = index === 0 ? TARIFF.first : TARIFF.next;
  return base - (escort === 'to_entrance' ? TARIFF.entranceDiscount : 0);
}

export function quote(children: number, escort: Escort, rule: string, startDate: string) {
  const perTrip = Array.from({ length: children }, (_, i) => childPrice(i, escort)).reduce((a, b) => a + b, 0);
  const trips4w = expandDates(parseRule(rule), startDate, startDate, addDays(startDate, 27)).length;
  return { perTrip, tripsIn4Weeks: trips4w, total4Weeks: perTrip * trips4w };
}
