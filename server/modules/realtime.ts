// Живые обновления через Server-Sent Events: родители, водитель и диспетчер
// получают сигнал «данные изменились» и перечитывают экран; координаты приходят напрямую.
import type { FastifyReply, FastifyRequest } from 'fastify';

interface Client {
  id: number;
  channels: Set<string>;
  reply: FastifyReply;
}

const clients = new Map<number, Client>();
let seq = 0;

export const channel = {
  family: (id: string) => `family:${id}`,
  driver: (userId: string) => `driver:${userId}`,
  dispatch: 'dispatch',
  /** диспетчеры и водители: чат команды и новые сообщения в любой семье */
  staff: 'staff',
};

export function subscribe(req: FastifyRequest, reply: FastifyReply, channels: string[]) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write(`retry: 3000\n: ok\n\n`);
  const client: Client = { id: ++seq, channels: new Set(channels), reply };
  clients.set(client.id, client);
  const ping = setInterval(() => raw.write(`: ping\n\n`), 25_000);
  req.raw.on('close', () => {
    clearInterval(ping);
    clients.delete(client.id);
  });
}

export function publish(channels: string | string[], event: string, data: unknown) {
  const list = Array.isArray(channels) ? channels : [channels];
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients.values()) {
    if (list.some((ch) => c.channels.has(ch))) c.reply.raw.write(payload);
  }
}

export function connectedCount() {
  return clients.size;
}
