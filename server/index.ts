// Точка входа сервера НА МЕСТЕ.
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      return { message: issue.received === 'undefined' ? 'обязательное поле' : 'неверный формат' };
    case 'too_small':
      return { message: issue.type === 'array' ? 'выберите хотя бы один вариант' : 'слишком коротко' };
    case 'too_big':
      return { message: 'слишком длинно' };
    case 'invalid_string':
    case 'invalid_enum_value':
      return { message: 'неверное значение' };
    default:
      return { message: ctx.defaultError };
  }
});
import { config } from './config';
import { runMigrations } from './db/client';
import { HttpError, userFromToken, SESSION_COOKIE, enforceDemoPolicy, sweepLimiters } from './modules/auth';
import { startJobs } from './modules/jobs';
import { publicRoutes } from './routes/public';
import { parentRoutes } from './routes/parent';
import { driverRoutes } from './routes/driver';
import { adminRoutes } from './routes/admin';
import { trackRoutes } from './routes/track';
import { yandexAuthRoutes, sweepFlows } from './routes/yandex-auth';
import { trackerRoutes } from './routes/tracker';
import { chatRoutes } from './routes/chat';
import { adminEditRoutes } from './routes/admin-edit';

runMigrations();

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'warn' },
  // адрес клиента берём из заголовка только от своего прокси на этой же машине (Caddy, tailscale serve)
  trustProxy: ['127.0.0.1', '::1'],
  bodyLimit: 1_000_000,
  // в адресах трекера есть его ключ и координаты — в журнал их не пишем
  disableRequestLogging: true,
});

await app.register(cookie);
app.decorateRequest('user', null);
// заголовки безопасности: не вставлять приложение в чужую страницу, не выдавать адрес страницы (в нём ключ ссылки) чужим сайтам
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
});
app.addHook('onRequest', async (req) => {
  req.user = userFromToken(req.cookies[SESSION_COOKIE]);
});

// Простой режим: слежение, карта, цены и ссылки для близких закрыты и на сервере, а не только скрыты в приложении
const LITE_BLOCKED = ['/api/parent/track-link', '/api/track/', '/api/route', '/api/driver/position', '/api/osmand', '/api/demo/', '/api/parent/quote'];
app.addHook('onRequest', async (req, reply) => {
  if (config.liteMode && LITE_BLOCKED.some((p) => req.url.startsWith(p))) return reply.code(404).send({ error: 'Эта возможность пока отключена' });
});

// Защита от подделки запросов с чужих сайтов: изменяющие запросы к API принимаем только со своих страниц.
// Трекер (Traccar Client) — не браузер, ему проверка не нужна.
const ownOrigins = new Set([new URL(config.publicUrl).origin]);
if (process.env.NODE_ENV !== 'production') ['http://localhost:5173', 'http://localhost:3000'].forEach((o) => ownOrigins.add(o));
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'GET' || req.method === 'HEAD' || !req.url.startsWith('/api/') || req.url.startsWith('/api/osmand')) return;
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  if (site === 'cross-site' || (origin && !ownOrigins.has(origin))) {
    return reply.code(403).send({ error: 'Запрос с чужого сайта отклонён' });
  }
});

const FIELD_RU: Record<string, string> = {
  name: 'название или имя',
  firstName: 'имя ребёнка',
  phone: 'телефон',
  email: 'почта',
  birthDate: 'дата рождения',
  address: 'адрес',
  lat: 'адрес',
  lon: 'адрес',
  time: 'время',
  date: 'дата',
  startDate: 'дата начала',
  relation: 'кто это',
  note: 'заметка',
  notes: 'заметка',
  comment: 'комментарий',
  code: 'код',
};

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  if ((err as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY' || (err as { code?: string }).code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
    return reply.code(400).send({ error: 'Не удалось прочитать данные запроса' });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = FIELD_RU[String(first?.path[first.path.length - 1] ?? '')];
    const error = first ? `Проверьте ${field ? `поле «${field}»` : 'данные'}: ${first.message}` : 'Проверьте данные';
    return reply.code(400).send({ error, details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  req.log.error(err);
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  return reply.code(status).send({ error: status < 500 ? (err as Error).message : 'Что-то пошло не так. Попробуйте ещё раз.' });
});

await app.register(
  async (api) => {
    await api.register(publicRoutes);
    await api.register(parentRoutes);
    await api.register(driverRoutes);
    await api.register(adminRoutes);
    await api.register(trackRoutes);
    await api.register(yandexAuthRoutes);
    await api.register(trackerRoutes);
    await api.register(chatRoutes);
    await api.register(adminEditRoutes);
  },
  { prefix: '/api' },
);

// В рабочем режиме сервер сам отдаёт собранное веб-приложение
const webDir = path.join(config.root, 'dist', 'web');
if (fs.existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Не найдено' });
  });
}

enforceDemoPolicy((m) => app.log.warn(m));
startJobs((m) => app.log.warn(m));
// чистим счётчики попыток и незавершённые входы по коду
setInterval(() => {
  sweepLimiters();
  sweepFlows();
}, 5 * 60_000).unref();
await app.listen({ port: config.port, host: config.host });
console.log(`НА МЕСТЕ: сервер на http://${config.host}:${config.port}`);
