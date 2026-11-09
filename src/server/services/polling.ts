import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { GitHubRateLimitError, type GitHubClient } from "../github/client";
import { repositories, stargazers, type Repository } from "../db/schema";
import {
  collectStargazerChanges,
  MAX_STARGAZER_PAGES,
  toRemoteStargazer,
  type KnownStargazer,
} from "../github/stargazers";
import { withLock } from "../lib/locks";
import { logger } from "../logger";
import { isBackfilling } from "./backfill";
import { getGithubClient, updateUserSettings } from "./settings";
import { recordStarEvent } from "./stars";

const log = logger.child("poll");

export interface PollSummary {
  checked: number;
  changed: number;
  events: number;
  skipped: boolean;
}

export interface ReconcileResult {
  added: number;
  removed: number;
  events: number;
}

function loadKnownStargazers(repoId: number): Map<number, KnownStargazer> {
  return new Map(
    getDb()
      .select()
      .from(stargazers)
      .where(eq(stargazers.repositoryId, repoId))
      .all()
      .map((s) => [s.githubUserId, s]),
  );
}

/** Number of stargazers stored for a repo. */
export function trackedStargazerCount(repoId: number): number {
  return getDb().select({ n: count() }).from(stargazers).where(eq(stargazers.repositoryId, repoId)).get()?.n ?? 0;
}

/**
 * Bring the stored stargazers of one repo in line with GitHub when `remoteCount` (its stargazers_count)
 * differs from what is tracked. Stars and unstars found this way are recorded as polling events.
 * Polling uses this for its repos, and the sync uses it for webhook-only repos, because GitHub sends no
 * webhook when it removes stars itself (for example from deleted or spam-flagged accounts).
 * Returns null when nothing had to be fetched. Throws on GitHub errors.
 */
export function reconcileStargazers(
  client: GitHubClient,
  repo: Repository,
  remoteCount: number,
  trigger: "poll" | "sync" = "poll",
): Promise<ReconcileResult | null> {
  return withLock(`reconcile:${repo.id}`, async () => {
    // The initial import replaces the whole list, so a diff now would race with it.
    if (isBackfilling(repo.id)) return null;
    const db = getDb();
    const known = loadKnownStargazers(repo.id);
    // Only polling counts as a poll, so the "Polled" label keeps its meaning.
    const repoUpdate =
      trigger === "poll" ? { starCount: remoteCount, lastPolledAt: new Date() } : { starCount: remoteCount };

    if (remoteCount === known.size) {
      db.update(repositories).set(repoUpdate).where(eq(repositories.id, repo.id)).run();
      return null;
    }

    if (Math.ceil(remoteCount / 100) > MAX_STARGAZER_PAGES) {
      log.warn("too many stargazers to compare, use webhook mode", { repo: repo.fullName });
      return null;
    }

    const diff = await collectStargazerChanges({
      known,
      remoteCount,
      fetchPage: async (page) => (await client.listStargazersPage(repo.fullName, page)).map(toRemoteStargazer),
    });

    const result: ReconcileResult = { added: diff.added.length, removed: diff.removed.length, events: 0 };
    let running = known.size;
    for (const s of diff.removed) {
      running = Math.max(0, running - 1);
      const event = recordStarEvent(repo, {
        action: "deleted",
        actor: { id: s.githubUserId, login: s.login, avatarUrl: s.avatarUrl, htmlUrl: null },
        starredAt: null,
        starCount: running,
        source: "polling",
      });
      if (event) result.events++;
    }
    for (const s of diff.added) {
      running++;
      const event = recordStarEvent(repo, {
        action: "created",
        actor: { id: s.id, login: s.login, avatarUrl: s.avatarUrl, htmlUrl: s.htmlUrl },
        starredAt: s.starredAt,
        starCount: running,
        source: "polling",
      });
      if (event) result.events++;
    }

    db.update(repositories).set(repoUpdate).where(eq(repositories.id, repo.id)).run();
    log.info("stargazers reconciled", {
      repo: repo.fullName,
      trigger,
      added: diff.added.length,
      removed: diff.removed.length,
      pages: diff.pagesFetched,
      complete: diff.complete,
    });
    return result;
  });
}

/**
 * Compare each polled repo's stargazers_count with the stored stargazers.
 * Only repos whose count differs cost extra requests to fetch the stargazer pages.
 */
export function pollUser(userId: string): Promise<PollSummary> {
  return withLock(`poll:${userId}`, async () => {
    const summary: PollSummary = { checked: 0, changed: 0, events: 0, skipped: false };
    const client = getGithubClient(userId);
    if (!client) return summary;
    const db = getDb();

    const repos = db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.userId, userId),
          eq(repositories.monitored, true),
          isNull(repositories.removedAt),
          isNotNull(repositories.backfilledAt),
          inArray(repositories.mode, ["polling", "both"]),
        ),
      )
      .all();

    if (repos.length === 0 || client.shouldBackOff(Math.ceil(repos.length / 100) + 1)) {
      summary.skipped = repos.length > 0;
      updateUserSettings(userId, { lastPollAt: new Date() });
      return summary;
    }

    try {
      const remote = new Map((await client.listOwnedRepos()).map((r) => [r.id, r]));

      for (const repo of repos) {
        const r = remote.get(repo.githubId);
        if (!r) continue;
        summary.checked++;

        if (r.stargazers_count !== trackedStargazerCount(repo.id) && client.shouldBackOff(2)) {
          summary.skipped = true;
          log.warn("rate limit low, stopping poll early", { userId });
          break;
        }

        try {
          const result = await reconcileStargazers(client, repo, r.stargazers_count);
          if (result) {
            summary.changed++;
            summary.events += result.events;
          }
        } catch (err) {
          log.warn("repo poll failed", { repo: repo.fullName, error: err instanceof Error ? err.message : String(err) });
          if (err instanceof GitHubRateLimitError) break;
        }
      }
    } catch (err) {
      log.warn("poll failed", { userId, error: err instanceof Error ? err.message : String(err) });
    }

    updateUserSettings(userId, { lastPollAt: new Date() });
    return summary;
  });
}
