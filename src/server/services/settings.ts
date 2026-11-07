import { eq } from "drizzle-orm";
import type { MessageTemplates } from "../../shared/templates";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { appSettings, userSettings, type UserSettings } from "../db/schema";
import { GitHubClient } from "../github/client";
import { cipher, hint, randomToken } from "../lib/crypto";

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

export type TunnelMode = "token" | "quick";

export interface TunnelSettings {
  enabled: boolean;
  mode: TunnelMode;
  token: string | null;
  tokenHint: string | null;
  hostname: string | null;
  /** Last URL a quick tunnel reported. It changes on every cloudflared start. */
  quickUrl: string | null;
}

export function getTunnelSettings(): TunnelSettings {
  const stored = getAppSetting("cloudflared_token");
  const token = stored ? cipher().decrypt(stored) : null;
  return {
    enabled: getAppSetting("cloudflared_enabled") === "true",
    mode: getAppSetting("cloudflared_mode") === "quick" ? "quick" : "token",
    token,
    tokenHint: token ? hint(token) : null,
    hostname: getAppSetting("cloudflared_hostname"),
    quickUrl: getAppSetting("cloudflared_quick_url"),
  };
}

export function updateTunnelSettings(
  patch: Partial<Pick<TunnelSettings, "enabled" | "mode" | "token" | "hostname" | "quickUrl">>,
) {
  if (patch.enabled !== undefined) setAppSetting("cloudflared_enabled", patch.enabled ? "true" : null);
  if (patch.mode !== undefined) setAppSetting("cloudflared_mode", patch.mode);
  if (patch.token !== undefined) setAppSetting("cloudflared_token", patch.token ? cipher().encrypt(patch.token) : null);
  if (patch.hostname !== undefined) setAppSetting("cloudflared_hostname", patch.hostname);
  if (patch.quickUrl !== undefined) setAppSetting("cloudflared_quick_url", patch.quickUrl);
}

/** Accept "stars.example.com" or a full URL and return the bare lowercase hostname, or null when invalid. */
export function normalizeTunnelHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  return new RegExp(`^(?:${label}\\.)+[a-z]{2,63}$`).test(host) && host.length <= 253 ? host : null;
}

/** Public base URL served by the Cloudflare tunnel, or null when the tunnel is off or its URL is not known yet. */
export function getTunnelBaseUrl(): string | null {
  const tunnel = getTunnelSettings();
  if (!tunnel.enabled) return null;
  if (tunnel.mode === "token") return tunnel.hostname ? `https://${tunnel.hostname}` : null;
  return tunnel.quickUrl;
}

export function getWebhookBaseUrl(): string {
  return getTunnelBaseUrl() || getAppSetting("webhook_base_url") || getConfig().baseUrl;
}

export function getWebhookUrl(): string {
  return getWebhookBaseUrl().replace(/\/+$/, "") + WEBHOOK_PATH;
}
