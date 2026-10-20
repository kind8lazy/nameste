// Места семьи: дом, школа, секции. Добавляет их клиент в своём профиле или диспетчер в карточке клиента.
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { HttpError } from './auth';

export const MAX_PLACES_PER_FAMILY = 30;

export const placeInput = z.object({
  name: z.string().trim().min(2, 'слишком коротко').max(60, 'слишком длинно'),
  address: z.string().trim().min(3, 'слишком коротко').max(200, 'слишком длинно'),
  // Санкт-Петербург и область: защита от случайных координат вне региона
  lat: z.number().min(58.5, 'место вне Петербурга и области').max(61.5, 'место вне Петербурга и области'),
  lon: z.number().min(28, 'место вне Петербурга и области').max(33, 'место вне Петербурга и области'),
  entranceNote: z.string().trim().max(200, 'слишком длинно').optional(),
});

export type PlaceInput = z.infer<typeof placeInput>;

export function addFamilyPlace(familyId: string, input: PlaceInput): string {
  const family = db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.id, familyId)).get();
  if (!family) throw new HttpError(404, 'Семья не найдена');
  const count = db.select({ n: sql<number>`count(*)` }).from(schema.places).where(eq(schema.places.familyId, familyId)).get()?.n ?? 0;
  if (count >= MAX_PLACES_PER_FAMILY) throw new HttpError(400, `Больше ${MAX_PLACES_PER_FAMILY} мест у одной семьи не бывает. Удалите ненужные.`);
  const id = newId('pl');
  db.insert(schema.places).values({ id, familyId, name: input.name, address: input.address, lat: input.lat, lon: input.lon, entranceNote: input.entranceNote || null }).run();
  return id;
}

/** Место должно принадлежать именно этой семье: чужие и «ничьи» места не годятся. */
export function requireFamilyPlace(familyId: string, placeId: string) {
  const p = db.select().from(schema.places).where(eq(schema.places.id, placeId)).get();
  if (!p || p.familyId !== familyId) throw new HttpError(400, 'Это место не из адресов этой семьи');
}

/** Ребёнок должен быть из этой семьи. */
export function requireFamilyChild(familyId: string, childId: string) {
  const c = db.select().from(schema.children).where(eq(schema.children.id, childId)).get();
  if (!c || c.familyId !== familyId) throw new HttpError(400, 'Этот ребёнок не из этой семьи');
}

export function requireFamily(familyId: string) {
  if (!db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.id, familyId)).get()) throw new HttpError(404, 'Семья не найдена');
}

/** Та же поездка уже есть: тот же ребёнок, то же время, пересекаются дни. Иначе ребёнок приедет в рейс дважды. */
export function requireNoDuplicateTemplate(childId: string, time: string, rule: string, startDate: string) {
  const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const dayOf = (date: string) => CODES[new Date(`${date}T12:00:00Z`).getUTCDay()];
  /** null — разовая поездка */
  const days = (r: string) => (r.trim().toUpperCase().startsWith('ONCE') || !r.trim() ? null : new Set((/BYDAY=([A-Z,]+)/.exec(r.toUpperCase())?.[1] ?? '').split(',').filter(Boolean)));
  const mine = days(rule);
  const same = db
    .select()
    .from(schema.rideTemplates)
    .where(and(eq(schema.rideTemplates.childId, childId), eq(schema.rideTemplates.time, time), eq(schema.rideTemplates.active, true)))
    .all()
    .find((t) => {
      const other = days(t.rule);
      if (mine === null && other === null) return t.startDate === startDate;
      if (mine === null) return startDate >= t.startDate && other!.has(dayOf(startDate));
      if (other === null) return t.startDate >= startDate && mine.has(dayOf(t.startDate));
      return [...mine].some((d) => other.has(d));
    });
  if (same) throw new HttpError(409, `У ребёнка уже есть поездка в ${time} в эти дни. Измените время или остановите старую поездку.`);
}
