import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { repositories, stargazers, type Repository } from "../db/schema";
import { GitHubRateLimitError, type GitHubClient } from "../github/client";
import { toRemoteStargazer, type RemoteStargazer } from "../github/stargazers";
import { withLock } from "../lib/locks";
import { logger } from "../logger";
import { getGithubClient } from "./settings";

const log = logger.child("backfill");
const PER_PAGE = 100;

export async function fetchAllStargazers(client: GitHubClient, fullName: string): Promise<RemoteStargazer[]> {
  const all: RemoteStargazer[] = [];
  for (let page = 1; ; page++) {
    if (client.shouldBackOff(1)) throw new GitHubRateLimitError(client.rateLimit?.resetAt ?? Date.now() + 60_000);
    const items = await client.listStargazersPage(fullName, page, PER_PAGE);
    all.push(...items.map(toRemoteStargazer));
    if (items.length < PER_PAGE) break;
  }
  return all;
}

/** Import the current stargazers silently so later diffs and webhooks only report new activity. */
export function backfillRepository(repo: Repository): Promise<void> {
  return withLock(`backfill:${repo.id}`, async () => {
    const client = getGithubClient(repo.userId);
    if (!client) return;
    const db = getDb();
    try {
      const all = await fetchAllStargazers(client, repo.fullName);
      db.transaction((tx) => {
        for (const s of all) {
          tx.insert(stargazers)
            .values({
              repositoryId: repo.id,
              githubUserId: s.id,
              login: s.login,
              avatarUrl: s.avatarUrl,
              starredAt: s.starredAt,
            })
            .onConflictDoNothing()
            .run();
        }
        tx.update(repositories)
          .set({ backfilledAt: new Date(), backfillError: null, starCount: all.length })
          .where(eq(repositories.id, repo.id))
          .run();
      });
      log.info("stargazers imported", { repo: repo.fullName, count: all.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.update(repositories).set({ backfillError: message }).where(eq(repositories.id, repo.id)).run();
      log.warn("stargazer import failed", { repo: repo.fullName, error: message });
    }
  });
}
