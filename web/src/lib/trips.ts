// Поездки родителя собираем в «забор»: дети, которых забирают вместе в одной точке.
import type { RideView } from '@shared/api';
import type { Tone } from '@shared/domain';
import { joinNames } from '@shared/domain';

export interface Trip {
  key: string;
  rides: RideView[];
  pickupTime: string;
  fromName: string;
  date: string;
}

export function groupTrips(rides: RideView[]): Trip[] {
  const map = new Map<string, RideView[]>();
  for (const r of rides) {
    const key = r.runId && r.pickupStopId ? `${r.pickupStopId}` : `${r.date}|${r.pickupTime}|${r.from.id}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, rides: list, pickupTime: list[0].pickupTime, fromName: list[0].from.name, date: list[0].date }))
    .sort((a, b) => (a.date + a.pickupTime).localeCompare(b.date + b.pickupTime));
}

export interface TripState {
  headline: string;
  label: string;
  eta: string | null;
  step: number;
  tone: Tone;
  live: boolean;
  done: boolean;
  cancelled: boolean;
  lines: { ride: RideView; text: string; done: boolean }[];
}

const names = (rs: RideView[]) => joinNames(rs.map((r) => r.child.firstName));

export function tripState(t: Trip): TripState {
  const active = t.rides.filter((r) => r.status !== 'cancelled');
  const pending = active.filter((r) => r.status !== 'delivered');
  const by = (s: RideView['status']) => active.filter((r) => r.status === s);
  const lines = t.rides.map((r) => {
    let text = `${r.from.name} → ${r.to.name}`;
    if (r.status === 'delivered') text = `на месте: «${r.to.name}» · ${r.times.delivered ?? ''}${r.receiver ? `, ${r.receiver}` : ''}`;
    else if (r.status === 'on_board') text = `в машине, «${r.to.name}» ≈ ${r.eta ?? r.plannedDropoff ?? '—'}`;
    else if (r.status === 'driver_arrived') text = 'водитель ждёт у точки';
    else if (r.status === 'driver_en_route') text = `водитель едет, будет ≈ ${r.eta ?? r.pickupTime}`;
    else if (r.status === 'no_show') text = 'не вышел — водитель ждёт';
    else if (r.status === 'cancelled') text = 'поездка отменена';
    return { ride: r, text, done: r.status === 'delivered' };
  });
  const step = pending.length ? Math.min(...pending.map((r) => r.step)) : active.length ? 4 : 0;
  const base = { step, lines, cancelled: !active.length, done: !pending.length && active.length > 0 };

  if (!active.length) return { ...base, headline: 'Поездка отменена', label: names(t.rides), eta: null, tone: 'muted', live: false };
  if (by('no_show').length)
    return { ...base, headline: `${names(by('no_show'))}: не ${by('no_show').length > 1 ? 'вышли' : 'вышел'}`, label: 'Нужна помощь', eta: null, tone: 'alert', live: true };
  if (by('on_board').length) {
    const ob = by('on_board');
    const dests = [...new Set(ob.map((r) => r.to.name))].join(', ');
    return { ...base, headline: `Едут: ${dests}`, label: `${names(ob)} · в машине`, eta: ob.map((r) => r.eta ?? r.plannedDropoff).filter(Boolean).sort()[0] ?? null, tone: 'gold', live: true };
  }
  if (by('driver_arrived').length)
    return { ...base, headline: `Водитель у точки «${t.fromName}»`, label: `${names(by('driver_arrived'))} · выходят`, eta: null, tone: 'gold', live: true };
  if (by('driver_en_route').length) {
    const r = by('driver_en_route')[0];
    return { ...base, headline: 'Водитель едет', label: `${names(by('driver_en_route'))} · ${t.fromName}`, eta: r.eta ?? t.pickupTime, tone: 'gold', live: true };
  }
  if (!pending.length) return { ...base, headline: 'Все на месте', label: names(active), eta: null, tone: 'ok', live: false };
  const confirmed = active.every((r) => r.status === 'confirmed');
  return {
    ...base,
    headline: `В ${t.pickupTime} забираем`,
    label: `${names(active)} · ${t.fromName}${confirmed ? ' · подтверждено' : ''}`,
    eta: null,
    tone: 'plan',
    live: false,
  };
}

/** Куда машина едет сейчас: ближайшая высадка тех, кто в машине, иначе — точка забора. */
export function currentTarget(t: Trip): RideView['from'] {
  const onBoard = t.rides
    .filter((r) => r.status === 'on_board')
    .sort((a, b) => (a.eta ?? a.plannedDropoff ?? '99:99').localeCompare(b.eta ?? b.plannedDropoff ?? '99:99'));
  return onBoard[0]?.to ?? t.rides[0].from;
}
