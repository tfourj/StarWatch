import { and, eq } from "drizzle-orm";
import { affected, getDb } from "../db/client";
import { followerEvents, followers, type FollowerEvent } from "../db/schema";
import type { GitHubUserSummary } from "../github/client";
import { isLocked, withLock } from "../lib/locks";
import { logger } from "../logger";
import { enqueueFollowerDeliveries } from "../notifications/dispatcher";
import { getGithubClient, getUserSettings, updateUserSettings } from "./settings";

const log = logger.child("followers");

/** Every change refetches the whole list, so very large accounts are left out (10,000 followers). */
export const MAX_FOLLOWER_PAGES = 100;
const INSERT_CHUNK = 500;

export interface FollowerSummary {
  followers: number;
  followed: number;
  unfollowed: number;
  /** True when this run was the silent initial import. */
  imported: boolean;
  /** True when tracking is off, no token is saved or the rate limit is low. */
  skipped: boolean;
}

export interface FollowerInput {
  action: "followed" | "unfollowed";
  actor: { id: number; login: string; avatarUrl: string | null; htmlUrl: string | null };
  /** Follower count right after the event. */
  followerCount: number;
  occurredAt?: Date;
}

export interface KnownFollower {
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
}

const lockKey = (userId: string) => `followers:${userId}`;

/** True while the first follower import for this user is running. */
export function isImportingFollowers(userId: string): boolean {
  return isLocked(lockKey(userId)) && getUserSettings(userId).followersImportedAt === null;
}

function loadKnownFollowers(userId: string): Map<number, KnownFollower> {
  return new Map(
    getDb()
      .select()
      .from(followers)
      .where(eq(followers.userId, userId))
      .all()
      .map((f) => [f.githubUserId, f]),
  );
}

/**
 * Apply a follow or unfollow to the stored followers and record an event.
 * The followers table is the dedupe key, so a change seen twice only produces one event. Returns null for duplicates.
 */
export function recordFollowerEvent(
  userId: string,
  input: FollowerInput,
  options: { notify?: boolean } = {},
): FollowerEvent | null {
  const occurredAt = input.occurredAt ?? new Date();
  const { actor } = input;
  const event = getDb().transaction(
    (tx) => {
      const where = and(eq(followers.userId, userId), eq(followers.githubUserId, actor.id));
      const changed =
        input.action === "followed"
          ? affected(
              tx
                .insert(followers)
                .values({
                  userId,
                  githubUserId: actor.id,
                  login: actor.login,
                  avatarUrl: actor.avatarUrl,
                  followedAt: occurredAt,
                })
                .onConflictDoNothing()
                .run(),
            )
          : affected(tx.delete(followers).where(where).run());
      if (changed === 0) return null;

      return tx
        .insert(followerEvents)
        .values({
          userId,
          action: input.action,
          actorId: actor.id,
          actorLogin: actor.login,
          actorAvatarUrl: actor.avatarUrl,
          actorUrl: actor.htmlUrl ?? `https://github.com/${actor.login}`,
          followerCount: Math.max(0, input.followerCount),
          occurredAt,
        })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );

  if (!event) {
    log.debug("duplicate follower event skipped", { userId, actor: actor.login, action: input.action });
    return null;
  }
  log.info("follower event recorded", {
    userId,
    actor: event.actorLogin,
    action: event.action,
    followers: event.followerCount,
  });
  if (options.notify !== false) enqueueFollowerDeliveries(event);
  return event;
}

/** Compare the fetched followers with the stored ones. The fetched list is complete, so removals are exact. */
export function diffFollowers(known: Map<number, KnownFollower>, fetched: GitHubUserSummary[]) {
  const seen = new Map<number, GitHubUserSummary>();
  for (const f of fetched) if (!seen.has(f.id)) seen.set(f.id, f);
  const added = [...seen.values()].filter((f) => !known.has(f.id));
  const removed = [...known.values()].filter((k) => !seen.has(k.githubUserId));
  return { added, removed, total: seen.size };
}

/** Replace the stored followers without recording events, so existing followers do not trigger alerts. */
function importFollowers(userId: string, fetched: GitHubUserSummary[]): number {
  const unique = [...new Map(fetched.map((f) => [f.id, f])).values()];
  getDb().transaction((tx) => {
    tx.delete(followers).where(eq(followers.userId, userId)).run();
    for (let i = 0; i < unique.length; i += INSERT_CHUNK) {
      const rows = unique.slice(i, i + INSERT_CHUNK).map((f) => ({
        userId,
        githubUserId: f.id,
        login: f.login,
        avatarUrl: f.avatar_url ?? null,
        followedAt: null,
      }));
      tx.insert(followers).values(rows).onConflictDoNothing().run();
    }
  });
  return unique.length;
}

/** Forget the stored followers, so the next check imports them again silently. Events are kept. */
export function resetFollowers(userId: string) {
  getDb().delete(followers).where(eq(followers.userId, userId)).run();
  updateUserSettings(userId, {
    followerCount: 0,
    followersImportedAt: null,
    followersCheckedAt: null,
    followersError: null,
  });
}

/**
 * Check the follower count of the token's account and, when it changed, fetch the full follower list and record
 * follows and unfollows. The first run imports the current followers silently. Throws on GitHub errors.
 */
export function syncFollowers(userId: string): Promise<FollowerSummary> {
  return withLock(lockKey(userId), async () => {
    const settings = getUserSettings(userId);
    const summary: FollowerSummary = {
      followers: settings.followerCount,
      followed: 0,
      unfollowed: 0,
      imported: false,
      skipped: false,
    };
    const client = getGithubClient(userId);
    if (!settings.followersEnabled || !client) return { ...summary, skipped: true };

    try {
      const { user: account } = await client.getAuthenticatedUser();
      const remoteCount = account.followers ?? 0;
      const known = loadKnownFollowers(userId);
      const imported = settings.followersImportedAt !== null;

      if (imported && remoteCount === known.size) {
        const checked = { followerCount: remoteCount, followersCheckedAt: new Date(), followersError: null };
        updateUserSettings(userId, checked);
        return { ...summary, followers: remoteCount };
      }

      const pages = Math.max(1, Math.ceil(remoteCount / 100));
      if (pages > MAX_FOLLOWER_PAGES) {
        throw new Error(`Too many followers to track, the limit is ${MAX_FOLLOWER_PAGES * 100}`);
      }
      if (client.shouldBackOff(pages)) {
        log.warn("rate limit low, skipping follower check", { userId });
        return { ...summary, skipped: true };
      }

      const fetched = await client.listFollowers();
      // Tracking may have been turned off while the list was loading.
      if (!getUserSettings(userId).followersEnabled) return { ...summary, skipped: true };

      if (!imported) {
        const total = importFollowers(userId, fetched);
        updateUserSettings(userId, {
          followerCount: total,
          followersImportedAt: new Date(),
          followersCheckedAt: new Date(),
          followersError: null,
        });
        log.info("followers imported", { userId, followers: total });
        return { ...summary, followers: total, imported: true };
      }

      const diff = diffFollowers(known, fetched);
      let running = known.size;
      for (const k of diff.removed) {
        running = Math.max(0, running - 1);
        const actor = { id: k.githubUserId, login: k.login, avatarUrl: k.avatarUrl, htmlUrl: null };
        if (recordFollowerEvent(userId, { action: "unfollowed", actor, followerCount: running })) summary.unfollowed++;
      }
      for (const f of diff.added) {
        running++;
        const actor = { id: f.id, login: f.login, avatarUrl: f.avatar_url ?? null, htmlUrl: f.html_url ?? null };
        if (recordFollowerEvent(userId, { action: "followed", actor, followerCount: running })) summary.followed++;
      }

      updateUserSettings(userId, { followerCount: diff.total, followersCheckedAt: new Date(), followersError: null });
      log.info("followers checked", { userId, followed: summary.followed, unfollowed: summary.unfollowed, pages });
      return { ...summary, followers: diff.total };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateUserSettings(userId, { followersCheckedAt: new Date(), followersError: message });
      log.warn("follower check failed", { userId, error: message });
      throw err;
    }
  });
}

/** Turn tracking on (and start the silent import) or off (and forget the stored followers). */
export function setFollowerTracking(userId: string, enabled: boolean) {
  if (enabled) {
    if (getUserSettings(userId).followersEnabled) return;
    updateUserSettings(userId, { followersEnabled: true, followersError: null });
    void syncFollowers(userId).catch(() => undefined);
    return;
  }
  updateUserSettings(userId, { followersEnabled: false });
  resetFollowers(userId);
}
