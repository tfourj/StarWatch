import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { getDb } from "../db/client";
import { account, user } from "../db/schema";

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
  };
}

export const security = new Hono<AuthedEnv>().get("/", (c) => c.json(securityView(c.get("user").id)));
