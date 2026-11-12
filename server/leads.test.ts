import { describe, expect, it, beforeAll } from 'vitest';

process.env.DEMO_MODE = '0';
const { runMigrations, db, schema } = await import('./db/client');
const { createLead, listLeads, decideLead } = await import('./modules/leads');

const lead = { externalId: 'tg-1-1', tgChatId: '1', tgUsername: '@anna', name: 'Анна', phone: '8 921 123-45-67', children: 'Маша, 4 класс', fromText: 'Школа', toText: 'Теннис', schedule: 'пн, ср в 14:20' };

beforeAll(() => {
  runMigrations();
  db.insert(schema.users).values({ id: 'disp', name: 'Диспетчер', roles: ['dispatcher'] }).run();
});

describe('заявки из Телеграм-бота', () => {
  it('сохраняет заявку с нормальным телефоном и без @ в имени пользователя', async () => {
    const r = await createLead(lead);
    expect(r.duplicate).toBe(false);
    const [l] = listLeads();
    expect(l.phoneRaw).toBe('79211234567');
    expect(l.phone).toBe('+7 921 123-45-67');
    expect(l.tgUsername).toBe('anna');
    expect(l.status).toBe('new');
  });

  it('повторная отправка той же заявки (бот досылает после сбоя) не создаёт дубль', async () => {
    const r = await createLead(lead);
    expect(r.duplicate).toBe(true);
    expect(listLeads()).toHaveLength(1);
  });

  it('неверный телефон отклоняется', async () => {
    await expect(createLead({ ...lead, externalId: 'tg-1-2', phone: '123' })).rejects.toThrow('телефон');
  });

  it('диспетчер отмечает «связались»', () => {
    const [l] = listLeads();
    decideLead(l.id, 'done', 'Завели семью');
    expect(listLeads()[0]).toMatchObject({ status: 'done', note: 'Завели семью' });
  });
});
