import { describe, expect, it, beforeAll } from 'vitest';

process.env.DEMO_MODE = '0';
const { runMigrations, db, schema } = await import('./db/client');
const { createRequest } = await import('./modules/requests');
const { localDate, addDays } = await import('../shared/time');

beforeAll(() => {
  runMigrations();
  db.insert(schema.families).values({ id: 'f1', name: 'Семья' }).run();
  db.insert(schema.users).values({ id: 'u1', name: 'Мама', roles: ['parent'] }).run();
  db.insert(schema.children).values({ id: 'c1', familyId: 'f1', firstName: 'Маша' }).run();
  db.insert(schema.places).values({ id: 'p1', familyId: 'f1', name: 'Дом', address: 'Петровский пр.', lat: 59.96, lon: 30.27 }).run();
  db.insert(schema.places).values({ id: 'p2', familyId: 'f1', name: 'Школа', address: 'пр. Динамо', lat: 59.97, lon: 30.27 }).run();
});

const base = () => ({
  childIds: ['c1'],
  time: '14:20',
  rule: 'FREQ=WEEKLY;BYDAY=TU',
  startDate: addDays(localDate(), 1),
  escort: 'to_door' as const,
});

describe('заявка на поездку', () => {
  it('принимает разные места', () => {
    expect(() => createRequest('f1', 'u1', { ...base(), fromPlaceId: 'p1', toPlaceId: 'p2' })).not.toThrow();
  });
  it('не принимает «откуда» и «куда» из одного места', () => {
    expect(() => createRequest('f1', 'u1', { ...base(), fromPlaceId: 'p1', toPlaceId: 'p1' })).toThrow('один и тот же адрес');
  });
  it('не принимает одинаковые адреса, написанные по-разному регистром и пробелами', () => {
    expect(() => createRequest('f1', 'u1', { ...base(), fromAddress: 'Невский 1 ', toAddress: 'невский 1' })).toThrow('один и тот же адрес');
  });
  it('не принимает прошедшую дату', () => {
    expect(() => createRequest('f1', 'u1', { ...base(), startDate: '2020-01-01', fromPlaceId: 'p1', toPlaceId: 'p2' })).toThrow('Дата уже прошла');
  });
});
