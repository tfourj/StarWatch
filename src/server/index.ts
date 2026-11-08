import { initAuth } from "./auth/auth";
import { getConfig } from "./config";
import { initDb, runMigrations } from "./db/client";
import { createApp } from "./app";
import { startScheduler, stopScheduler } from "./jobs/scheduler";
import { COMMIT, VERSION } from "./lib/build-info";
import { logger } from "./logger";
import { getWebhookSecret, getWebhookUrl } from "./services/settings";
import { startTunnel, stopTunnel } from "./services/tunnel";

const config = getConfig();
const db = initDb(config.dbPath);
runMigrations(db);
initAuth(db, config);
getWebhookSecret();

const app = createApp();
const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  idleTimeout: 60,
});

logger.info("StarWatch started", {
  version: VERSION,
  commit: COMMIT,
  port: server.port,
  baseUrl: config.baseUrl,
  webhookUrl: getWebhookUrl(),
  dataDir: config.dataDir,
  allowRegistration: config.allowRegistration,
  githubOAuth: Boolean(config.github),
  timezone: config.timezone,
});

if (process.env.DISABLE_JOBS !== "true") startScheduler();
startTunnel();

function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  stopScheduler();
  stopTunnel();
  server.stop();
  db.$client.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
