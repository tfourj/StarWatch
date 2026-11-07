import { Hono } from "hono";
import { DEFAULT_TEMPLATES, type MessageTemplates } from "../../shared/templates";
import { requireAdmin, type AuthedEnv } from "../auth/middleware";
import { getConfig, normalizeBaseUrl } from "../config";
import { getRateLimit, GitHubError } from "../github/client";
import { checkScopes, validateToken } from "../github/token";
import { cipher, hint } from "../lib/crypto";
import { HttpError, readJson } from "../lib/http";
import { mergeTemplates } from "../lib/template";
import { logger } from "../logger";
import { syncRepositories } from "../services/repos";
import {
  getAppSetting,
  getGithubToken,
  getTunnelBaseUrl,
  getTunnelSettings,
  getUserSettings,
  getWebhookUrl,
  listUsersWithTokens,
  normalizeTunnelHostname,
  setAppSetting,
  updateTunnelSettings,
  updateUserSettings,
  type TunnelSettings,
} from "../services/settings";
import { applyTunnelSettings, getTunnelStatus } from "../services/tunnel";

const log = logger.child("settings");

function settingsView(userId: string, isAdmin: boolean) {
  const s = getUserSettings(userId);
  const scopes = s.githubScopes ?? null;
  const check = s.githubToken ? checkScopes(scopes) : { missing: [], warnings: [] };
  const config = getConfig();
  return {
    github: {
      connected: Boolean(s.githubToken),
      login: s.githubLogin,
      tokenHint: s.githubTokenHint,
      scopes,
      missingScopes: check.missing,
      warnings: check.warnings,
      checkedAt: s.githubTokenCheckedAt,
      rateLimit: getRateLimit(userId),
      lastSyncAt: s.lastSyncAt,
      lastSyncError: s.lastSyncError,
      lastPollAt: s.lastPollAt,
    },
    pollingIntervalMinutes: s.pollingIntervalMinutes,
    autoMonitorNew: s.autoMonitorNew,
    templates: mergeTemplates(s.templates as Partial<MessageTemplates> | null),
    defaultTemplates: DEFAULT_TEMPLATES,
    webhook: {
      url: getWebhookUrl(),
      baseUrlOverride: getAppSetting("webhook_base_url"),
      defaultBaseUrl: config.baseUrl,
      tunnel: getTunnelBaseUrl() !== null,
      canEdit: isAdmin,
    },
    server: { timezone: config.timezone, allowRegistration: config.allowRegistration },
  };
}

function storeToken(userId: string, token: string, info: Awaited<ReturnType<typeof validateToken>>) {
  updateUserSettings(userId, {
    githubToken: cipher().encrypt(token),
    githubTokenHint: hint(token),
    githubLogin: info.login,
    githubScopes: info.scopes,
    githubTokenCheckedAt: new Date(),
  });
}

function tunnelView() {
  const tunnel = getTunnelSettings();
  return {
    enabled: tunnel.enabled,
    mode: tunnel.mode,
    tokenHint: tunnel.tokenHint,
    hostname: tunnel.hostname,
    webhookUrl: getTunnelBaseUrl() ? getWebhookUrl() : null,
    localService: `http://localhost:${getConfig().tunnelPort}`,
    status: getTunnelStatus(),
  };
}

/** Pull the token out of a pasted value, which may be the whole "cloudflared service install <token>" command. */
function extractTunnelToken(value: string): string {
  const token = value.trim().split(/\s+/).pop() ?? "";
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as { t?: unknown };
    if (typeof decoded.t === "string") return token;
  } catch {
    // fall through
  }
  throw new HttpError(400, "That does not look like a Cloudflare tunnel token");
}

async function validateOrThrow(token: string) {
  try {
    return await validateToken(token);
  } catch (err) {
    if (err instanceof GitHubError) throw new HttpError(err.status === 401 ? 400 : 502, err.message);
    throw new HttpError(502, err instanceof Error ? err.message : String(err));
  }
}

export const settingsRoutes = new Hono<AuthedEnv>()
  .get("/", (c) => {
    const user = c.get("user");
    return c.json(settingsView(user.id, user.role === "admin"));
  })
  .patch("/", async (c) => {
    const user = c.get("user");
    const body = await readJson<{
      pollingIntervalMinutes?: unknown;
      autoMonitorNew?: unknown;
      templates?: Partial<MessageTemplates> | null;
    }>(c);
    const patch: Parameters<typeof updateUserSettings>[1] = {};
    if (body.pollingIntervalMinutes !== undefined) {
      const minutes = Number(body.pollingIntervalMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        throw new HttpError(400, "Polling interval must be between 1 and 1440 minutes");
      }
      patch.pollingIntervalMinutes = minutes;
    }
    if (body.autoMonitorNew !== undefined) patch.autoMonitorNew = Boolean(body.autoMonitorNew);
    if (body.templates !== undefined) {
      const templates: Record<string, string> = {};
      for (const key of Object.keys(DEFAULT_TEMPLATES) as (keyof MessageTemplates)[]) {
        const value = body.templates?.[key];
        if (typeof value === "string" && value.trim() && value !== DEFAULT_TEMPLATES[key]) {
          templates[key] = value.slice(0, 2000);
        }
      }
      patch.templates = Object.keys(templates).length ? templates : null;
    }
    updateUserSettings(user.id, patch);
    return c.json(settingsView(user.id, user.role === "admin"));
  })
  .put("/github-token", async (c) => {
    const user = c.get("user");
    const { token } = await readJson<{ token?: string }>(c);
    const trimmed = token?.trim();
    if (!trimmed) throw new HttpError(400, "Token is required");
    const info = await validateOrThrow(trimmed);
    storeToken(user.id, trimmed, info);
    log.info("github token saved", { userId: user.id, login: info.login, scopes: info.scopes });
    void syncRepositories(user.id).catch(() => undefined);
    return c.json({ ...settingsView(user.id, user.role === "admin"), tokenInfo: info });
  })
  .post("/github-token/check", async (c) => {
    const user = c.get("user");
    const token = getGithubToken(user.id);
    if (!token) throw new HttpError(400, "No token saved");
    const info = await validateOrThrow(token);
    storeToken(user.id, token, info);
    return c.json({ ...settingsView(user.id, user.role === "admin"), tokenInfo: info });
  })
  .delete("/github-token", (c) => {
    const user = c.get("user");
    updateUserSettings(user.id, {
      githubToken: null,
      githubTokenHint: null,
      githubLogin: null,
      githubScopes: null,
      githubTokenCheckedAt: null,
    });
    log.info("github token removed", { userId: user.id });
    return c.json(settingsView(user.id, user.role === "admin"));
  })
  .get("/cloudflared", requireAdmin, (c) => c.json(tunnelView()))
  .put("/cloudflared", requireAdmin, async (c) => {
    const body = await readJson<{ enabled?: unknown; mode?: unknown; token?: unknown; hostname?: unknown }>(c);
    const patch: Partial<TunnelSettings> = {};
    if (body.mode !== undefined) {
      if (body.mode !== "token" && body.mode !== "quick") throw new HttpError(400, "Mode must be token or quick");
      patch.mode = body.mode;
    }
    if (typeof body.token === "string" && body.token.trim()) patch.token = extractTunnelToken(body.token);
    if (body.hostname !== undefined) {
      const raw = typeof body.hostname === "string" ? body.hostname : "";
      const hostname = normalizeTunnelHostname(raw);
      if (raw.trim() && !hostname) throw new HttpError(400, "Public hostname must look like stars.example.com");
      patch.hostname = hostname;
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

    const next = { ...getTunnelSettings(), ...patch };
    if (next.enabled && next.mode === "token" && (!next.token || !next.hostname)) {
      throw new HttpError(400, "Save a tunnel token and public hostname first");
    }

    const previous = getWebhookUrl();
    updateTunnelSettings(patch);
    log.info("cloudflared settings saved", { enabled: next.enabled, mode: next.mode, hostname: next.hostname });
    applyTunnelSettings(previous);
    return c.json(tunnelView());
  })
  .patch("/app", requireAdmin, async (c) => {
    const user = c.get("user");
    const { webhookBaseUrl } = await readJson<{ webhookBaseUrl?: string | null }>(c);
    const previous = getWebhookUrl();
    if (!webhookBaseUrl || !webhookBaseUrl.trim()) {
      setAppSetting("webhook_base_url", null);
    } else {
      let normalized: string;
      try {
        normalized = normalizeBaseUrl(webhookBaseUrl.trim());
        if (!/^https?:/.test(normalized)) throw new Error();
      } catch {
        throw new HttpError(400, "Webhook base URL must be an http(s) URL");
      }
      setAppSetting("webhook_base_url", normalized);
    }
    if (getWebhookUrl() !== previous) {
      log.info("webhook url changed, resyncing hooks", { url: getWebhookUrl() });
      for (const s of listUsersWithTokens()) void syncRepositories(s.userId).catch(() => undefined);
    }
    return c.json(settingsView(user.id, true));
  });
