// Фоновые задачи: поездки на 14 дней вперёд, план дня, напоминания накануне, уборка, резервные копии.
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, schema, backupTo } from '../db/client';
import { config } from '../config';
import { materialize } from './schedule';
import { planDay } from './planner';
import { notifyFamily } from './notify';
import { rideViews } from './rides';
import { cleanupPositions } from './tracking';
import { cleanupAuth } from './auth';
import { addDays, localDate, localTime } from '../../shared/time';
import { reminderMessage } from '../../shared/messages';

const REMINDER_AT = '19:00';

function kvGet(key: string) {
  return db.select().from(schema.kv).where(eq(schema.kv.key, key)).get()?.value ?? null;
}
function kvSet(key: string, value: string) {
  db.insert(schema.kv).values({ key, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value } }).run();
}

export function refreshSchedule() {
  const created = materialize();
  const today = localDate();
  // водитель видит смену на неделю вперёд, поэтому рейсы собираются на 7 дней
  for (let i = 0; i < 7; i++) planDay(addDays(today, i));
  return created;
}

/** «Завтра 3 поездки. Всё в силе?» — каждой семье один раз в день. */
export async function sendReminders(date: string) {
  const rides = db
    .select()
    .from(schema.rides)
    .where(and(eq(schema.rides.date, date), eq(schema.rides.status, 'planned')))
    .all();
  const byFamily = new Map<string, typeof rides>();
  for (const r of rides) byFamily.set(r.familyId, [...(byFamily.get(r.familyId) ?? []), r]);
  for (const [familyId, list] of byFamily) {
    const views = rideViews(list);
    const groups = new Map<string, typeof views>();
    for (const v of views) {
      const k = `${v.pickupTime}|${v.from.id}`;
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    const lines = [...groups.values()]
      .sort((a, b) => a[0].pickupTime.localeCompare(b[0].pickupTime))
      .map((g) => ({
        time: g[0].pickupTime,
        children: g.map((v) => v.child.firstName),
        fromPlace: g[0].from.name,
        toPlace: [...new Set(g.map((v) => v.to.name))].join(', '),
      }));
    await notifyFamily(familyId, 'reminder', reminderMessage(lines), { tag: `reminder-${date}`, url: `/app/week?date=${date}` });
  }
}

async function nightly() {
  cleanupPositions();
  cleanupAuth();
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  await backupTo(path.join(dir, `na-meste-${localDate()}.db`));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  for (const f of files.slice(0, -14)) fs.rmSync(path.join(dir, f));
}

export function startJobs(log: (msg: string) => void) {
  try {
    const n = refreshSchedule();
    log(`Расписание обновлено, новых поездок: ${n}`);
  } catch (e) {
    log(`Ошибка обновления расписания: ${(e as Error).message}`);
  }
  setInterval(() => {
    try {
      refreshSchedule();
    } catch (e) {
      log(`Ошибка обновления расписания: ${(e as Error).message}`);
    }
  }, 10 * 60_000);

  setInterval(async () => {
    const today = localDate();
    const now = localTime();
    const tomorrow = addDays(today, 1);
    if (now >= REMINDER_AT && kvGet('reminder_sent_for') !== tomorrow) {
      kvSet('reminder_sent_for', tomorrow);
      await sendReminders(tomorrow).catch((e) => log(`Напоминания не отправлены: ${(e as Error).message}`));
    }
    if (now >= '03:00' && kvGet('nightly_done') !== today) {
      kvSet('nightly_done', today);
      await nightly().catch((e) => log(`Ночная уборка не прошла: ${(e as Error).message}`));
    }
  }, 60_000);
}
