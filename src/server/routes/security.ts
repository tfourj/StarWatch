import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { getDb } from "../db/client";
import { account, user } from "../db/schema";
import { clientIp, HttpError, readJson } from "../lib/http";
import { getLoginAlertChannelIds, sendLoginAlerts, setLoginAlertChannelIds } from "../services/login-alerts";

/** Two-factor needs a password, so GitHub-only accounts cannot turn it on. */
function hasPassword(userId: string): boolean {
  const row = getDb()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .get();
  return Boolean(row);
}

function securityView(userId: string) {
  const row = getDb().select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)).get();
  return {
    twoFactorEnabled: row?.twoFactorEnabled ?? false,
    hasPassword: hasPassword(userId),
    loginAlerts: { channelIds: getLoginAlertChannelIds(userId) },
  };
}

function readChannelIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new HttpError(400, "channelIds must be an array");
  return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

export const security = new Hono<AuthedEnv>()
  .get("/", (c) => c.json(securityView(c.get("user").id)))
  .put("/login-alerts", async (c) => {
    const userId = c.get("user").id;
    const body = await readJson<{ channelIds?: unknown }>(c);
    setLoginAlertChannelIds(userId, readChannelIds(body.channelIds));
    return c.json(securityView(userId));
  })
  // Sends a sample alert for the current request, to the given channels or the saved ones.
  .post("/login-alerts/test", async (c) => {
    const userId = c.get("user").id;
    const body = await readJson<{ channelIds?: unknown }>(c);
    const channelIds = body.channelIds === undefined ? undefined : readChannelIds(body.channelIds);
    const results = await sendLoginAlerts(
      { userId, method: "Password", ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null, at: new Date() },
      { test: true, channelIds },
    );
    if (results.length === 0) throw new HttpError(400, "Pick at least one enabled channel");
    return c.json({ results });
  });
