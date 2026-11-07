import { and, eq } from "drizzle-orm";
import { affected, getDb } from "../db/client";
import { repositories, stargazers, starEvents, type Repository, type StarEvent } from "../db/schema";
import { logger } from "../logger";
import { enqueueDeliveries } from "../notifications/dispatcher";

const log = logger.child("stars");

export interface StarInput {
  action: "created" | "deleted";
  actor: { id: number; login: string; avatarUrl: string | null; htmlUrl: string | null };
  starredAt: Date | null;
  /** Star count after the event when known (webhooks include it). */
  starCount: number | null;
  source: "webhook" | "polling";
  deliveryId?: string | null;
  occurredAt?: Date;
}

/**
 * Apply a star or unstar to the stored stargazer set and record an event.
 * The stargazer table doubles as the dedupe key: a star seen by both webhook and polling
 * only produces one event. Returns null for duplicates.
 */
export function recordStarEvent(repo: Repository, input: StarInput, options: { notify?: boolean } = {}): StarEvent | null {
  const db = getDb();
  const event = db.transaction(
    (tx) => {
      const current = tx.select().from(repositories).where(eq(repositories.id, repo.id)).get();
      if (!current) return null;

      let changed: number;
      if (input.action === "created") {
        changed = affected(
          tx
          .insert(stargazers)
          .values({
            repositoryId: repo.id,
            githubUserId: input.actor.id,
            login: input.actor.login,
            avatarUrl: input.actor.avatarUrl,
            starredAt: input.starredAt ?? new Date(),
          })
          .onConflictDoNothing()
          .run(),
        );
      } else {
        changed = affected(
          tx
          .delete(stargazers)
          .where(and(eq(stargazers.repositoryId, repo.id), eq(stargazers.githubUserId, input.actor.id)))
          .run(),
        );
      }

      // Before the initial import we cannot tell duplicates apart, so only dedupe once backfilled.
      const duplicate = changed === 0 && (input.action === "created" || current.backfilledAt !== null);
      if (duplicate) return null;

      const delta = input.action === "created" ? 1 : -1;
      const starCount = Math.max(0, input.starCount ?? current.starCount + delta);
      tx.update(repositories).set({ starCount }).where(eq(repositories.id, repo.id)).run();

      return tx
        .insert(starEvents)
        .values({
          userId: repo.userId,
          repositoryId: repo.id,
          action: input.action,
          actorId: input.actor.id,
          actorLogin: input.actor.login,
          actorAvatarUrl: input.actor.avatarUrl,
          actorUrl: input.actor.htmlUrl ?? `https://github.com/${input.actor.login}`,
          starCount,
          source: input.source,
          deliveryId: input.deliveryId ?? null,
          occurredAt: input.occurredAt ?? input.starredAt ?? new Date(),
        })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );

  if (!event) {
    log.debug("duplicate star event skipped", { repo: repo.fullName, actor: input.actor.login, action: input.action });
    return null;
  }

  log.info("star event recorded", {
    repo: repo.fullName,
    actor: event.actorLogin,
    action: event.action,
    stars: event.starCount,
    source: event.source,
  });
  if (options.notify !== false) enqueueDeliveries(event);
  return event;
}
