import { and, eq, inArray, lte } from "drizzle-orm";
import type { TemplateVars } from "../../shared/templates";
import type { TimeFormat } from "../../shared/time";
import { getDb } from "../db/client";
import {
  channels,
  deliveryAttempts,
  followerDeliveries,
  followerEvents,
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
import { getUserSettings, getUserTemplates, getUserTimeFormat } from "../services/settings";
import { buildFollowMessage } from "./follow-message";
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

type DeliveryUpdate = Pick<
  typeof notificationDeliveries.$inferInsert,
  "status" | "attempts" | "lastError" | "nextAttemptAt" | "deliveredAt"
>;

/** Send one message and time it. Disabled channels fail without sending. */
async function trySend(channel: Channel, build: () => NotificationMessage) {
  const started = Date.now();
  let error: string | null = null;
  if (!channel.enabled) {
    error = "Channel disabled";
  } else {
    try {
      await sendToChannel(channel, build());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { error, durationMs: Date.now() - started };
}

/** The delivery row after attempt number `attempt`: delivered, retried later, or given up. */
function deliveryUpdate(attempt: number, error: string | null, channel: Channel): DeliveryUpdate {
  if (error === null) {
    return { status: "success", attempts: attempt, lastError: null, deliveredAt: new Date(), nextAttemptAt: null };
  }
  const giveUp = attempt >= MAX_ATTEMPTS || !channel.enabled;
  const nextAttemptAt = giveUp ? null : new Date(Date.now() + backoffMs(attempt));
  return { status: giveUp ? "failed" : "retrying", attempts: attempt, lastError: error, nextAttemptAt };
}

function logDelivery(deliveryId: number, channel: Channel, update: DeliveryUpdate, durationMs: number) {
  const meta = { deliveryId, channel: channel.name, type: channel.type, attempt: update.attempts };
  if (update.status === "success") {
    log.info("delivered", { ...meta, durationMs });
    return;
  }
  log.warn("delivery failed", {
    ...meta,
    error: update.lastError,
    nextAttemptAt: update.nextAttemptAt?.toISOString() ?? null,
  });
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
  const { error, durationMs } = await trySend(row.channel, () => buildMessage(row.channel, row.event, row.repo));
  db.insert(deliveryAttempts).values({ deliveryId, attempt, success: error === null, error, durationMs }).run();

  const update = deliveryUpdate(attempt, error, row.channel);
  db.update(notificationDeliveries).set(update).where(eq(notificationDeliveries.id, deliveryId)).run();
  logDelivery(deliveryId, row.channel, update, durationMs);
}

async function attemptFollowerDelivery(deliveryId: number) {
  const db = getDb();
  const row = db
    .select({ delivery: followerDeliveries, event: followerEvents, channel: channels })
    .from(followerDeliveries)
    .innerJoin(followerEvents, eq(followerEvents.id, followerDeliveries.eventId))
    .innerJoin(channels, eq(channels.id, followerDeliveries.channelId))
    .where(eq(followerDeliveries.id, deliveryId))
    .get();
  if (!row) return;

  const attempt = row.delivery.attempts + 1;
  const { error, durationMs } = await trySend(row.channel, () => {
    const account = getUserSettings(row.event.userId).githubLogin ?? "";
    return buildFollowMessage(row.event, account, getUserTimeFormat(row.event.userId));
  });

  const update = deliveryUpdate(attempt, error, row.channel);
  db.update(followerDeliveries).set(update).where(eq(followerDeliveries.id, deliveryId)).run();
  logDelivery(deliveryId, row.channel, update, durationMs);
}

const BATCH = 50;

function dueIds(table: typeof notificationDeliveries | typeof followerDeliveries) {
  return getDb()
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.status, ["pending", "retrying"]), lte(table.nextAttemptAt, new Date())))
    .orderBy(table.nextAttemptAt)
    .limit(BATCH)
    .all()
    .map((r) => r.id);
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
      const stars = dueIds(notificationDeliveries);
      for (const id of stars) await attemptDelivery(id);
      const follows = dueIds(followerDeliveries);
      for (const id of follows) await attemptFollowerDelivery(id);
      if (stars.length === BATCH || follows.length === BATCH) rerun = true;
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

/** Re-queue a failed follower delivery right away. */
export function retryFollowerDelivery(deliveryId: number) {
  getDb()
    .update(followerDeliveries)
    .set({ status: "retrying", nextAttemptAt: new Date() })
    .where(eq(followerDeliveries.id, deliveryId))
    .run();
  kickWorker();
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
