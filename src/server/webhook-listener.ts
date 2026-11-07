import { createWebhookApp } from "./app";
import { getConfig } from "./config";
import { logger } from "./logger";

const log = logger.child("tunnel");
let server: ReturnType<typeof Bun.serve> | null = null;

/** Start the loopback-only webhook listener for the Cloudflare tunnel. Safe to call repeatedly. */
export function startWebhookListener(): number {
  if (server) return server.port!;
  const { tunnelPort } = getConfig();
  server = Bun.serve({ port: tunnelPort, hostname: "127.0.0.1", fetch: createWebhookApp().fetch, idleTimeout: 60 });
  log.info("webhook listener started", { address: `http://127.0.0.1:${server.port}` });
  return server.port!;
}

export function stopWebhookListener() {
  server?.stop();
  server = null;
}
