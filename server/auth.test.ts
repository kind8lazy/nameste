import { describe, expect, it, beforeAll } from 'vitest';

process.env.ADMIN_PHONES = '8 (999) 111-22-33';
process.env.DEMO_MODE = '0';
const { runMigrations, db, schema } = await import('./db/client');
const { safeNext } = await import('./routes/yandex-auth');
const { rateKey, redeemCode, createLoginCode, isDemoUser, userFromToken, createSession } = await import('./modules/auth');
const { resolveUser } = await import('./modules/yandex');
const { strictIntlPhone } = await import('../shared/phone');
const { eq } = await import('drizzle-orm');

beforeAll(() => runMigrations());

const addUser = (id: string, extra: Partial<typeof schema.users.$inferInsert> = {}) =>
  db.insert(schema.users).values({ id, name: id, roles: ['parent'], ...extra }).run();

describe('адрес возврата после входа', () => {
  it('пускает только в разделы приложения', () => {
    expect(safeNext('/app/family')).toBe('/app/family');
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/app/week?date=2026-10-17')).toBe('/app/week?date=2026-10-17');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/login?next=//evil')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});

describe('ограничение попыток', () => {
  it('IPv6 считается по подсети /64', () => {
    expect(rateKey('2001:db8:1:2:aaaa::1')).toBe(rateKey('2001:db8:1:2:bbbb::9'));
    expect(rateKey('::ffff:10.0.0.1')).toBe('10.0.0.1');
  });
  it('после 10 попыток с одного адреса — отказ', () => {
    for (let i = 0; i < 10; i++) expect(() => redeemCode('00000000', '10.9.9.9')).toThrow('Код не подходит');
    expect(() => redeemCode('00000000', '10.9.9.9')).toThrow('Слишком много попыток');
  });
});

describe('телефон из Яндекса', () => {
  it('принимается только в международном виде', () => {
    expect(strictIntlPhone('+7 921 123-45-67')).toBe('79211234567');
    expect(strictIntlPhone('+9607771234')).toBe('9607771234');
    expect(strictIntlPhone('89211234567')).toBeNull();
    expect(strictIntlPhone(undefined)).toBeNull();
  });
});

describe('привязка Яндекса', () => {
  it('находит человека по телефону и гасит его приглашения', () => {
    addUser('mom', { phone: '+7 921 000-00-01' });
    createLoginCode('mom', 'invite');
    const id = resolveUser({ id: 'y-mom', name: 'Мама', phone: '79210000001', email: null });
    expect(id).toBe('mom');
    expect(db.select().from(schema.loginCodes).where(eq(schema.loginCodes.userId, 'mom')).all()).toHaveLength(0);
  });
  it('не заменяет уже привязанный Яндекс другим', () => {
    expect(() => resolveUser({ id: 'y-other', name: 'x', phone: null, email: null }, 'mom')).toThrow('уже привязан другой Яндекс');
  });
  it('не отдаёт чужой Яндекс', () => {
    addUser('dad');
    expect(() => resolveUser({ id: 'y-mom', name: 'x', phone: null, email: null }, 'dad')).toThrow('уже привязан к другому человеку');
  });
  it('при двух людях с одним телефоном никого не угадывает — создаёт нового', () => {
    addUser('a1', { phone: '+7 921 555-55-55' });
    addUser('a2', { phone: '8 921 555 55 55' });
    const id = resolveUser({ id: 'y-twin', name: 'Близнец', phone: '79215555555', email: null });
    expect(['a1', 'a2']).not.toContain(id);
  });
  it('демо-аккаунты не находятся и не привязываются', () => {
    addUser('demo-mom', { phone: '+7 900 000-00-01' });
    db.insert(schema.kv).values({ key: 'demo_users', value: JSON.stringify({ parent: 'demo-mom' }) }).run();
    expect(isDemoUser('demo-mom')).toBe(true);
    const id = resolveUser({ id: 'y-stranger', name: 'Чужой', phone: '79000000001', email: null });
    expect(id).not.toBe('demo-mom');
    expect(() => resolveUser({ id: 'y-x', name: 'x', phone: null, email: null }, 'demo-mom')).toThrow('демо');
  });
  it('демо-сессия не действует вне демо-режима', () => {
    const token = createSession('demo-mom');
    expect(userFromToken(token)).toBeNull();
  });
  it('номер из ADMIN_PHONES в любом виде даёт права диспетчера', () => {
    const id = resolveUser({ id: 'y-boss', name: 'Дмитрий', phone: '79991112233', email: null });
    const u = db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
    expect(u.roles).toEqual(expect.arrayContaining(['dispatcher', 'driver']));
  });
});
