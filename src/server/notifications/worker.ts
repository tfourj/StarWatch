import { and, eq, inArray, lte } from "drizzle-orm";
import type { TemplateVars } from "../../shared/templates";
import type { TimeFormat } from "../../shared/time";
import { getDb } from "../db/client";
import {
  channels,
  deliveryAttempts,
  notificationDeliveries,
  repositories,
  starEvents,
  type Channel,
  type Repository,
  type StarEvent,
} from "../db/schema";
import { formatEventTime, mergeTemplates, renderMessage } from "../lib/template";
import { logger } from "../logger";
import { decryptChannelConfig } from "../services/channels";
import { getUserTemplates, getUserTimeFormat } from "../services/settings";
import { getProvider } from "./providers";
import type { NotificationMessage, StarMessage } from "./types";

const log = logger.child("delivery");

export const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** Delay before retry number `attempt` (1-based): 30s, 1m, 2m, 4m, 8m ... capped at 1h. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

export function buildVars(
  event: Pick<StarEvent, "action" | "actorLogin" | "actorUrl" | "actorAvatarUrl" | "starCount" | "occurredAt">,
  repo: Pick<Repository, "fullName" | "htmlUrl">,
  timeZone: string,
  timeFormat: TimeFormat = "auto",
): TemplateVars {
  return {
    user: event.actorLogin,
    user_url: event.actorUrl ?? `https://github.com/${event.actorLogin}`,
    avatar: event.actorAvatarUrl ?? "",
    repo: repo.fullName,
    repo_url: repo.htmlUrl,
    stars: String(event.starCount),
    action: event.action === "created" ? "starred" : "unstarred",
    time: formatEventTime(event.occurredAt, timeZone, timeFormat),
  };
}

export function buildMessage(
  channel: Channel,
  event: Pick<StarEvent, "action" | "actorLogin" | "actorUrl" | "actorAvatarUrl" | "starCount" | "occurredAt">,
  repo: Pick<Repository, "fullName" | "htmlUrl">,
  isTest = false,
): StarMessage {
  const templates = mergeTemplates(getUserTemplates(channel.userId), channel.templates);
  const { timeZone, timeFormat } = getUserTimeFormat(channel.userId);
  const vars = buildVars(event, repo, timeZone, timeFormat);
  const { title, body } = renderMessage(event.action, templates, vars);
  return {
    kind: "star",
    title: isTest ? `[Test] ${title}` : title,
    body,
    action: event.action,
    vars,
    occurredAt: event.occurredAt,
    isTest,
  };
}

export async function sendToChannel(channel: Channel, message: NotificationMessage) {
  const provider = getProvider(channel.type);
  if (!provider) throw new Error(`No provider for channel type ${channel.type}`);
  await provider.send(decryptChannelConfig(channel), message);
}

async function attemptDelivery(deliveryId: number) {
  const db = getDb();
  const row = db
    .select({ delivery: notificationDeliveries, event: starEvents, channel: channels, repo: repositories })
    .from(notificationDeliveries)
    .innerJoin(starEvents, eq(starEvents.id, notificationDeliveries.eventId))
    .innerJoin(channels, eq(channels.id, notificationDeliveries.channelId))
    .innerJoin(repositories, eq(repositories.id, starEvents.repositoryId))
    .where(eq(notificationDeliveries.id, deliveryId))
    .get();
  if (!row) return;

  const attempt = row.delivery.attempts + 1;
  const started = Date.now();
  let error: string | null = null;

  if (!row.channel.enabled) {
    error = "Channel disabled";
  } else {
    try {
      await sendToChannel(row.channel, buildMessage(row.channel, row.event, row.repo));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const durationMs = Date.now() - started;
  db.insert(deliveryAttempts).values({ deliveryId, attempt, success: error === null, error, durationMs }).run();

  if (error === null) {
    db.update(notificationDeliveries)
      .set({ status: "success", attempts: attempt, lastError: null, deliveredAt: new Date(), nextAttemptAt: null })
      .where(eq(notificationDeliveries.id, deliveryId))
      .run();
    log.info("delivered", { deliveryId, channel: row.channel.name, type: row.channel.type, attempt, durationMs });
    return;
  }

  const giveUp = attempt >= MAX_ATTEMPTS || !row.channel.enabled;
  const nextAttemptAt = giveUp ? null : new Date(Date.now() + backoffMs(attempt));
  db.update(notificationDeliveries)
    .set({ status: giveUp ? "failed" : "retrying", attempts: attempt, lastError: error, nextAttemptAt })
    .where(eq(notificationDeliveries.id, deliveryId))
    .run();
  log.warn("delivery failed", {
    deliveryId,
    channel: row.channel.name,
    type: row.channel.type,
    attempt,
    error,
    nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
  });
}

let running = false;
let rerun = false;

/** Send every due delivery. Only one pass runs at a time; calls during a pass schedule another pass. */
export async function processDueDeliveries(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      const due = getDb()
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            inArray(notificationDeliveries.status, ["pending", "retrying"]),
            lte(notificationDeliveries.nextAttemptAt, new Date()),
          ),
        )
        .orderBy(notificationDeliveries.nextAttemptAt)
        .limit(50)
        .all();
      for (const { id } of due) await attemptDelivery(id);
      if (due.length === 50) rerun = true;
    } while (rerun);
  } catch (err) {
    log.error("delivery worker error", { err });
  } finally {
    running = false;
  }
}

export function kickWorker() {
  queueMicrotask(() => void processDueDeliveries());
}

/** Re-queue a failed delivery right away. */
export function retryDelivery(deliveryId: number) {
  getDb()
    .update(notificationDeliveries)
    .set({ status: "retrying", nextAttemptAt: new Date() })
    .where(eq(notificationDeliveries.id, deliveryId))
    .run();
  kickWorker();
}
