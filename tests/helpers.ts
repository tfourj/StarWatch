import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, runMigrations, type DB } from "../src/server/db/client";

process.env.LOG_LEVEL = "error";

export function createTestDb(): { db: DB; file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "starwatch-test-"));
  const file = path.join(dir, "test.db");
  const db = openDatabase(file);
  runMigrations(db, path.resolve(import.meta.dir, "../drizzle"));
  return {
    db,
    file,
    cleanup: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
