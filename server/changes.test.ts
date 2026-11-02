import { describe, expect, it, beforeAll } from 'vitest';

process.env.DEMO_MODE = '0';
const { runMigrations, db, schema } = await import('./db/client');
const { createChange, acceptChange, declineChange, withdrawChange, pendingByRide } = await import('./modules/changes');
const { addDays, localDate } = await import('../shared/time');
const { eq } = await import('drizzle-orm');

const d1 = addDays(localDate(), 1);
const d2 = addDays(localDate(), 2);
const d3 = addDays(localDate(), 3);
const ride = (id: string) => db.select().from(schema.rides).where(eq(schema.rides.id, id)).get()!;

beforeAll(() => {
  runMigrations();
  db.insert(schema.users).values({ id: 'disp', name: 'Диспетчер', roles: ['driver', 'dispatcher'] }).run();
  db.insert(schema.drivers).values({ userId: 'disp', trackerToken: 'td' }).run();
  db.insert(schema.users).values({ id: 'mom', name: 'Мама', roles: ['parent'] }).run();
  db.insert(schema.families).values({ id: 'f', name: 'Семья' }).run();
  db.insert(schema.children).values({ id: 'k', familyId: 'f', firstName: 'Дарья' }).run();
  db.insert(schema.places).values({ id: 'a', familyId: 'f', name: 'Дом', address: 'x', lat: 59.95, lon: 30.24 }).run();
  db.insert(schema.places).values({ id: 'b', familyId: 'f', name: 'Школа', address: 'y', lat: 59.96, lon: 30.29 }).run();
  for (const [id, date] of [['r1', d1], ['r2', d2], ['r3', d3]])
    db.insert(schema.rides).values({ id, familyId: 'f', childId: 'k', date, fromPlaceId: 'a', toPlaceId: 'b', pickupTime: '08:00', priceRub: 0 }).run();
});

describe('просьбы родителя — только с согласия диспетчера', () => {
  it('просьба отменить ничего не меняет, пока диспетчер не принял', async () => {
    const c = createChange('f', 'mom', { kind: 'cancel', rideId: 'r1', reason: 'Заболел' });
    expect(ride('r1').status).toBe('planned');
    expect(pendingByRide(['r1']).get('r1')?.kind).toBe('cancel');
    expect(() => createChange('f', 'mom', { kind: 'time', rideId: 'r1', time: '09:00' })).toThrow('уже есть просьба');
    await acceptChange(c.id, 'disp');
    expect(ride('r1').status).toBe('cancelled');
    expect(pendingByRide(['r1']).size).toBe(0);
  });
  it('перенос времени: диспетчер может принять со своим временем', async () => {
    const c = createChange('f', 'mom', { kind: 'time', rideId: 'r2', time: '08:20' });
    expect(c.summary).toContain('08:00 → 08:20');
    expect(ride('r2').pickupTime).toBe('08:00');
    await acceptChange(c.id, 'disp', '08:40');
    expect(ride('r2').pickupTime).toBe('08:40');
  });
  it('отказ оставляет поездку как была', async () => {
    const c = createChange('f', 'mom', { kind: 'time', rideId: 'r3', time: '10:00' });
    await declineChange(c.id, 'Водитель занят');
    expect(ride('r3').pickupTime).toBe('08:00');
    await expect(acceptChange(c.id, 'disp')).rejects.toThrow('уже обработана');
  });
  it('родитель может забрать просьбу назад, пока нет ответа', () => {
    const c = createChange('f', 'mom', { kind: 'cancel', rideId: 'r3' });
    expect(() => withdrawChange(c.id, ['other'])).toThrow('не ваша');
    withdrawChange(c.id, ['f']);
    expect(pendingByRide(['r3']).size).toBe(0);
  });
  it('«ребёнка не будет» отменяет все поездки в диапазоне после согласия', async () => {
    expect(() => createChange('f', 'mom', { kind: 'absence', childId: 'k', dateFrom: d1, dateTo: addDays(localDate(), 30), reason: 'Отпуск' })).toThrow('не дальше');
    const c = createChange('f', 'mom', { kind: 'absence', childId: 'k', dateFrom: d2, dateTo: d3, reason: 'Болезнь' });
    expect(ride('r3').status).toBe('planned');
    await acceptChange(c.id, 'disp');
    expect(ride('r2').status).toBe('cancelled');
    expect(ride('r3').status).toBe('cancelled');
  });
});
