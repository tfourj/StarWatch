import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { repositories, type Repository } from "../db/schema";
import { GitHubRateLimitError, type GitHubClient, type GitHubRepo } from "../github/client";
import { ensureHook, removeHook, type HookResult } from "../github/hooks";
import { withLock } from "../lib/locks";
import { logger } from "../logger";
import { backfillRepository } from "./backfill";
import { getGithubClient, getUserSettings, getWebhookSecret, getWebhookUrl, updateUserSettings } from "./settings";

const log = logger.child("sync");

export interface SyncSummary {
  repos: number;
  added: number;
  removed: number;
  hooksCreated: number;
  hooksRepaired: number;
  hooksDeleted: number;
  hookErrors: number;
}

export function wantsWebhook(repo: Repository): boolean {
  return repo.monitored && !repo.removedAt && repo.mode !== "polling";
}

function repoFields(remote: GitHubRepo) {
  return {
    fullName: remote.full_name,
    name: remote.name,
    owner: remote.owner.login,
    htmlUrl: remote.html_url,
    description: remote.description,
    private: remote.private,
    fork: remote.fork,
    archived: remote.archived,
    starCount: remote.stargazers_count,
  };
}

/** Bring one repository's webhook in line with its monitoring settings. */
export async function syncRepoHook(client: GitHubClient, repo: Repository): Promise<HookResult> {
  const target = { url: getWebhookUrl(), secret: getWebhookSecret() };
  let result: HookResult;

  if (wantsWebhook(repo) && repo.archived) {
    result = { hookId: repo.hookId, status: "error", error: "Archived repositories cannot be changed", action: "none" };
  } else if (wantsWebhook(repo)) {
    result = await ensureHook(client, repo.fullName, target, repo.hookId);
  } else if (repo.hookId || repo.hookStatus !== "none") {
    result = repo.removedAt
      ? { hookId: null, status: "none", error: null, action: "none" }
      : await removeHook(client, repo.fullName, target, repo.hookId);
  } else {
    return { hookId: null, status: "none", error: null, action: "none" };
  }

  getDb()
    .update(repositories)
    .set({ hookId: result.hookId, hookStatus: result.status, hookError: result.error, hookCheckedAt: new Date() })
    .where(eq(repositories.id, repo.id))
    .run();

  if (result.action !== "unchanged" && result.action !== "none") {
    log.info(`webhook ${result.action}`, { repo: repo.fullName, hookId: result.hookId });
  }
  if (result.error) log.warn("webhook problem", { repo: repo.fullName, error: result.error });
  return result;
}

/** List owned repos, record new ones, then create, repair or remove webhooks. */
export function syncRepositories(userId: string): Promise<SyncSummary> {
  return withLock(`sync:${userId}`, async () => {
    const client = getGithubClient(userId);
    if (!client) throw new Error("No GitHub token configured");
    const db = getDb();
    const settings = getUserSettings(userId);
    const summary: SyncSummary = {
      repos: 0,
      added: 0,
      removed: 0,
      hooksCreated: 0,
      hooksRepaired: 0,
      hooksDeleted: 0,
      hookErrors: 0,
    };

    try {
      const remote = await client.listOwnedRepos();
      const existing = new Map(
        db.select().from(repositories).where(eq(repositories.userId, userId)).all().map((r) => [r.githubId, r]),
      );
      const seen = new Set<number>();

      for (const r of remote) {
        seen.add(r.id);
        const row = existing.get(r.id);
        if (row) {
          db.update(repositories)
            .set({ ...repoFields(r), removedAt: null })
            .where(eq(repositories.id, row.id))
            .run();
        } else {
          const monitored = settings.autoMonitorNew && !r.fork && !r.archived;
          db.insert(repositories)
            .values({ userId, githubId: r.id, ...repoFields(r), monitored })
            .run();
          summary.added++;
        }
      }

      for (const row of existing.values()) {
        if (!seen.has(row.githubId) && !row.removedAt) {
          db.update(repositories)
            .set({ removedAt: new Date(), hookStatus: "none", hookId: null })
            .where(eq(repositories.id, row.id))
            .run();
          summary.removed++;
        }
      }

      const repos = db
        .select()
        .from(repositories)
        .where(and(eq(repositories.userId, userId), isNull(repositories.removedAt)))
        .all();
      summary.repos = repos.length;

      for (const repo of repos) {
        if (client.shouldBackOff(3)) {
          log.warn("rate limit low, stopping webhook sync early", { userId });
          break;
        }
        const result = await syncRepoHook(client, repo);
        if (result.action === "created") summary.hooksCreated++;
        if (result.action === "repaired") summary.hooksRepaired++;
        if (result.action === "deleted") summary.hooksDeleted++;
        if (result.status === "error") summary.hookErrors++;
      }

      updateUserSettings(userId, { lastSyncAt: new Date(), lastSyncError: null });
      log.info("sync complete", { userId, ...summary });

      // Initial imports run after the sync so the UI is not blocked.
      for (const repo of repos.filter((r) => r.monitored && !r.backfilledAt)) void backfillRepository(repo);
      return summary;
    } catch (err) {
      const message =
        err instanceof GitHubRateLimitError ? err.message : err instanceof Error ? err.message : String(err);
      updateUserSettings(userId, { lastSyncError: message, lastSyncAt: new Date() });
      log.error("sync failed", { userId, error: message });
      throw err;
    }
  });
}

/** Toggle monitoring or change mode, then fix the webhook and start the initial import if needed. */
export async function updateRepoMonitoring(
  userId: string,
  repoId: number,
  patch: { monitored?: boolean; mode?: Repository["mode"] },
): Promise<Repository | null> {
  const db = getDb();
  const repo = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, userId)))
    .get();
  if (!repo) return null;

  db.update(repositories).set(patch).where(eq(repositories.id, repoId)).run();
  const updated = db.select().from(repositories).where(eq(repositories.id, repoId)).get()!;

  const client = getGithubClient(userId);
  if (client) {
    await syncRepoHook(client, updated);
    if (updated.monitored && !updated.backfilledAt) void backfillRepository(updated);
  }
  return db.select().from(repositories).where(eq(repositories.id, repoId)).get() ?? null;
}
