// Поездка ребёнка и её состояния. Одна поездка = один ребёнок на одном отрезке
// «откуда → куда» в конкретную дату. Несколько поездок собираются в рейс машины.

export const RIDE_STATUSES = [
  'planned', // создана из шаблона недели
  'confirmed', // родитель подтвердил накануне
  'driver_en_route', // водитель едет к точке забора
  'driver_arrived', // водитель у точки забора
  'on_board', // ребёнок в машине
  'delivered', // передан взрослому на месте
  'cancelled',
  'no_show', // ребёнок не вышел
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const TERMINAL_STATUSES: RideStatus[] = ['delivered', 'cancelled'];

export const RIDE_EVENT_TYPES = [
  'confirmed',
  'cancelled',
  'driver_departed',
  'arrived_pickup',
  'teacher_ack',
  'boarded',
  'arrived_dropoff',
  'handed_over',
  'no_show',
] as const;
export type RideEventType = (typeof RIDE_EVENT_TYPES)[number];

export type EventSource = 'driver' | 'parent' | 'dispatcher' | 'system' | 'geofence' | 'lestart';

const PRE_PICKUP: RideStatus[] = ['planned', 'confirmed', 'driver_en_route', 'driver_arrived'];

/** Из каких состояний событие допустимо и куда переводит (null — состояние не меняется). */
export const TRANSITIONS: Record<RideEventType, { from: RideStatus[]; to: RideStatus | null }> = {
  confirmed: { from: ['planned'], to: 'confirmed' },
  cancelled: { from: PRE_PICKUP, to: 'cancelled' },
  driver_departed: { from: ['planned', 'confirmed'], to: 'driver_en_route' },
  arrived_pickup: { from: ['planned', 'confirmed', 'driver_en_route'], to: 'driver_arrived' },
  teacher_ack: { from: ['driver_en_route', 'driver_arrived'], to: null },
  boarded: { from: [...PRE_PICKUP, 'no_show'], to: 'on_board' },
  arrived_dropoff: { from: ['on_board'], to: null },
  handed_over: { from: ['on_board'], to: 'delivered' },
  no_show: { from: ['driver_arrived'], to: 'no_show' },
};

export type TransitionResult = { ok: true; next: RideStatus; changed: boolean } | { ok: false; reason: string };

export function applyEvent(status: RideStatus, type: RideEventType): TransitionResult {
  const t = TRANSITIONS[type];
  if (!t.from.includes(status)) {
    return { ok: false, reason: `Нельзя «${EVENT_LABELS[type]}», когда поездка в состоянии «${STATUS_LABELS[status]}»` };
  }
  const next = t.to ?? status;
  return { ok: true, next, changed: next !== status };
}

export const STATUS_LABELS: Record<RideStatus, string> = {
  planned: 'в плане',
  confirmed: 'подтверждена',
  driver_en_route: 'водитель едет',
  driver_arrived: 'водитель на месте',
  on_board: 'в машине',
  delivered: 'передан',
  cancelled: 'отменена',
  no_show: 'не вышел',
};

export const EVENT_LABELS: Record<RideEventType, string> = {
  confirmed: 'подтвердить',
  cancelled: 'отменить',
  driver_departed: 'выехать',
  arrived_pickup: 'отметить прибытие',
  teacher_ack: 'педагог выводит',
  boarded: 'посадить в машину',
  arrived_dropoff: 'прибыть на место',
  handed_over: 'передать',
  no_show: 'отметить «не вышел»',
};

/** Шкала для родителя: 0 — ещё не началась, 1 едет, 2 у точки, 3 в машине, 4 передан. */
export const PARENT_STEPS = ['Едет', 'У точки', 'В машине', 'Передан'] as const;

export function parentStep(status: RideStatus): number {
  switch (status) {
    case 'driver_en_route':
      return 1;
    case 'driver_arrived':
    case 'no_show':
      return 2;
    case 'on_board':
      return 3;
    case 'delivered':
      return 4;
    default:
      return 0;
  }
}

export type Tone = 'plan' | 'gold' | 'ok' | 'warn' | 'alert' | 'muted';

/** Цвет состояния: серо-синий план, золото в пути, зелёный передан, красный нужно действие. */
export function statusTone(status: RideStatus): Tone {
  switch (status) {
    case 'driver_en_route':
    case 'driver_arrived':
    case 'on_board':
      return 'gold';
    case 'delivered':
      return 'ok';
    case 'no_show':
      return 'alert';
    case 'cancelled':
      return 'muted';
    default:
      return 'plan';
  }
}

export function isActive(status: RideStatus): boolean {
  return status === 'driver_en_route' || status === 'driver_arrived' || status === 'on_board';
}

export type Escort = 'to_door' | 'to_entrance';
export const ESCORT_LABELS: Record<Escort, string> = {
  to_door: 'до кабинета, передать взрослому',
  to_entrance: 'до входа',
};

export type Role = 'parent' | 'driver' | 'dispatcher';

/** «Маша», «Маша и Лёва», «Маша, Лёва и Вика» */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}
