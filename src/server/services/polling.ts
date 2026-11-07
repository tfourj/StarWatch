import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { GitHubRateLimitError } from "../github/client";
import { repositories, stargazers } from "../db/schema";
import {
  collectStargazerChanges,
  MAX_STARGAZER_PAGES,
  toRemoteStargazer,
  type KnownStargazer,
} from "../github/stargazers";
import { withLock } from "../lib/locks";
import { logger } from "../logger";
import { getGithubClient, updateUserSettings } from "./settings";
import { recordStarEvent } from "./stars";

const log = logger.child("poll");

export interface PollSummary {
  checked: number;
  changed: number;
  events: number;
  skipped: boolean;
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

        const known = new Map<number, KnownStargazer>(
          db
            .select()
            .from(stargazers)
            .where(eq(stargazers.repositoryId, repo.id))
            .all()
            .map((s) => [s.githubUserId, s]),
        );

        if (r.stargazers_count === known.size) {
          db.update(repositories)
            .set({ lastPolledAt: new Date(), starCount: r.stargazers_count })
            .where(eq(repositories.id, repo.id))
            .run();
          continue;
        }

        if (client.shouldBackOff(2)) {
          summary.skipped = true;
          log.warn("rate limit low, stopping poll early", { userId });
          break;
        }

        if (Math.ceil(r.stargazers_count / 100) > MAX_STARGAZER_PAGES) {
          log.warn("too many stargazers to poll, use webhook mode", { repo: repo.fullName });
          continue;
        }

        summary.changed++;
        try {
          const diff = await collectStargazerChanges({
            known,
            remoteCount: r.stargazers_count,
            fetchPage: async (page) => (await client.listStargazersPage(repo.fullName, page)).map(toRemoteStargazer),
          });

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
            if (event) summary.events++;
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
            if (event) summary.events++;
          }

          db.update(repositories)
            .set({ lastPolledAt: new Date(), starCount: r.stargazers_count })
            .where(eq(repositories.id, repo.id))
            .run();
          log.info("repo polled", {
            repo: repo.fullName,
            added: diff.added.length,
            removed: diff.removed.length,
            pages: diff.pagesFetched,
            complete: diff.complete,
          });
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
