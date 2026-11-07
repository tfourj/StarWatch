import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { webhookDeliveries } from "../db/schema";
import { verifySignature } from "../github/signature";
import { clientIp } from "../lib/http";
import { logger } from "../logger";
import { getWebhookSecret } from "../services/settings";
import { handlePing, handleStarWebhook, isStarPayload, type PingPayload } from "../services/webhooks";

const log = logger.child("webhook");
const MAX_BODY = 1024 * 1024;

function markDelivery(deliveryId: string, event: string, status: "processed" | "ignored" | "failed", repo?: string) {
  getDb()
    .insert(webhookDeliveries)
    .values({ deliveryId, event, status, repoFullName: repo ?? null })
    .onConflictDoUpdate({ target: webhookDeliveries.deliveryId, set: { status } })
    .run();
}

export const webhooks = new Hono().post("/github", async (c) => {
  const event = c.req.header("x-github-event") ?? "";
  const deliveryId = c.req.header("x-github-delivery") ?? "";
  const signature = c.req.header("x-hub-signature-256");

  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "Payload too large" }, 413);

  if (!verifySignature(getWebhookSecret(), raw, signature)) {
    log.warn("invalid webhook signature", { event, deliveryId, ip: clientIp(c) });
    return c.json({ error: "Invalid signature" }, 401);
  }
  if (!deliveryId) return c.json({ error: "Missing X-GitHub-Delivery" }, 400);

  const previous = getDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, deliveryId)).get();
  if (previous && previous.status !== "failed") {
    log.debug("duplicate delivery ignored", { deliveryId });
    return c.json({ ok: true, duplicate: true });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  try {
    if (event === "ping") {
      const updated = handlePing(payload as PingPayload);
      markDelivery(deliveryId, event, "processed", (payload as PingPayload).repository?.full_name);
      log.info("webhook ping received", { deliveryId, repos: updated });
      return c.json({ ok: true, pong: true });
    }

    if (event === "star" && isStarPayload(payload)) {
      const recorded = handleStarWebhook(payload, deliveryId);
      markDelivery(deliveryId, event, recorded > 0 ? "processed" : "ignored", payload.repository.full_name);
      log.info("star webhook", {
        deliveryId,
        repo: payload.repository.full_name,
        action: payload.action,
        user: payload.sender.login,
        recorded,
      });
      return c.json({ ok: true, recorded });
    }

    markDelivery(deliveryId, event, "ignored");
    return c.json({ ok: true, ignored: true });
  } catch (err) {
    markDelivery(deliveryId, event, "failed");
    log.error("webhook processing failed", { deliveryId, event, err });
    return c.json({ error: "Processing failed" }, 500);
  }
});
