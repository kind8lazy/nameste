import { describe, expect, it, beforeAll } from 'vitest';

process.env.DEMO_MODE = '0';
const { runMigrations, db, schema } = await import('./db/client');
const { materialize } = await import('./modules/schedule');
const { planDay, defaultDriverId } = await import('./modules/planner');
const { shiftView } = await import('./modules/views');
const { addDays, localDate } = await import('../shared/time');
const { eq } = await import('drizzle-orm');

const day = addDays(localDate(), 1);

beforeAll(() => {
  runMigrations();
  db.insert(schema.users).values({ id: 'me', name: 'Дмитрий', roles: ['driver', 'dispatcher'] }).run();
  db.insert(schema.users).values({ id: 'nadya', name: 'Надежда', roles: ['driver'] }).run();
  db.insert(schema.drivers).values({ userId: 'nadya', trackerToken: 'tn' }).run();
  db.insert(schema.drivers).values({ userId: 'me', trackerToken: 'tm' }).run();
  db.insert(schema.families).values({ id: 'f', name: 'Семья' }).run();
  db.insert(schema.children).values({ id: 'dasha', familyId: 'f', firstName: 'Дарья' }).run();
  db.insert(schema.children).values({ id: 'amelia', familyId: 'f', firstName: 'Амелия' }).run();
  db.insert(schema.places).values({ id: 'home', familyId: 'f', name: 'Дом', address: 'Кима 22', lat: 59.95, lon: 30.24 }).run();
  db.insert(schema.places).values({ id: 'school', familyId: 'f', name: 'Школа', address: 'Барочная 12', lat: 59.96, lon: 30.29 }).run();
  const tpl = (id: string, childId: string, time: string, driverId: string | null) =>
    db.insert(schema.rideTemplates).values({ id, familyId: 'f', childId, fromPlaceId: 'home', toPlaceId: 'school', time, rule: 'ONCE', startDate: day, priceRub: 0, driverId }).run();
  tpl('t_dasha', 'dasha', '08:00', 'nadya');
  tpl('t_amelia', 'amelia', '18:05', null);
  materialize();
  planDay(day);
});

describe('несколько водителей', () => {
  it('основной водитель — водитель-диспетчер, даже если добавлен позже', () => {
    expect(defaultDriverId()).toBe('me');
  });
  it('у каждого водителя свой рейс со своими детьми', () => {
    const kids = (driverId: string) => shiftView(driverId, day).stops.flatMap((s) => s.rides.map((r) => r.child.firstName));
    expect(new Set(kids('nadya'))).toEqual(new Set(['Дарья']));
    expect(new Set(kids('me'))).toEqual(new Set(['Амелия']));
  });
  it('смена водителя переносит поездку в его рейс', () => {
    db.update(schema.rides).set({ driverId: 'nadya' }).where(eq(schema.rides.childId, 'amelia')).run();
    planDay(day);
    expect(shiftView('me', day).run).toBeNull();
    expect(new Set(shiftView('nadya', day).stops.flatMap((s) => s.rides.map((r) => r.child.firstName)))).toEqual(new Set(['Дарья', 'Амелия']));
  });
});
