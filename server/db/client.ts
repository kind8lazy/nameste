import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config';
import * as schema from './schema';

export const dbFile = config.dbFile;

const sqlite = new Database(dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;

export function runMigrations() {
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, 'migrations') });
}

/** Резервная копия базы на лету (без остановки сервера). */
export async function backupTo(file: string) {
  await sqlite.backup(file);
}

export { schema };
