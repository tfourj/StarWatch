import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { LOG_LEVELS, logBuffer, type LogLevel } from "../log-buffer";

const isLevel = (value: string | undefined): value is LogLevel => Boolean(value && value in LOG_LEVELS);

export const logs = new Hono<AuthedEnv>().get("/", (c) => {
  const after = Number(c.req.query("after"));
  const limit = Number(c.req.query("limit"));
  const level = c.req.query("level");
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return c.json({
    entries: logBuffer.query({
      after: Number.isFinite(after) && after > 0 ? after : undefined,
      minLevel: isLevel(level) ? level : undefined,
      scope: c.req.query("scope") || undefined,
      q: c.req.query("q") || undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }),
    lastId: logBuffer.lastId,
    scopes: logBuffer.scopes(),
    logLevel: isLevel(configured) ? configured : "info",
  });
});
