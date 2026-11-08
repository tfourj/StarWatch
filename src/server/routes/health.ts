import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { COMMIT, VERSION } from "../lib/build-info";

const startedAt = Date.now();

export const health = new Hono().get("/", (c) => {
  try {
    getDb().run(sql`select 1`);
    const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);
    return c.json({ status: "ok", version: VERSION, commit: COMMIT, uptimeSeconds });
  } catch (err) {
    return c.json({ status: "error", error: err instanceof Error ? err.message : String(err) }, 503);
  }
});
