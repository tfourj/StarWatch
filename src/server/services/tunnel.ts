import type { Subprocess } from "bun";
import { getConfig } from "../config";
import { logger } from "../logger";
import { startWebhookListener, stopWebhookListener } from "../webhook-listener";
import { syncRepositories } from "./repos";
import { getTunnelSettings, getWebhookUrl, listUsersWithTokens, updateTunnelSettings } from "./settings";

const log = logger.child("tunnel");
const RESTART_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];
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

export function cloudflaredBinary(): string | null {
  return process.env.CLOUDFLARED_PATH?.trim() || Bun.which("cloudflared");
}

let child: Subprocess<"ignore", "pipe", "pipe"> | null = null;
let generation = 0;
let attempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let status: TunnelStatus = { state: "stopped", connections: 0, error: null, since: null };

export function getTunnelStatus(): TunnelStatus & { binaryFound: boolean } {
  return { ...status, binaryFound: Boolean(cloudflaredBinary()) };
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

function fail(error: string) {
  log.error("cloudflared not started", { error });
  setStatus({ state: "error", connections: 0, error });
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
  const delay = RESTART_DELAYS_MS[Math.min(attempt, RESTART_DELAYS_MS.length - 1)];
  attempt++;
  const error = status.error ?? `cloudflared exited with code ${code}`;
  log.warn("cloudflared exited, restarting", { code, error, retryInSeconds: delay / 1000 });
  setStatus({ state: "error", connections: 0, error });
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (gen === generation && getTunnelSettings().enabled) spawnTunnel();
  }, delay);
}

function spawnTunnel() {
  const settings = getTunnelSettings();
  const binary = cloudflaredBinary();
  if (!binary) return fail("cloudflared not found. Install it or set CLOUDFLARED_PATH.");
  if (settings.mode === "token" && !settings.token) return fail("No tunnel token saved");

  let port: number;
  try {
    port = startWebhookListener();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fail(`Could not listen on port ${getConfig().tunnelPort}: ${reason}`);
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

  const gen = ++generation;
  setStatus({ state: "starting", connections: 0, error: null });
  log.info("starting cloudflared", { mode: settings.mode });
  try {
    const proc = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    child = proc;
    void pump(proc.stdout, gen);
    void pump(proc.stderr, gen);
    void proc.exited.then((code) => onExit(gen, code));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
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

/** Restart cloudflared to match the stored settings and resync hooks if the webhook URL moved. */
export function applyTunnelSettings(previousWebhookUrl: string) {
  stopProcess();
  if (getTunnelSettings().enabled) {
    spawnTunnel();
  } else {
    stopWebhookListener();
    log.info("cloudflared stopped");
  }
  resyncIfChanged(previousWebhookUrl);
}

export function startTunnel() {
  if (getTunnelSettings().enabled) spawnTunnel();
}

export function stopTunnel() {
  stopProcess();
  stopWebhookListener();
}
