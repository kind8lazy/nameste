// Общие проверки даты и времени: настоящая дата календаря и время 00:00–23:59.
import { z } from 'zod';
import { addDays, localDate } from '../../shared/time';

const realDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'неверное значение')
  .refine(realDate, 'такой даты нет в календаре');

/** Дата планирования: не дальше года вперёд. */
export const planDateField = dateField.refine((s) => s <= addDays(localDate(), 366), 'дата больше чем через год');

export const timeField = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время в виде 14:20');
