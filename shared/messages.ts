// Тексты уведомлений родителям. Правило: имя, действие, время.
// Имена детей стоят в именительном падеже, чтобы не склонять их автоматически.
import type { RideEventType } from './domain';
import { joinNames } from './domain';
import { plural, TRIPS } from './ru';

export type Priority = 'critical' | 'important' | 'info';

export interface MessageContext {
  children: string[];
  time: string; // HH:MM события
  driver?: string;
  driverPhone?: string;
  fromPlace?: string;
  toPlace?: string;
  eta?: string; // HH:MM ожидаемого прибытия
  receiver?: string;
  reason?: string;
  pickupTime?: string;
}

export interface Message {
  title: string;
  body: string;
  priority: Priority;
}

const oneOrMany = (names: string[], one: string, many: string) => (names.length > 1 ? many : one);

export function eventMessage(type: RideEventType, c: MessageContext): Message | null {
  const who = joinNames(c.children);
  const driver = c.driver ?? 'Водитель';
  switch (type) {
    case 'driver_departed':
      return {
        title: `${driver} выехал`,
        body: `Едет к точке «${c.fromPlace}»${c.eta ? `, будет около ${c.eta}` : ''}. Забираем: ${who}.`,
        priority: 'info',
      };
    case 'arrived_pickup':
      return {
        title: `${driver} на месте · ${c.time}`,
        body: `Ждёт у точки «${c.fromPlace}». Забираем: ${who}.`,
        priority: 'info',
      };
    case 'teacher_ack':
      return { title: `Педагог выводит: ${who}`, body: `${driver} ждёт у точки «${c.fromPlace}».`, priority: 'info' };
    case 'boarded':
      return {
        title: `${who} в машине · ${c.time}`,
        body: `Едем: ${c.fromPlace} → ${c.toPlace}${c.eta ? `, будем около ${c.eta}` : ''}.`,
        priority: 'critical',
      };
    case 'arrived_dropoff':
      return null; // промежуточный шаг, отдельное уведомление не нужно
    case 'handed_over':
      return {
        title: `${who} на месте · ${c.time}`,
        body: `«${c.toPlace}»${c.receiver ? `. Принял: ${c.receiver}` : ''}.`,
        priority: 'critical',
      };
    case 'no_show':
      return {
        title: `${who}: ${oneOrMany(c.children, 'не вышел', 'не вышли')}`,
        body: `${driver} ждёт у точки «${c.fromPlace}» с ${c.pickupTime ?? c.time}.${c.driverPhone ? ` Позвоните ему: ${c.driverPhone}` : ' Свяжитесь с водителем.'}`,
        priority: 'critical',
      };
    case 'cancelled':
      return {
        title: `Поездка отменена`,
        body: `${who} · ${c.fromPlace} → ${c.toPlace}, ${c.pickupTime}.${c.reason ? ` ${c.reason}` : ''}`,
        priority: 'important',
      };
    case 'confirmed':
      return null;
  }
}

export function delayMessage(c: MessageContext & { minutes: number }): Message {
  return {
    title: `Задержка ~${c.minutes} мин`,
    body: `${joinNames(c.children)}: ${c.driver ?? 'водитель'} будет около ${c.eta}.${c.reason ? ` ${c.reason}` : ''}`,
    priority: 'important',
  };
}

export interface ReminderLine {
  time: string;
  children: string[];
  fromPlace: string;
  toPlace: string;
}

export function reminderMessage(lines: ReminderLine[]): Message {
  const n = lines.length;
  const word = plural(n, TRIPS);
  const first = lines
    .slice(0, 3)
    .map((l) => `${l.time} ${joinNames(l.children)}: ${l.fromPlace} → ${l.toPlace}`)
    .join('\n');
  return {
    title: `Завтра ${n} ${word}. Всё в силе?`,
    body: `${first}${n > 3 ? `\n…и ещё ${n - 3}` : ''}\nОткройте, чтобы подтвердить или отменить.`,
    priority: 'important',
  };
}

/**
 * Текст SMS. В одно SMS кириллицей помещается 70 знаков — лишнее отбрасываем по частям,
 * чтобы не платить за второе сообщение.
 */
export function smsText(type: RideEventType, c: MessageContext): string | null {
  const who = joinNames(c.children);
  const sign = ' НА МЕСТЕ';
  let variants: string[] = [];
  if (type === 'handed_over') {
    variants = [
      `${who} на месте: ${c.toPlace}, ${c.time}. Принял: ${c.receiver}.${sign}`,
      `${who} на месте: ${c.toPlace}, ${c.time}.${sign}`,
      `${who} на месте, ${c.time}.${sign}`,
    ];
    if (!c.receiver) variants.shift();
  } else if (type === 'boarded') {
    variants = [`${who} в машине, ${c.time}. Едем: ${c.toPlace}.${sign}`, `${who} в машине, ${c.time}.${sign}`];
  } else if (type === 'no_show') {
    variants = [`${who}: ${oneOrMany(c.children, 'не вышел', 'не вышли')}, ${c.fromPlace}. Позвоните водителю ${c.driverPhone ?? ''}`.trim(), `${who}: ${oneOrMany(c.children, 'не вышел', 'не вышли')}. Позвоните водителю`];
  } else return null;
  return variants.find((v) => v.length <= 70) ?? variants[variants.length - 1].slice(0, 70);
}
