import { describe, expect, it, beforeAll } from 'vitest';

process.env.DEMO_MODE = '0';
const { runMigrations, db, schema } = await import('./db/client');
const chat = await import('./modules/chat');

const parent = { id: 'p1', name: 'Анна', roles: ['parent'] } as never;
const otherParent = { id: 'p2', name: 'Олег', roles: ['parent'] } as never;
const dispatcher = { id: 'd1', name: 'Диспетчер', roles: ['dispatcher'] } as never;
const driver = { id: 'dr1', name: 'Водитель', roles: ['driver'] } as never;

beforeAll(() => {
  runMigrations();
  for (const u of [
    { id: 'p1', name: 'Анна', roles: ['parent'] as const },
    { id: 'p2', name: 'Олег', roles: ['parent'] as const },
    { id: 'd1', name: 'Диспетчер', roles: ['dispatcher'] as const },
    { id: 'dr1', name: 'Водитель', roles: ['driver'] as const },
  ]) db.insert(schema.users).values({ id: u.id, name: u.name, roles: [...u.roles] }).run();
  db.insert(schema.families).values({ id: 'f1', name: 'Петровы' }).run();
  db.insert(schema.families).values({ id: 'f2', name: 'Сидоровы' }).run();
  db.insert(schema.familyMembers).values({ familyId: 'f1', userId: 'p1', relation: 'мама', isOwner: true, canEdit: true }).run();
  db.insert(schema.familyMembers).values({ familyId: 'f2', userId: 'p2', relation: 'папа', isOwner: true, canEdit: true }).run();
});

describe('доступ к чатам', () => {
  it('родитель — только в чат своей семьи', () => {
    expect(chat.canAccess(parent, 'family:f1')).toBe(true);
    expect(chat.canAccess(parent, 'family:f2')).toBe(false);
    expect(chat.canAccess(parent, chat.TEAM)).toBe(false);
  });
  it('диспетчер и водитель — во все семьи и в чат команды', () => {
    for (const u of [dispatcher, driver]) {
      expect(chat.canAccess(u, 'family:f1')).toBe(true);
      expect(chat.canAccess(u, 'family:f2')).toBe(true);
      expect(chat.canAccess(u, chat.TEAM)).toBe(true);
    }
  });
  it('несуществующая семья и чужой формат закрыты', () => {
    expect(chat.canAccess(dispatcher, 'family:nope')).toBe(false);
    expect(chat.canAccess(dispatcher, 'bogus')).toBe(false);
  });
});

describe('сообщения', () => {
  it('родитель пишет, диспетчер читает, у родителя — прочитано', async () => {
    await chat.sendMessage(parent, 'family:f1', '  Заберём сегодня сами  ');
    const seen = chat.listMessages(dispatcher, 'family:f1');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ body: 'Заберём сегодня сами', authorName: 'Анна', authorRole: 'родитель', mine: false });
    expect(chat.listThreads(dispatcher).find((t) => t.id === 'family:f1')?.unread).toBe(1);
    chat.markRead('d1', 'family:f1');
    expect(chat.listThreads(dispatcher).find((t) => t.id === 'family:f1')?.unread).toBe(0);
    expect(chat.listThreads(parent)).toHaveLength(1);
  });
  it('диспетчер отвечает — у родителя появляется непрочитанное', async () => {
    await chat.sendMessage(dispatcher, 'family:f1', 'Хорошо, отметил');
    expect(chat.unreadTotal(parent)).toBe(1);
    expect(chat.unreadTotal(otherParent)).toBe(0);
  });
  it('чужой родитель не читает и не пишет', async () => {
    expect(() => chat.listMessages(otherParent, 'family:f1')).toThrow('недоступен');
    await expect(chat.sendMessage(otherParent, 'family:f1', 'привет')).rejects.toThrow('недоступен');
  });
  it('пустое и слишком длинное сообщения отклоняются', async () => {
    await expect(chat.sendMessage(parent, 'family:f1', '   ')).rejects.toThrow('Напишите');
    await expect(chat.sendMessage(parent, 'family:f1', 'я'.repeat(chat.MAX_LEN + 1))).rejects.toThrow('длиннее');
  });
  it('чат команды — только сотрудникам', async () => {
    await chat.sendMessage(driver, chat.TEAM, 'Выезжаю');
    expect(chat.listMessages(dispatcher, chat.TEAM)).toHaveLength(1);
    expect(() => chat.listMessages(parent, chat.TEAM)).toThrow('недоступен');
    expect(chat.listThreads(parent).some((t) => t.id === chat.TEAM)).toBe(false);
  });
});
