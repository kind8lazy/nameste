// Сообщения: список чатов, переписка, отправка. Доступ — только вошедшим, права — в modules/chat.ts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../modules/auth';
import { HttpError } from '../modules/auth';
import { listThreads, listMessages, sendMessage, markRead, requireAccess, unreadTotal, MAX_LEN } from '../modules/chat';

const sendLimit = new Map<string, number[]>();
/** Не больше 30 сообщений в минуту от одного человека. */
function tooFast(userId: string): boolean {
  const now = Date.now();
  const recent = (sendLimit.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  sendLimit.set(userId, recent);
  return recent.length > 30;
}

export async function chatRoutes(app: FastifyInstance) {
  app.get('/chat/threads', async (req) => listThreads(requireUser(req)));
  app.get('/chat/unread', async (req) => ({ count: unreadTotal(requireUser(req)) }));

  const thread = z.object({ thread: z.string().min(4).max(80) });

  app.get('/chat/messages', async (req) => {
    const user = requireUser(req);
    const q = thread.extend({ after: z.string().max(40).optional() }).parse(req.query);
    return listMessages(user, q.thread, q.after);
  });

  app.post('/chat/messages', async (req) => {
    const user = requireUser(req);
    const b = thread.extend({ body: z.string().max(MAX_LEN + 500) }).parse(req.body);
    if (tooFast(user.id)) throw new HttpError(429, 'Слишком часто. Подождите минуту.');
    return sendMessage(user, b.thread, b.body);
  });

  app.post('/chat/read', async (req) => {
    const user = requireUser(req);
    const b = thread.parse(req.body);
    requireAccess(user, b.thread);
    markRead(user.id, b.thread);
    return { ok: true };
  });
}
