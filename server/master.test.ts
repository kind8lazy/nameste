import { describe, expect, it, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';

process.env.DEMO_MODE = '0';
process.env.MASTER_CODE_SHA256 = createHash('sha256').update('1234567').digest('hex');
process.env.MASTER_PHONE = '+7 999 555-44-33';
const { runMigrations, db, schema } = await import('./db/client');
const { redeemCode, userFromToken } = await import('./modules/auth');

beforeAll(() => runMigrations());

describe('мастер-код диспетчера', () => {
  it('без диспетчера с этим телефоном не пускает', () => {
    db.insert(schema.users).values({ id: 'm_parent', name: 'Родитель', phone: '+79995554433', roles: ['parent'] }).run();
    expect(() => redeemCode('1234567', '10.1.0.1')).toThrow('Код не подходит');
  });
  it('пускает диспетчера, много раз и с разных адресов', () => {
    db.update(schema.users).set({ roles: ['dispatcher', 'driver'] }).run();
    for (const ip of ['10.1.0.2', '10.1.0.3', '10.1.0.2']) {
      const { token, user } = redeemCode('123-45-67', ip);
      expect(user.id).toBe('m_parent');
      expect(userFromToken(token)?.roles).toContain('dispatcher');
    }
  });
  it('неверный код не подходит', () => {
    expect(() => redeemCode('1234568', '10.1.0.4')).toThrow('Код не подходит');
  });
});
