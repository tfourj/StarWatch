import { eq } from "drizzle-orm";
import type { MessageTemplates } from "../../shared/templates";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { appSettings, userSettings, type UserSettings } from "../db/schema";
import { GitHubClient } from "../github/client";
import { cipher, randomToken } from "../lib/crypto";

export const WEBHOOK_PATH = "/api/webhooks/github";

export function getUserSettings(userId: string): UserSettings {
  const db = getDb();
  db.insert(userSettings).values({ userId }).onConflictDoNothing().run();
  return db.select().from(userSettings).where(eq(userSettings.userId, userId)).get()!;
}

export function updateUserSettings(userId: string, patch: Partial<Omit<UserSettings, "userId">>) {
  getUserSettings(userId);
  getDb().update(userSettings).set(patch).where(eq(userSettings.userId, userId)).run();
}

export function listUsersWithTokens(): UserSettings[] {
  return getDb()
    .select()
    .from(userSettings)
    .all()
    .filter((s) => s.githubToken);
}

export function getGithubToken(userId: string): string | null {
  const settings = getUserSettings(userId);
  return settings.githubToken ? cipher().decrypt(settings.githubToken) : null;
}

export function getGithubClient(userId: string): GitHubClient | null {
  const token = getGithubToken(userId);
  return token ? new GitHubClient(token, userId) : null;
}

export function getUserTemplates(userId: string): Partial<MessageTemplates> | null {
  return (getUserSettings(userId).templates as Partial<MessageTemplates> | null) ?? null;
}

export function getAppSetting(key: string): string | null {
  return getDb().select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

export function setAppSetting(key: string, value: string | null) {
  const db = getDb();
  if (value === null) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .run();
}

/** Per-install secret used to sign every GitHub webhook. Generated on first use. */
export function getWebhookSecret(): string {
  const stored = getAppSetting("webhook_secret");
  if (stored) return cipher().decrypt(stored);
  const secret = randomToken(32);
  getDb()
    .insert(appSettings)
    .values({ key: "webhook_secret", value: cipher().encrypt(secret) })
    .onConflictDoNothing()
    .run();
  return cipher().decrypt(getAppSetting("webhook_secret")!);
}

export function getWebhookBaseUrl(): string {
  return getAppSetting("webhook_base_url") || getConfig().baseUrl;
}

export function getWebhookUrl(): string {
  return getWebhookBaseUrl().replace(/\/+$/, "") + WEBHOOK_PATH;
}
