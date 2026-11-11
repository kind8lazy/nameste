// Заявки из Телеграм-бота. Бот присылает их с секретным ключом; диспетчер видит во «Входящих».
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { sha256 } from '../lib/ids';
import { HttpError, requireRole } from '../modules/auth';
import { createLead, decideLead, leadInput, listLeads } from '../modules/leads';

/** Сравниваем хеши, а не строки: время ответа не подсказывает, сколько символов секрета угадано. */
function secretOk(given: string | undefined): boolean {
  if (!config.leadsSecret || !given) return false;
  return timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(sha256(config.leadsSecret)));
}

export async function leadRoutes(app: FastifyInstance) {
  app.post('/leads', async (req) => {
    if (!config.leadsSecret) throw new HttpError(404, 'Приём заявок от бота выключен');
    if (!secretOk(req.headers['x-bot-secret'] as string | undefined)) throw new HttpError(401, 'Неверный ключ бота');
    return createLead(leadInput.parse(req.body));
  });

  app.get('/admin/leads', async (req) => {
    requireRole(req, 'dispatcher');
    return listLeads();
  });

  app.post('/admin/leads/:id', async (req) => {
    requireRole(req, 'dispatcher');
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ status: z.enum(['done', 'declined']), note: z.string().max(300).optional() }).parse(req.body);
    return decideLead(id, b.status, b.note);
  });
}
