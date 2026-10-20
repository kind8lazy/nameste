// Запускает сервер и веб-приложение вместе: npm run dev
import { spawn } from 'node:child_process';

const procs = [
  // сервер всегда на 3000: веб-приложение (5173) проксирует к нему /api
  spawn('npx', ['tsx', 'watch', 'server/index.ts'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.API_PORT ?? '3000' } }),
  spawn('npx', ['vite'], { stdio: 'inherit', env: { ...process.env } }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
