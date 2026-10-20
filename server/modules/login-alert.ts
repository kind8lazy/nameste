// Уведомление о новом входе: уходит на уже привязанные устройства и на почту, чтобы чужой вход не остался незамеченным.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { isDemoUser, newLoginMessage } from './auth';
import { sendToUser } from './notify';
import { sendMail, mailEnabled } from './mail';

export async function notifyNewLogin(userId: string, via: string, ua: string | undefined) {
  if (isDemoUser(userId)) return;
  const msg = newLoginMessage(via, ua);
  try {
    await sendToUser(userId, { title: msg.title, body: msg.body, priority: 'important', url: '/app/family' }, { kind: 'new_login' });
    const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (u?.email && mailEnabled()) await sendMail(u.email, msg.title, msg.body);
  } catch (e) {
    console.log(`[Уведомление о входе] не отправлено: ${(e as Error).message}`);
  }
}
