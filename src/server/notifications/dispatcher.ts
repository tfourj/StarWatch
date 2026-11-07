import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { channels, notificationDeliveries, repositoryChannels, type Channel, type StarEvent } from "../db/schema";
import { logger } from "../logger";
import { kickWorker } from "./worker";

const log = logger.child("dispatch");

/** Decide whether a channel wants this event. */
export function channelMatches(
  channel: Pick<Channel, "enabled" | "allRepos" | "notifyStar" | "notifyUnstar" | "milestoneEvery">,
  event: Pick<StarEvent, "action" | "starCount">,
  repoAssigned: boolean,
): boolean {
  if (!channel.enabled) return false;
  if (!channel.allRepos && !repoAssigned) return false;
  if (event.action === "created" && !channel.notifyStar) return false;
  if (event.action === "deleted" && !channel.notifyUnstar) return false;
  if (channel.milestoneEvery && channel.milestoneEvery > 0) {
    if (event.action !== "created") return false;
    if (event.starCount <= 0 || event.starCount % channel.milestoneEvery !== 0) return false;
  }
  return true;
}

export function enqueueDeliveries(event: StarEvent): number {
  const db = getDb();
  const userChannels = db.select().from(channels).where(eq(channels.userId, event.userId)).all();
  if (userChannels.length === 0) return 0;

  const assigned = new Set(
    db
      .select({ channelId: repositoryChannels.channelId })
      .from(repositoryChannels)
      .where(eq(repositoryChannels.repositoryId, event.repositoryId))
      .all()
      .map((r) => r.channelId),
  );

  const targets = userChannels.filter((c) => channelMatches(c, event, assigned.has(c.id)));
  if (targets.length === 0) return 0;

  const now = new Date();
  db.insert(notificationDeliveries)
    .values(targets.map((c) => ({ eventId: event.id, channelId: c.id, status: "pending" as const, nextAttemptAt: now })))
    .onConflictDoNothing()
    .run();

  log.debug("deliveries queued", { eventId: event.id, channels: targets.map((c) => c.id) });
  kickWorker();
  return targets.length;
}
