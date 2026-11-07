import type { Subprocess } from "bun";
import { getConfig } from "../config";
import { logger } from "../logger";
import { startWebhookListener, stopWebhookListener } from "../webhook-listener";
import { cloudflaredSupported, ensureLatestBinary, getBinary, type UpdateResult } from "./cloudflared-binary";
import { syncRepositories } from "./repos";
import { getTunnelSettings, getWebhookUrl, listUsersWithTokens, updateTunnelSettings } from "./settings";

const log = logger.child("tunnel");
const RESTART_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Restarts within this window reuse the installed binary instead of asking GitHub again. */
const MIN_CHECK_GAP_MS = 60 * 60 * 1000;
const QUICK_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

export type TunnelState = "stopped" | "starting" | "connected" | "error";

export interface TunnelStatus {
  state: TunnelState;
  connections: number;
  error: string | null;
  since: Date | null;
}

export interface CloudflaredLine {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  quickUrl: string | null;
  event: "connected" | "disconnected" | null;
}

/** Parse one line of cloudflared output ("2026-11-08T10:00:00Z INF Registered tunnel connection ..."). */
export function parseCloudflaredLine(line: string): CloudflaredLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^\S+\s+(DBG|INF|WRN|ERR|FTL)\s+(.*)$/);
  const tag = match?.[1];
  const message = (match ? match[2] : trimmed).replace(/^\|\s*|\s*\|$/g, "").trim();
  const level = tag === "ERR" || tag === "FTL" ? "error" : tag === "WRN" ? "warn" : tag === "DBG" ? "debug" : "info";
  // Check "Unregistered" first, it contains "registered".
  const event = /Unregistered tunnel connection/i.test(message)
    ? "disconnected"
    : /Registered tunnel connection/i.test(message)
      ? "connected"
      : null;
  return { level, message, quickUrl: level === "info" ? (message.match(QUICK_URL)?.[0] ?? null) : null, event };
}

let child: Subprocess<"ignore", "pipe", "pipe"> | null = null;
let generation = 0;
let attempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;
let lastUpdateCheck: Date | null = null;
let updateError: string | null = null;
let status: TunnelStatus = { state: "stopped", connections: 0, error: null, since: null };

export function getTunnelStatus() {
  const binary = getBinary();
  return {
    ...status,
    binary: {
      supported: cloudflaredSupported(),
      installed: Boolean(binary),
      managed: binary?.managed ?? true,
      version: binary?.version ?? null,
      lastCheckAt: lastUpdateCheck,
      updateError,
    },
  };
}

function setStatus(patch: Partial<TunnelStatus>) {
  const changed = patch.state !== undefined && patch.state !== status.state;
  status = { ...status, ...patch, since: changed ? new Date() : status.since };
}

function resyncIfChanged(previousUrl: string) {
  const url = getWebhookUrl();
  if (url === previousUrl) return;
  log.info("webhook url changed, resyncing hooks", { url });
  for (const s of listUsersWithTokens()) void syncRepositories(s.userId).catch(() => undefined);
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function scheduleRestart(gen: number) {
  const delay = RESTART_DELAYS_MS[Math.min(attempt, RESTART_DELAYS_MS.length - 1)];
  attempt++;
  log.warn("cloudflared restarting", { error: status.error, retryInSeconds: delay / 1000 });
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (gen === generation && getTunnelSettings().enabled) void launch();
  }, delay);
}

/** Stop with an error. Retries only for problems that can go away on their own, like a failed download. */
function fail(gen: number, error: string, retry = false) {
  if (gen !== generation) return;
  log.error("cloudflared not started", { error });
  setStatus({ state: "error", connections: 0, error });
  if (retry) scheduleRestart(gen);
}

function handleLine(line: string, gen: number) {
  if (gen !== generation) return;
  const parsed = parseCloudflaredLine(line);
  if (!parsed) return;
  log[parsed.level](parsed.message.slice(0, 500), { source: "cloudflared" });

  const tunnel = parsed.quickUrl ? getTunnelSettings() : null;
  if (parsed.quickUrl && tunnel?.mode === "quick" && parsed.quickUrl !== tunnel.quickUrl) {
    const previous = getWebhookUrl();
    updateTunnelSettings({ quickUrl: parsed.quickUrl });
    log.info("quick tunnel url assigned", { url: parsed.quickUrl });
    resyncIfChanged(previous);
  }
  if (parsed.event === "connected") {
    attempt = 0;
    setStatus({ state: "connected", connections: status.connections + 1, error: null });
  } else if (parsed.event === "disconnected") {
    const connections = Math.max(0, status.connections - 1);
    setStatus({ connections, state: connections === 0 ? "starting" : status.state });
  } else if (parsed.level === "error") {
    setStatus({ error: parsed.message.slice(0, 300) });
  }
}

async function pump(stream: ReadableStream<Uint8Array>, gen: number) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, index), gen);
      buffer = buffer.slice(index + 1);
    }
  }
  if (buffer) handleLine(buffer, gen);
}

function onExit(gen: number, code: number | null) {
  if (gen !== generation) return;
  child = null;
  setStatus({ state: "error", connections: 0, error: status.error ?? `cloudflared exited with code ${code}` });
  scheduleRestart(gen);
}

async function checkForUpdate(): Promise<UpdateResult | null> {
  lastUpdateCheck = new Date();
  try {
    const result = await ensureLatestBinary();
    updateError = null;
    return result;
  } catch (err) {
    updateError = errorText(err);
    log.warn("cloudflared update check failed", { error: updateError });
    throw err;
  }
}

/** Path of a usable binary. Downloads it when missing and updates it when the last check is old enough. */
async function prepareBinary(): Promise<string> {
  const existing = getBinary();
  const due = !lastUpdateCheck || Date.now() - lastUpdateCheck.getTime() > MIN_CHECK_GAP_MS;
  if (existing && (!existing.managed || !due)) return existing.path;
  try {
    await checkForUpdate();
  } catch (err) {
    if (!existing) throw err;
  }
  const binary = getBinary();
  if (!binary) throw new Error("cloudflared could not be installed");
  return binary.path;
}

async function launch() {
  const gen = ++generation;
  setStatus({ state: "starting", connections: 0, error: null });

  let binary: string;
  try {
    binary = await prepareBinary();
  } catch (err) {
    return fail(gen, errorText(err), true);
  }
  if (gen !== generation) return;

  const settings = getTunnelSettings();
  if (settings.mode === "token" && !settings.token) return fail(gen, "No tunnel token saved");

  let port: number;
  try {
    port = startWebhookListener();
  } catch (err) {
    return fail(gen, `Could not listen on port ${getConfig().tunnelPort}: ${errorText(err)}`);
  }

  const env: Record<string, string | undefined> = { ...process.env, TUNNEL_TOKEN: undefined };
  const args = [binary, "tunnel", "--no-autoupdate"];
  if (settings.mode === "token") {
    // Passed through the environment so the token does not show up in the process list.
    env.TUNNEL_TOKEN = settings.token!;
    args.push("run");
  } else {
    args.push("--url", `http://127.0.0.1:${port}`);
  }

  log.info("starting cloudflared", { mode: settings.mode, version: getBinary()?.version });
  try {
    const proc = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    child = proc;
    void pump(proc.stdout, gen);
    void pump(proc.stderr, gen);
    void proc.exited.then((code) => onExit(gen, code));
  } catch (err) {
    fail(gen, errorText(err), true);
  }
}

function stopProcess() {
  generation++;
  attempt = 0;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  child?.kill();
  child = null;
  setStatus({ state: "stopped", connections: 0, error: null });
}

function startUpdateTimer() {
  if (updateTimer) return;
  updateTimer = setInterval(() => void updateCloudflared().catch(() => undefined), UPDATE_INTERVAL_MS);
}

function stopUpdateTimer() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = null;
}

/** Check for a newer cloudflared now and restart a running tunnel on it. */
export async function updateCloudflared(): Promise<UpdateResult | null> {
  const result = await checkForUpdate();
  if (result?.updated && getTunnelSettings().enabled) {
    log.info("restarting cloudflared on the new version", { version: result.version });
    stopProcess();
    void launch();
  }
  return result;
}

/** Restart cloudflared to match the stored settings and resync hooks if the webhook URL moved. */
export function applyTunnelSettings(previousWebhookUrl: string) {
  stopProcess();
  if (getTunnelSettings().enabled) {
    startUpdateTimer();
    void launch();
  } else {
    stopUpdateTimer();
    stopWebhookListener();
    log.info("cloudflared stopped");
  }
  resyncIfChanged(previousWebhookUrl);
}

export function startTunnel() {
  if (!getTunnelSettings().enabled) return;
  startUpdateTimer();
  void launch();
}

export function stopTunnel() {
  stopUpdateTimer();
  stopProcess();
  stopWebhookListener();
}
