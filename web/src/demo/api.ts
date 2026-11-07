// In-browser stand-in for the StarWatch API, used only by the static demo build (`bun run build:demo`).
// State lives in memory and resets on reload. Anything that would talk to GitHub or send a real
// notification answers with a "not available in the demo" error instead.
import { CHANNEL_TYPES, getChannelType } from "@shared/channels";
import {
  DEMO_GITHUB_LOGIN,
  DEMO_USER,
  DEMO_WEBHOOK_BASE_URL,
  generateDemoData,
  type DemoChannel,
  type DemoData,
  type DemoDelivery,
  type DemoRepo,
} from "@shared/demo-data";
import { validateFrequencyTiers, type FrequencyTier } from "@shared/frequency";
import { LOG_LEVELS, LogBuffer, type LogLevel } from "@shared/log-buffer";
import { DEFAULT_TEMPLATES, type MessageTemplates } from "@shared/templates";
import { ApiError } from "@/lib/api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
let latencyMs = 120;

/** Tests turn the fake network delay off. */
export function setDemoLatency(ms: number) {
  latencyMs = ms;
}
const DEMO_USER_ID = "demo-admin";
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

type Body = Record<string, unknown>;

interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
}

interface State {
  startedAt: number;
  data: DemoData;
  users: DemoUser[];
  settings: {
    pollingIntervalMinutes: number;
    autoMonitorNew: boolean;
    templates: Partial<MessageTemplates> | null;
  };
  logs: LogBuffer;
}

let state: State | null = null;

/** Reset the demo, mainly for tests. */
export function resetDemo(now = Date.now()) {
  const data = generateDemoData(now);
  state = {
    startedAt: now,
    data,
    users: [
      { ...DEMO_USER, id: DEMO_USER_ID, role: "admin", createdAt: new Date(now - 30 * DAY) },
      {
        id: "demo-user-2",
        name: "Sam Lee",
        email: "sam@example.com",
        role: "user",
        createdAt: new Date(now - 12 * DAY),
      },
    ],
    settings: { pollingIntervalMinutes: 15, autoMonitorNew: false, templates: null },
    logs: buildLogs(data, now),
  };
  return state;
}

const getState = () => state ?? resetDemo();

/* --------------------------------- Helpers --------------------------------- */

function unavailable(what: string): never {
  throw new ApiError(`${what} is not available in the demo.`, 400);
}

function badRequest(message: string): never {
  throw new ApiError(message, 400);
}

function notFound(what = "Not found"): never {
  throw new ApiError(what, 404);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirror the real API: plain JSON with dates as strings, and no shared references to the state. */
const toJson = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

function localDayStart(time: number) {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayKey(time: number) {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hint(secret: string) {
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

function repoById(id: number) {
  return getState().data.repos.find((r) => r.id === id) ?? notFound("Repository not found");
}

function channelById(id: number) {
  return getState().data.channels.find((c) => c.id === id) ?? notFound("Channel not found");
}

/* ---------------------------------- Logs ---------------------------------- */

function buildLogs(data: DemoData, now: number) {
  const entries: { time: number; level: LogLevel; scope: string | null; msg: string; fields: Body }[] = [];
  const add = (time: number, level: LogLevel, scope: string | null, msg: string, fields: Body = {}) =>
    entries.push({ time, level, scope, msg, fields });

  const boot = now - 6 * HOUR;
  add(boot, "info", null, "database migrations applied", { folder: "/app/drizzle" });
  add(boot + 50, "info", null, "StarWatch started", { version: VERSION, port: 4321, timezone: "UTC" });
  add(boot + 60, "info", "jobs", "scheduler started", { syncIntervalMinutes: 60 });
  for (let t = boot + 15_000; t < now; t += HOUR) {
    add(t, "info", "sync", "sync complete", { repos: data.repos.length, added: 0, hooksCreated: 0, hookErrors: 0 });
  }

  const channelName = (id: number) => data.channels.find((c) => c.id === id)?.name ?? "channel";
  for (const event of data.events.filter((e) => e.occurredAt.getTime() > boot)) {
    const repo = data.repos.find((r) => r.id === event.repositoryId)!;
    const t = event.occurredAt.getTime();
    if (event.source === "webhook") {
      add(t, "info", "webhook", "star webhook", {
        repo: repo.fullName,
        action: event.action,
        user: event.actorLogin,
        recorded: 1,
      });
    } else {
      add(t, "info", "poll", "repo polled", { repo: repo.fullName, added: event.action === "created" ? 1 : 0 });
    }
    add(t + 5, "info", "stars", "star event recorded", {
      repo: repo.fullName,
      actor: event.actorLogin,
      action: event.action,
      stars: event.starCount,
    });
    for (const d of data.deliveries.filter((x) => x.eventId === event.id)) {
      if (d.status === "success") {
        add(t + 2000, "info", "delivery", "delivered", { channel: channelName(d.channelId), attempt: 1 });
      } else {
        add(t + 2000, "warn", "delivery", "delivery failed", {
          channel: channelName(d.channelId),
          attempt: d.attempts,
          error: d.lastError,
        });
      }
    }
  }
  add(now - 30 * MINUTE, "info", "ping", "webhook ping checked", { repo: "demo/starwatch", ok: true, statusCode: 200 });

  const buffer = new LogBuffer(1000);
  for (const e of entries.sort((a, b) => a.time - b.time)) {
    buffer.push({ time: new Date(e.time).toISOString(), level: e.level, scope: e.scope, msg: e.msg, fields: e.fields });
  }
  return buffer;
}

function log(level: LogLevel, scope: string, msg: string, fields: Body = {}) {
  getState().logs.push({ time: new Date().toISOString(), level, scope, msg, fields });
}

/* ------------------------------ Repositories ------------------------------ */

function applyHookState(repo: DemoRepo) {
  if (repo.monitored && repo.mode !== "polling") {
    if (!repo.hookId) {
      repo.hookId = 1000 + repo.id;
      repo.lastDeliveryAt = null;
    }
    repo.hookStatus = "active";
  } else {
    repo.hookId = null;
    repo.hookStatus = "none";
  }
  repo.hookCheckedAt = new Date();
  // Pretend the stargazer import finished instantly.
  if (repo.monitored && !repo.backfilledAt) repo.backfilledAt = new Date();
}

function repoView(repo: DemoRepo) {
  const { data } = getState();
  return {
    ...repo,
    archived: false,
    hookError: null,
    backfillError: null,
    importing: false,
    channelIds: data.repoChannels.filter((rc) => rc.repositoryId === repo.id).map((rc) => rc.channelId),
  };
}

function listRepos() {
  const { data } = getState();
  return {
    repos: [...data.repos]
      .sort((a, b) => a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()))
      .map(repoView),
    channels: data.channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      allRepos: c.allRepos,
      enabled: c.enabled,
    })),
    webhookUrl: `${DEMO_WEBHOOK_BASE_URL}/api/webhooks/github`,
    hasToken: true,
    lastSyncAt: new Date(Date.now() - 4 * MINUTE),
    lastSyncError: null,
  };
}

function isMode(value: unknown): value is DemoRepo["mode"] {
  return value === "webhook" || value === "polling" || value === "both";
}

function updateRepo(id: number, body: Body) {
  const repo = repoById(id);
  if (body.mode !== undefined && !isMode(body.mode)) badRequest("Invalid mode");
  if (body.monitored !== undefined) repo.monitored = Boolean(body.monitored);
  if (isMode(body.mode)) repo.mode = body.mode;
  applyHookState(repo);
  log("info", "sync", repo.monitored ? "webhook created" : "webhook deleted", { repo: repo.fullName });
  return repoView(repo);
}

function bulkMonitoring(body: Body) {
  if (typeof body.monitored !== "boolean") badRequest("monitored must be true or false");
  if (body.mode !== undefined && !isMode(body.mode)) badRequest("Invalid mode");
  const ids = Array.isArray(body.repoIds) ? new Set(body.repoIds.map(Number)) : null;
  const scope = getState().data.repos.filter((r) => !ids || ids.has(r.id));
  let updated = 0;
  for (const repo of scope) {
    const modeChange = isMode(body.mode) && repo.mode !== body.mode;
    if (repo.monitored === body.monitored && !modeChange) continue;
    repo.monitored = body.monitored;
    if (isMode(body.mode)) repo.mode = body.mode;
    applyHookState(repo);
    updated++;
  }
  log("info", "sync", "bulk monitoring change", { monitored: body.monitored, updated });
  return { updated, hooksPending: 0 };
}

function setRepoChannels(id: number, body: Body) {
  repoById(id);
  if (!Array.isArray(body.channelIds)) badRequest("channelIds must be an array");
  const { data } = getState();
  const valid = new Set(data.channels.map((c) => c.id));
  const wanted = [...new Set(body.channelIds.map(Number))].filter((cid) => valid.has(cid));
  data.repoChannels = [
    ...data.repoChannels.filter((rc) => rc.repositoryId !== id),
    ...wanted.map((channelId) => ({ repositoryId: id, channelId })),
  ];
  return { channelIds: wanted };
}

function listStargazers(id: number, url: URL) {
  const repo = repoById(id);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 50));
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  const all = getState()
    .data.stargazers.filter((s) => s.repositoryId === id && (!q || s.login.toLowerCase().includes(q)))
    .sort((a, b) => b.starredAt.getTime() - a.starredAt.getTime());
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize).map(({ repositoryId: _, ...s }) => s),
    total: all.length,
    page,
    pageSize,
    repo: {
      id: repo.id,
      fullName: repo.fullName,
      htmlUrl: repo.htmlUrl,
      starCount: repo.starCount,
      backfilledAt: repo.backfilledAt,
      backfillError: null,
      importing: false,
    },
  };
}

/* -------------------------------- Dashboard ------------------------------- */

function dashboard() {
  const { data } = getState();
  const now = Date.now();
  const todayStart = localDayStart(now);
  const chartStart = todayStart - 29 * DAY;
  const monitoredIds = new Set(data.repos.filter((r) => r.monitored).map((r) => r.id));
  const monitoredStars = data.stargazers.filter((s) => monitoredIds.has(s.repositoryId));
  const starsSince = (since: number) => monitoredStars.filter((s) => s.starredAt.getTime() >= since).length;

  const buckets = new Map<string, { date: string; stars: number; unstars: number }>();
  for (let i = 0; i < 30; i++) {
    const key = dayKey(chartStart + i * DAY + 12 * HOUR);
    buckets.set(key, { date: key, stars: 0, unstars: 0 });
  }
  for (const s of monitoredStars) {
    const bucket = buckets.get(dayKey(s.starredAt.getTime()));
    if (bucket) bucket.stars++;
  }
  for (const e of data.events.filter((x) => x.action === "deleted")) {
    const bucket = buckets.get(dayKey(e.occurredAt.getTime()));
    if (bucket) bucket.unstars++;
  }

  const weekAgo = now - 7 * DAY;
  const failedDeliveries = data.deliveries.filter((d) => {
    const event = data.events.find((e) => e.id === d.eventId);
    return d.status === "failed" && event && event.occurredAt.getTime() >= weekAgo;
  }).length;

  return {
    stats: {
      totalStars: data.repos.reduce((sum, r) => sum + r.starCount, 0),
      repositories: data.repos.length,
      monitored: monitoredIds.size,
      starsToday: starsSince(todayStart),
      stars7d: starsSince(todayStart - 6 * DAY),
      stars30d: starsSince(chartStart),
      hookErrors: 0,
      failedDeliveries,
    },
    chart: [...buckets.values()],
    recentEvents: eventRows(data.events.slice().sort(byNewest).slice(0, 10)),
    topRepos: [...data.repos]
      .sort((a, b) => b.starCount - a.starCount)
      .slice(0, 5)
      .map((r) => ({ id: r.id, fullName: r.fullName, htmlUrl: r.htmlUrl, starCount: r.starCount })),
    github: {
      connected: true,
      login: DEMO_GITHUB_LOGIN,
      lastSyncAt: new Date(now - 4 * MINUTE),
      lastSyncError: null,
      rateLimit: rateLimit(),
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function rateLimit() {
  return { limit: 5000, remaining: 4871, resetAt: Date.now() + 41 * MINUTE, blockedUntil: 0 };
}

/* --------------------------------- Events --------------------------------- */

const byNewest = (a: { occurredAt: Date; id: number }, b: { occurredAt: Date; id: number }) =>
  b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id;

function deliveryRow(d: DemoDelivery) {
  const channel = getState().data.channels.find((c) => c.id === d.channelId);
  return {
    id: d.id,
    eventId: d.eventId,
    channelId: d.channelId,
    channelName: channel?.name ?? "Deleted channel",
    channelType: channel?.type ?? "webhook",
    status: d.status,
    attempts: d.attempts,
    lastError: d.lastError,
    nextAttemptAt: d.nextAttemptAt,
    deliveredAt: d.deliveredAt,
  };
}

function eventRows(events: DemoData["events"]) {
  const { data } = getState();
  return events.map((e) => {
    const repo = data.repos.find((r) => r.id === e.repositoryId)!;
    return {
      ...e,
      repoFullName: repo.fullName,
      repoUrl: repo.htmlUrl,
      deliveries: data.deliveries.filter((d) => d.eventId === e.id).map(deliveryRow),
    };
  });
}

function listEvents(url: URL) {
  const { data } = getState();
  const p = url.searchParams;
  const page = Math.max(1, Number(p.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(p.get("pageSize")) || 25));
  const repoId = Number(p.get("repoId")) || null;
  const action = p.get("action");
  const source = p.get("source");
  const status = p.get("status");
  const q = p.get("q")?.trim().toLowerCase();

  const matches = data.events
    .filter((e) => {
      if (repoId && e.repositoryId !== repoId) return false;
      if ((action === "created" || action === "deleted") && e.action !== action) return false;
      if ((source === "webhook" || source === "polling") && e.source !== source) return false;
      if (q && !e.actorLogin.toLowerCase().includes(q)) return false;
      const deliveries = data.deliveries.filter((d) => d.eventId === e.id);
      if (status === "none") return deliveries.length === 0;
      if (status && !deliveries.some((d) => d.status === status)) return false;
      return true;
    })
    .sort(byNewest);

  return {
    items: eventRows(matches.slice((page - 1) * pageSize, page * pageSize)),
    total: matches.length,
    page,
    pageSize,
  };
}

function deliveryById(id: number) {
  return getState().data.deliveries.find((d) => d.id === id) ?? notFound("Delivery not found");
}

function deliveryAttempts(id: number) {
  const d = deliveryById(id);
  const event = getState().data.events.find((e) => e.id === d.eventId)!;
  let at = event.occurredAt.getTime() + 1500;
  const attempts = Array.from({ length: d.attempts }, (_, i) => {
    const attempt = i + 1;
    const success = d.status === "success" && attempt === d.attempts;
    if (i > 0) at += 30_000 * 2 ** (i - 1);
    return {
      id: d.id * 100 + attempt,
      attempt,
      success,
      error: success ? null : (d.lastError ?? "HTTP 503: Service Unavailable"),
      durationMs: 140 + attempt * 37,
      createdAt: new Date(at),
    };
  });
  return { attempts };
}

function retryDelivery(id: number) {
  const d = deliveryById(id);
  if (d.status === "success") badRequest("Delivery already succeeded");
  // The demo cannot send anything, so the retry simply succeeds.
  d.status = "success";
  d.attempts += 1;
  d.lastError = null;
  d.nextAttemptAt = null;
  d.deliveredAt = new Date();
  log("info", "delivery", "delivered", { deliveryId: id, attempt: d.attempts });
  return { ok: true };
}

/* -------------------------------- Channels -------------------------------- */

function channelView(c: DemoChannel) {
  const info = getChannelType(c.type);
  const config: Body = {};
  const secrets: Record<string, string | null> = {};
  for (const field of info?.fields ?? []) {
    const value = c.config[field.key];
    if (field.secret) secrets[field.key] = value === undefined || value === "" ? null : hint(String(value));
    else if (value !== undefined) config[field.key] = value;
  }
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    enabled: c.enabled,
    allRepos: c.allRepos,
    notifyStar: c.notifyStar,
    notifyUnstar: c.notifyUnstar,
    milestoneEvery: c.milestoneEvery,
    frequencyTiers: c.frequencyTiers,
    templates: null,
    config,
    secrets,
    repoIds: getState()
      .data.repoChannels.filter((rc) => rc.channelId === c.id)
      .map((rc) => rc.repositoryId),
  };
}

function mergeConfig(type: string, stored: DemoChannel["config"] | null, incoming: Body) {
  const info = getChannelType(type) ?? badRequest(`Unknown channel type: ${type}`);
  const result: DemoChannel["config"] = {};
  for (const field of info.fields) {
    const raw = incoming[field.key];
    let value: string | number | boolean | undefined =
      raw === undefined || raw === null || raw === "" ? undefined : (raw as string | number | boolean);
    if (value !== undefined && field.type === "number") value = Number(value);
    if (value === undefined && field.secret && stored) value = stored[field.key];
    if (value === undefined && field.default !== undefined) value = field.default;
    if (field.required && (value === undefined || value === "")) badRequest(`${field.label} is required`);
    if (value !== undefined) result[field.key] = value;
  }
  return result;
}

function cleanMilestone(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === 0) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2) badRequest("Milestone must be a whole number ≥ 2");
  return n;
}

function cleanTiers(value: unknown): FrequencyTier[] | null {
  if (value === null || value === undefined) return null;
  try {
    return validateFrequencyTiers(value);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err));
  }
}

function setChannelRepos(channelId: number, repoIds: unknown) {
  if (!Array.isArray(repoIds)) return;
  const { data } = getState();
  const valid = new Set(data.repos.map((r) => r.id));
  data.repoChannels = [
    ...data.repoChannels.filter((rc) => rc.channelId !== channelId),
    ...[...new Set(repoIds.map(Number))]
      .filter((id) => valid.has(id))
      .map((repositoryId) => ({ repositoryId, channelId })),
  ];
}

function createChannel(body: Body) {
  const { data } = getState();
  const name = String(body.name ?? "").trim() || badRequest("Name is required");
  const type = String(body.type ?? "");
  if (!CHANNEL_TYPES.some((t) => t.type === type)) badRequest("Unknown channel type");
  const milestoneEvery = cleanMilestone(body.milestoneEvery);
  const frequencyTiers = cleanTiers(body.frequencyTiers);
  if (milestoneEvery && frequencyTiers) badRequest("Use milestones or dynamic frequency, not both");

  const channel: DemoChannel = {
    id: Math.max(0, ...data.channels.map((c) => c.id)) + 1,
    name,
    type,
    config: mergeConfig(type, null, (body.config as Body) ?? {}),
    enabled: body.enabled !== false,
    allRepos: body.allRepos !== false,
    notifyStar: body.notifyStar !== false,
    notifyUnstar: body.notifyUnstar !== false,
    milestoneEvery,
    frequencyTiers,
  };
  data.channels.push(channel);
  setChannelRepos(channel.id, body.repoIds);
  log("info", "channels", "channel created", { id: channel.id, type });
  return channelView(channel);
}

function updateChannel(id: number, body: Body) {
  const channel = channelById(id);
  if (body.name !== undefined) channel.name = String(body.name).trim() || badRequest("Name is required");
  if (body.config !== undefined) channel.config = mergeConfig(channel.type, channel.config, body.config as Body);
  if (body.enabled !== undefined) channel.enabled = Boolean(body.enabled);
  if (body.allRepos !== undefined) channel.allRepos = Boolean(body.allRepos);
  if (body.notifyStar !== undefined) channel.notifyStar = Boolean(body.notifyStar);
  if (body.notifyUnstar !== undefined) channel.notifyUnstar = Boolean(body.notifyUnstar);
  const milestoneEvery =
    body.milestoneEvery !== undefined ? cleanMilestone(body.milestoneEvery) : channel.milestoneEvery;
  const frequencyTiers =
    body.frequencyTiers !== undefined ? cleanTiers(body.frequencyTiers) : channel.frequencyTiers;
  if (milestoneEvery && frequencyTiers) badRequest("Use milestones or dynamic frequency, not both");
  channel.milestoneEvery = milestoneEvery;
  channel.frequencyTiers = frequencyTiers;
  setChannelRepos(id, body.repoIds);
  return channelView(channel);
}

function deleteChannel(id: number) {
  channelById(id);
  const { data } = getState();
  data.channels = data.channels.filter((c) => c.id !== id);
  data.repoChannels = data.repoChannels.filter((rc) => rc.channelId !== id);
  data.deliveries = data.deliveries.filter((d) => d.channelId !== id);
  return { ok: true };
}

/* -------------------------------- Settings -------------------------------- */

function settingsView() {
  const { settings } = getState();
  return {
    github: {
      connected: true,
      login: DEMO_GITHUB_LOGIN,
      tokenHint: "••••x9Qa",
      scopes: ["admin:repo_hook", "public_repo"],
      missingScopes: [],
      warnings: [],
      checkedAt: new Date(Date.now() - 2 * HOUR),
      rateLimit: rateLimit(),
      lastSyncAt: new Date(Date.now() - 4 * MINUTE),
      lastSyncError: null,
      lastPollAt: new Date(Date.now() - 6 * MINUTE),
    },
    pollingIntervalMinutes: settings.pollingIntervalMinutes,
    autoMonitorNew: settings.autoMonitorNew,
    templates: { ...DEFAULT_TEMPLATES, ...settings.templates },
    defaultTemplates: DEFAULT_TEMPLATES,
    webhook: {
      url: `${DEMO_WEBHOOK_BASE_URL}/api/webhooks/github`,
      baseUrlOverride: DEMO_WEBHOOK_BASE_URL,
      tunnel: false,
      defaultBaseUrl: "https://starwatch.example.com",
      canEdit: true,
    },
    server: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, allowRegistration: false },
  };
}

function updateSettings(body: Body) {
  const { settings } = getState();
  if (body.pollingIntervalMinutes !== undefined) {
    const minutes = Number(body.pollingIntervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      badRequest("Polling interval must be between 1 and 1440 minutes");
    }
    settings.pollingIntervalMinutes = minutes;
  }
  if (body.autoMonitorNew !== undefined) settings.autoMonitorNew = Boolean(body.autoMonitorNew);
  if (body.templates !== undefined) {
    const input = (body.templates ?? {}) as Partial<MessageTemplates>;
    const templates: Partial<MessageTemplates> = {};
    for (const key of Object.keys(DEFAULT_TEMPLATES) as (keyof MessageTemplates)[]) {
      const value = input[key];
      if (typeof value === "string" && value.trim() && value !== DEFAULT_TEMPLATES[key]) templates[key] = value;
    }
    settings.templates = Object.keys(templates).length ? templates : null;
  }
  return settingsView();
}

/* ---------------------------------- Users --------------------------------- */

function userView(u: DemoUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    image: null,
    createdAt: u.createdAt,
    isSelf: u.id === DEMO_USER_ID,
  };
}

function userById(id: string) {
  return getState().users.find((u) => u.id === id) ?? notFound("User not found");
}

const otherAdmins = (id: string) => getState().users.filter((u) => u.role === "admin" && u.id !== id).length;

function createUser(body: Body) {
  const { users } = getState();
  const name = String(body.name ?? "").trim() || badRequest("Name is required");
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) badRequest("A valid email is required");
  if (String(body.password ?? "").length < 8) badRequest("Password must be at least 8 characters");
  if (users.some((u) => u.email === email)) throw new ApiError("An account with this email already exists", 409);
  const user: DemoUser = {
    id: `demo-user-${users.length + 1}-${Date.now()}`,
    name,
    email,
    role: body.role === "admin" ? "admin" : "user",
    createdAt: new Date(),
  };
  users.push(user);
  return userView(user);
}

function updateUser(id: string, body: Body) {
  const user = userById(id);
  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "user") badRequest("Invalid role");
    if (body.role === "user" && user.role === "admin" && otherAdmins(id) === 0) {
      badRequest("At least one admin is required");
    }
    user.role = body.role;
  }
  if (body.name !== undefined) user.name = String(body.name).trim() || badRequest("Name is required");
  return userView(user);
}

function deleteUser(id: string) {
  const user = userById(id);
  if (id === DEMO_USER_ID) badRequest("You cannot delete your own account");
  if (user.role === "admin" && otherAdmins(id) === 0) badRequest("At least one admin is required");
  const s = getState();
  s.users = s.users.filter((u) => u.id !== id);
  return { ok: true };
}

/* ---------------------------------- Logs ---------------------------------- */

function listLogs(url: URL) {
  const { logs } = getState();
  const p = url.searchParams;
  const level = p.get("level");
  const after = Number(p.get("after"));
  return {
    entries: logs.query({
      after: after > 0 ? after : undefined,
      minLevel: level && level in LOG_LEVELS ? (level as LogLevel) : undefined,
      scope: p.get("scope") || undefined,
      q: p.get("q") || undefined,
      limit: Number(p.get("limit")) || undefined,
    }),
    lastId: logs.lastId,
    scopes: logs.scopes(),
    logLevel: "info",
  };
}

/* --------------------------------- Router --------------------------------- */

type Handler = (params: string[], url: URL, body: Body) => unknown;

const ROUTES: [string, RegExp, Handler][] = [
  [
    "GET",
    /^\/setup\/status$/,
    () => ({ needsSetup: false, registrationOpen: false, githubOAuth: false, version: VERSION }),
  ],
  [
    "GET",
    /^\/me$/,
    () => ({ user: { id: DEMO_USER_ID, name: DEMO_USER.name, email: DEMO_USER.email, image: null, role: "admin" } }),
  ],
  ["GET", /^\/dashboard$/, () => dashboard()],
  ["GET", /^\/repos$/, () => listRepos()],
  ["POST", /^\/repos\/sync$/, () => unavailable("Syncing with GitHub")],
  ["POST", /^\/repos\/bulk$/, (_, __, body) => bulkMonitoring(body)],
  ["GET", /^\/repos\/(\d+)\/stargazers$/, ([id], url) => listStargazers(Number(id), url)],
  ["PUT", /^\/repos\/(\d+)\/channels$/, ([id], _, body) => setRepoChannels(Number(id), body)],
  ["POST", /^\/repos\/(\d+)\/ping$/, () => unavailable("Pinging GitHub webhooks")],
  ["PATCH", /^\/repos\/(\d+)$/, ([id], _, body) => updateRepo(Number(id), body)],
  ["GET", /^\/events$/, (_, url) => listEvents(url)],
  ["GET", /^\/events\/deliveries\/(\d+)\/attempts$/, ([id]) => deliveryAttempts(Number(id))],
  ["POST", /^\/events\/deliveries\/(\d+)\/retry$/, ([id]) => retryDelivery(Number(id))],
  [
    "GET",
    /^\/channels$/,
    () => ({ channels: [...getState().data.channels].sort((a, b) => a.name.localeCompare(b.name)).map(channelView) }),
  ],
  ["POST", /^\/channels$/, (_, __, body) => createChannel(body)],
  ["POST", /^\/channels\/(\d+)\/test$/, () => unavailable("Sending test notifications")],
  ["PATCH", /^\/channels\/(\d+)$/, ([id], _, body) => updateChannel(Number(id), body)],
  ["DELETE", /^\/channels\/(\d+)$/, ([id]) => deleteChannel(Number(id))],
  ["GET", /^\/settings$/, () => settingsView()],
  ["PATCH", /^\/settings$/, (_, __, body) => updateSettings(body)],
  ["PUT", /^\/settings\/github-token$/, () => unavailable("Changing the GitHub token")],
  ["POST", /^\/settings\/github-token\/check$/, () => unavailable("Checking the GitHub token")],
  ["DELETE", /^\/settings\/github-token$/, () => unavailable("Removing the GitHub token")],
  ["PATCH", /^\/settings\/app$/, () => unavailable("Changing the webhook URL")],
  [
    "GET",
    /^\/settings\/cloudflared$/,
    () => ({
      enabled: false,
      mode: "token",
      tokenHint: null,
      hostname: null,
      webhookUrl: null,
      localService: "http://localhost:4322",
      status: {
        state: "stopped",
        connections: 0,
        error: null,
        since: null,
        binary: {
          supported: true,
          installed: true,
          managed: true,
          version: "2026.10.7",
          lastCheckAt: null,
          updateError: null,
        },
      },
    }),
  ],
  ["PUT", /^\/settings\/cloudflared$/, () => unavailable("Changing the Cloudflare tunnel")],
  ["POST", /^\/settings\/cloudflared\/update$/, () => unavailable("Updating cloudflared")],
  ["GET", /^\/users$/, () => ({ users: getState().users.map(userView), allowRegistration: false })],
  ["POST", /^\/users$/, (_, __, body) => createUser(body)],
  ["POST", /^\/users\/([^/]+)\/password$/, ([id], _, body) => {
    userById(id);
    if (String(body.password ?? "").length < 8) badRequest("Password must be 8 to 128 characters");
    return { ok: true };
  }],
  ["PATCH", /^\/users\/([^/]+)$/, ([id], _, body) => updateUser(id, body)],
  ["DELETE", /^\/users\/([^/]+)$/, ([id]) => deleteUser(id)],
  ["GET", /^\/logs$/, (_, url) => listLogs(url)],
];

/** Answer an API request (path without the /api prefix) from the in-memory demo state. */
export async function demoRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (latencyMs > 0) await sleep(latencyMs);
  const url = new URL(path, "http://demo.local");
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method.toUpperCase()) continue;
    const match = url.pathname.match(pattern);
    if (match) return toJson<T>(handler(match.slice(1), url, (body ?? {}) as Body));
  }
  return notFound();
}
