// Шаблоны недели → конкретные поездки на 14 дней вперёд.
// Повторный запуск безопасен: одна поездка на шаблон и дату (уникальный индекс).
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { expandDates, parseRule } from '../../shared/recurrence';
import { addDays, localDate } from '../../shared/time';
import { recordRideEvents } from './rides';

export const HORIZON_DAYS = 14;

export function materialize(from = localDate(), to = addDays(localDate(), HORIZON_DAYS)): number {
  const templates = db.select().from(schema.rideTemplates).where(eq(schema.rideTemplates.active, true)).all();
  if (!templates.length) return 0;
  const exceptions = db
    .select()
    .from(schema.templateExceptions)
    .where(inArray(schema.templateExceptions.templateId, templates.map((t) => t.id)))
    .all();
  const exc = new Map(exceptions.map((e) => [`${e.templateId}|${e.date}`, e]));
  let created = 0;
  for (const t of templates) {
    const dates = expandDates(parseRule(t.rule), t.startDate, from, to, t.endDate);
    for (const date of dates) {
      const e = exc.get(`${t.id}|${date}`);
      if (e?.action === 'skip') continue;
      const res = db
        .insert(schema.rides)
        .values({
          id: newId('r'),
          familyId: t.familyId,
          childId: t.childId,
          templateId: t.id,
          date,
          fromPlaceId: t.fromPlaceId,
          toPlaceId: t.toPlaceId,
          pickupTime: e?.action === 'time' && e.time ? e.time : t.time,
          arriveBy: t.arriveBy,
          escort: t.escort,
          priceRub: t.priceRub,
        })
        .onConflictDoNothing()
        .run();
      created += res.changes;
    }
  }
  return created;
}

/** Исключение на один день: отменить или сдвинуть время, не трогая шаблон. */
export async function setException(
  templateId: string,
  date: string,
  change: { action: 'skip'; reason?: string } | { action: 'time'; time: string; reason?: string },
  actorUserId?: string,
) {
  db.insert(schema.templateExceptions)
    .values({ id: newId('ex'), templateId, date, action: change.action, time: change.action === 'time' ? change.time : null, reason: change.reason })
    .onConflictDoUpdate({
      target: [schema.templateExceptions.templateId, schema.templateExceptions.date],
      set: { action: change.action, time: change.action === 'time' ? change.time : null, reason: change.reason },
    })
    .run();
  const ride = db
    .select()
    .from(schema.rides)
    .where(and(eq(schema.rides.templateId, templateId), eq(schema.rides.date, date)))
    .get();
  if (!ride) return;
  if (change.action === 'skip') {
    await recordRideEvents({ rideIds: [ride.id], type: 'cancelled', source: 'parent', actorUserId, reason: change.reason });
  } else {
    db.update(schema.rides).set({ pickupTime: change.time, updatedAt: new Date() }).where(eq(schema.rides.id, ride.id)).run();
  }
}
