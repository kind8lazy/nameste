// Заявки новых семей из Телеграм-бота: принять, показать диспетчеру, отметить «связались» или «отказ».
import { desc, eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client';
import { newId } from '../lib/ids';
import { normalizePhone, formatPhone } from '../../shared/phone';
import { notifyUsers } from './notify';
import { publish, channel } from './realtime';
import { HttpError } from './auth';

const text = (max: number) => z.string().trim().min(1).max(max);

export const leadInput = z.object({
  externalId: z.string().trim().min(4).max(80),
  tgChatId: z.string().trim().max(40).optional(),
  tgUsername: z.string().trim().max(64).optional(),
  name: text(80),
  phone: text(30),
  children: text(300),
  fromText: text(300),
  toText: text(300),
  schedule: text(300),
  comment: z.string().trim().max(1000).optional(),
});
export type LeadInput = z.infer<typeof leadInput>;

export type LeadView = ReturnType<typeof leadView>;

function leadView(l: typeof schema.leads.$inferSelect) {
  return {
    id: l.id,
    name: l.name,
    phone: formatPhone(l.phone) || l.phone,
    phoneRaw: l.phone,
    tgUsername: l.tgUsername,
    children: l.children,
    fromText: l.fromText,
    toText: l.toText,
    schedule: l.schedule,
    comment: l.comment,
    status: l.status,
    note: l.note,
    createdAt: l.createdAt.toISOString(),
  };
}

/** Новая заявка от бота. Та же заявка, присланная повторно (бот досылает после сбоя), не создаёт дубль. */
export async function createLead(input: LeadInput) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new HttpError(400, 'Проверьте телефон');
  const existing = db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.source, 'telegram'), eq(schema.leads.externalId, input.externalId)))
    .get();
  if (existing) return { id: existing.id, duplicate: true };

  const id = newId('lead');
  db.insert(schema.leads)
    .values({ id, source: 'telegram', ...input, phone, tgUsername: input.tgUsername?.replace(/^@/, '') || null, comment: input.comment || null })
    .run();

  const dispatchers = db
    .select()
    .from(schema.users)
    .all()
    .filter((u) => u.roles.includes('dispatcher'))
    .map((u) => u.id);
  await notifyUsers(dispatchers, 'lead', {
    title: `Заявка из Телеграма: ${input.name}`,
    body: `${input.children} · ${input.schedule}`,
    priority: 'important',
    url: '/admin/inbox',
  }).catch(() => {});
  publish(channel.dispatch, 'rides', { lead: id });
  return { id, duplicate: false };
}

export function listLeads() {
  return db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt)).limit(100).all().map(leadView);
}

export function decideLead(id: string, status: 'done' | 'declined', note?: string) {
  const l = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!l) throw new HttpError(404, 'Заявка не найдена');
  db.update(schema.leads).set({ status, note: note?.trim() || null, decidedAt: new Date() }).where(eq(schema.leads.id, id)).run();
  publish(channel.dispatch, 'rides', { lead: id });
  return { ok: true };
}
