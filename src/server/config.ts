import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export interface AppConfig {
  port: number;
  /** Local port for the webhook-only listener the Cloudflare tunnel points at. */
  tunnelPort: number;
  baseUrl: string;
  dataDir: string;
  dbPath: string;
  betterAuthSecret: string;
  encryptionSecret: string;
  allowRegistration: boolean;
  timezone: string;
  github: { clientId: string; clientSecret: string } | null;
  isProduction: boolean;
}

interface StoredSecrets {
  betterAuthSecret?: string;
  encryptionSecret?: string;
}

function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readSecretsFile(file: string): StoredSecrets {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as StoredSecrets;
  } catch (err) {
    logger.error("could not parse secrets file", { file, err });
    throw err;
  }
}

function resolveSecrets(dataDir: string) {
  const file = path.join(dataDir, "secrets.json");
  const stored = readSecretsFile(file);
  let changed = false;

  const resolve = (envName: string, key: keyof StoredSecrets) => {
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) {
      if (fromEnv.length < 32) logger.warn(`${envName} is shorter than 32 characters`);
      return fromEnv;
    }
    if (stored[key]) return stored[key]!;
    stored[key] = randomBytes(32).toString("base64url");
    changed = true;
    logger.warn(`${envName} not set, generated one and stored it in ${file}. Back up this file.`);
    return stored[key]!;
  };

  const betterAuthSecret = resolve("BETTER_AUTH_SECRET", "betterAuthSecret");
  const encryptionSecret = resolve("ENCRYPTION_SECRET", "encryptionSecret");

  if (changed) {
    writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // best effort on filesystems without chmod
    }
  }
  return { betterAuthSecret, encryptionSecret };
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 4321);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid PORT: ${process.env.PORT}`);

  const tunnelPort = Number(process.env.TUNNEL_PORT ?? 4322);
  if (!Number.isInteger(tunnelPort) || tunnelPort <= 0 || tunnelPort === port) {
    throw new Error(`invalid TUNNEL_PORT: ${process.env.TUNNEL_PORT}`);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const dataDir = path.resolve(process.env.DATA_DIR ?? (isProduction ? "/data" : "./data"));
  mkdirSync(dataDir, { recursive: true });

  let baseUrl = process.env.BASE_URL?.trim();
  if (!baseUrl) {
    baseUrl = `http://localhost:${port}`;
    logger.warn("BASE_URL not set, falling back to localhost. Webhooks and OAuth need a public URL.", { baseUrl });
  }

  const githubId = process.env.GITHUB_CLIENT_ID?.trim();
  const githubSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

  return {
    port,
    tunnelPort,
    baseUrl: normalizeBaseUrl(baseUrl),
    dataDir,
    dbPath: process.env.DATABASE_PATH ?? path.join(dataDir, "starwatch.db"),
    ...resolveSecrets(dataDir),
    allowRegistration: parseBool(process.env.ALLOW_REGISTRATION),
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    github: githubId && githubSecret ? { clientId: githubId, clientSecret: githubSecret } : null,
    isProduction,
  };
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper to inject a config without touching env or disk. */
export function setConfig(config: AppConfig) {
  cached = config;
}
