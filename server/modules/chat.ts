// Сообщения внутри приложения: чат семьи (родители, диспетчер, водитель) и чат команды (диспетчеры и водители).
// Доступ человеку выдаёт вход через Яндекс ID или код диспетчера: чужого в чате нет, пока он не вошёл и не привязан к семье.
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { HttpError, familyIdsOf, isDemoUser, type SessionUser } from './auth';
import { publish, channel } from './realtime';
import { sendToUser } from './notify';
import { sendMail, mailEnabled } from './mail';

export const TEAM = 'team';
export const MAX_LEN = 2000;

const isStaff = (u: { roles: string[] }) => u.roles.includes('dispatcher') || u.roles.includes('driver');
export const familyThread = (familyId: string) => `family:${familyId}`;

/** Может ли человек читать и писать в этом чате. */
export function canAccess(user: SessionUser, thread: string): boolean {
  if (thread === TEAM) return isStaff(user);
  if (!thread.startsWith('family:')) return false;
  const familyId = thread.slice('family:'.length);
  if (isStaff(user)) return !!db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.id, familyId)).get();
  return familyIdsOf(user.id).includes(familyId);
}

export function requireAccess(user: SessionUser, thread: string) {
  if (!canAccess(user, thread)) throw new HttpError(403, 'Этот чат вам недоступен');
}

const roleOf = (roles: string[]) => (roles.includes('dispatcher') ? 'диспетчер' : roles.includes('driver') ? 'водитель' : 'родитель');

export interface ChatMessageView {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  mine: boolean;
  body: string;
  createdAt: string;
}

export function listMessages(user: SessionUser, thread: string, after?: string): ChatMessageView[] {
  requireAccess(user, thread);
  const since = after ? new Date(after) : null;
  const rows = db
    .select({ m: schema.messages, u: schema.users })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.users.id, schema.messages.authorId))
    .where(since && !Number.isNaN(since.getTime()) ? and(eq(schema.messages.thread, thread), gt(schema.messages.createdAt, since)) : eq(schema.messages.thread, thread))
    .orderBy(desc(schema.messages.createdAt))
    .limit(200)
    .all()
    .reverse();
  return rows.map(({ m, u }) => ({
    id: m.id,
    authorId: u.id,
    authorName: u.name,
    authorRole: roleOf(u.roles),
    mine: u.id === user.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));
}

export function markRead(userId: string, thread: string) {
  const readAt = new Date();
  db.insert(schema.chatReads)
    .values({ userId, thread, readAt })
    .onConflictDoUpdate({ target: [schema.chatReads.userId, schema.chatReads.thread], set: { readAt } })
    .run();
}

function unreadIn(userId: string, thread: string): number {
  const read = db.select().from(schema.chatReads).where(and(eq(schema.chatReads.userId, userId), eq(schema.chatReads.thread, thread))).get();
  const rows = db
    .select({ id: schema.messages.id, authorId: schema.messages.authorId })
    .from(schema.messages)
    .where(read ? and(eq(schema.messages.thread, thread), gt(schema.messages.createdAt, read.readAt)) : eq(schema.messages.thread, thread))
    .all();
  return rows.filter((r) => r.authorId !== userId).length;
}

export interface ThreadView {
  id: string;
  title: string;
  unread: number;
  last: { body: string; at: string; authorName: string } | null;
}

/** Чаты, доступные человеку: родителю — его семья, сотруднику — все семьи и команда. */
export function listThreads(user: SessionUser): ThreadView[] {
  const staff = isStaff(user);
  const families = staff
    ? db.select().from(schema.families).all()
    : db.select().from(schema.families).where(inArray(schema.families.id, familyIdsOf(user.id).length ? familyIdsOf(user.id) : ['-'])).all();
  const ids = [...(staff ? [TEAM] : []), ...families.map((f) => familyThread(f.id))];
  const title = (id: string) => (id === TEAM ? 'Команда: диспетчеры и водители' : staff ? (families.find((f) => familyThread(f.id) === id)?.name ?? 'Семья') : 'Диспетчер и водитель');
  const views = ids.map((id): ThreadView => {
    const last = db
      .select({ m: schema.messages, u: schema.users })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.users.id, schema.messages.authorId))
      .where(eq(schema.messages.thread, id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1)
      .get();
    return { id, title: title(id), unread: unreadIn(user.id, id), last: last ? { body: last.m.body, at: last.m.createdAt.toISOString(), authorName: last.u.name } : null };
  });
  // сверху — где есть непрочитанное, затем по времени последнего сообщения
  return views.sort((a, b) => b.unread - a.unread || (b.last?.at ?? '').localeCompare(a.last?.at ?? '') || a.title.localeCompare(b.title, 'ru'));
}

export function unreadTotal(user: SessionUser): number {
  return listThreads(user).reduce((n, t) => n + t.unread, 0);
}

/** Кому адресовано сообщение: все участники чата, кроме автора. */
function recipients(thread: string, authorId: string): string[] {
  const users = db.select().from(schema.users).all();
  let ids: string[];
  if (thread === TEAM) ids = users.filter(isStaff).map((u) => u.id);
  else {
    const familyId = thread.slice('family:'.length);
    const members = db.select({ userId: schema.familyMembers.userId }).from(schema.familyMembers).where(eq(schema.familyMembers.familyId, familyId)).all().map((m) => m.userId);
    ids = [...new Set([...members, ...users.filter(isStaff).map((u) => u.id)])];
  }
  return ids.filter((id) => id !== authorId && !isDemoUser(id));
}

const lastEmail = new Map<string, number>();

export async function sendMessage(user: SessionUser, thread: string, rawBody: string): Promise<ChatMessageView> {
  requireAccess(user, thread);
  const body = rawBody.replace(/\r\n/g, '\n').trim();
  if (!body) throw new HttpError(400, 'Напишите сообщение');
  if (body.length > MAX_LEN) throw new HttpError(400, `Сообщение длиннее ${MAX_LEN} знаков`);
  const id = newId('msg');
  db.insert(schema.messages).values({ id, thread, authorId: user.id, body }).run();

  // живое обновление у всех открытых экранов
  const familyId = thread.startsWith('family:') ? thread.slice('family:'.length) : null;
  publish(familyId ? [channel.family(familyId), channel.staff] : [channel.staff], 'chat', { thread, id });

  // уведомление: в приложение, а родителю без установленного приложения — письмо на Яндекс-почту (не чаще раза в 10 минут)
  const snippet = body.length > 140 ? `${body.slice(0, 137)}…` : body;
  const title = thread === TEAM ? `Команда: ${user.name}` : `Сообщение: ${user.name}`;
  for (const rid of recipients(thread, user.id)) {
    const u = db.select().from(schema.users).where(eq(schema.users.id, rid)).get();
    if (!u) continue;
    const url = isStaff(u) ? `/admin/chat?thread=${encodeURIComponent(thread)}` : '/app/chat';
    void sendToUser(rid, { title, body: snippet, priority: 'important', url }, { kind: 'chat' }).catch(() => {});
    const hasPush = db.select({ id: schema.pushSubscriptions.id }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, rid)).get();
    if (!hasPush && u.email && mailEnabled() && Date.now() - (lastEmail.get(rid) ?? 0) > 10 * 60_000) {
      lastEmail.set(rid, Date.now());
      void sendMail(u.email, title, `${snippet}\n\nОтветьте в приложении: раздел «Чат».`).catch(() => {});
    }
  }
  return { id, authorId: user.id, authorName: user.name, authorRole: roleOf(user.roles), mine: true, body, createdAt: new Date().toISOString() };
}

