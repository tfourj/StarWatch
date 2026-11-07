import { sql } from "drizzle-orm";
import { Hono } from "hono";
import pkg from "../../../package.json";
import { getDb } from "../db/client";

const startedAt = Date.now();
/** From package.json, bundled into the server at build time. */
export const VERSION: string = pkg.version;

export const health = new Hono().get("/", (c) => {
  try {
    getDb().run(sql`select 1`);
    return c.json({ status: "ok", version: VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  } catch (err) {
    return c.json({ status: "error", error: err instanceof Error ? err.message : String(err) }, 503);
  }
});
