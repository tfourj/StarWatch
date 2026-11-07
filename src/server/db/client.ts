import { Database } from "bun:sqlite";
import path from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { logger } from "../logger";
import * as schema from "./schema";

export type DB = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function openDatabase(file: string): DB {
  const sqlite = new Database(file, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  return drizzle({ client: sqlite, schema }) as DB;
}

export function migrationsFolder(): string {
  return path.resolve(process.env.MIGRATIONS_DIR ?? "drizzle");
}

export function runMigrations(db: DB, folder = migrationsFolder()) {
  migrate(db, { migrationsFolder: folder });
  logger.info("database migrations applied", { folder });
}

let instance: DB | null = null;

export function initDb(file: string): DB {
  instance = openDatabase(file);
  return instance;
}

export function getDb(): DB {
  if (!instance) throw new Error("database not initialized");
  return instance;
}

/** Test helper. */
export function setDb(db: DB) {
  instance = db;
}

/** Drizzle types bun-sqlite `.run()` as void, but Bun returns `{ changes, lastInsertRowid }`. */
export function affected(result: unknown): number {
  return (result as { changes?: number } | undefined)?.changes ?? 0;
}
