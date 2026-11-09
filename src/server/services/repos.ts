import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { repositories, type Repository } from "../db/schema";
import { GitHubRateLimitError, type GitHubClient, type GitHubRepo } from "../github/client";
import { ensureHook, removeHook, type HookResult } from "../github/hooks";
import { withLock } from "../lib/locks";
import { logger } from "../logger";
import { backfillRepository, markImportQueued } from "./backfill";
import { reconcileStargazers, trackedStargazerCount } from "./polling";
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
  /** Webhook-only repos whose stored stargazers were compared with GitHub because the counts differed. */
  reconciled: number;
  /** Stars and unstars found by those comparisons. */
  reconciledEvents: number;
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
      reconciled: 0,
      reconciledEvents: 0,
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
      const toImport = repos.filter((r) => r.monitored && !r.backfilledAt);
      markImportQueued(toImport.map((r) => r.id));

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

      // Polling covers its own repos. Webhook-only repos are checked here, because GitHub sends no webhook
      // when it drops stars itself (deleted or spam-flagged accounts) or when a delivery is lost.
      for (const repo of repos) {
        if (!repo.monitored || !repo.backfilledAt || repo.mode !== "webhook") continue;
        if (repo.starCount === trackedStargazerCount(repo.id)) continue;
        if (client.shouldBackOff(3)) {
          log.warn("rate limit low, the next sync will compare the remaining stargazers", { userId });
          break;
        }
        try {
          const result = await reconcileStargazers(client, repo, repo.starCount, "sync");
          if (result) {
            summary.reconciled++;
            summary.reconciledEvents += result.events;
          }
        } catch (err) {
          log.warn("stargazer reconcile failed", {
            repo: repo.fullName,
            error: err instanceof Error ? err.message : String(err),
          });
          if (err instanceof GitHubRateLimitError) break;
        }
      }

      updateUserSettings(userId, { lastSyncAt: new Date(), lastSyncError: null });
      log.info("sync complete", { userId, ...summary });

      // Initial imports run after the sync so the UI is not blocked.
      for (const repo of toImport) void backfillRepository(repo);
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
  if (patch.monitored) markImportQueued([repoId]);
  const updated = db.select().from(repositories).where(eq(repositories.id, repoId)).get()!;

  const client = getGithubClient(userId);
  if (client) {
    await syncRepoHook(client, updated);
    if (updated.monitored && !updated.backfilledAt) void backfillRepository(updated);
  }
  return db.select().from(repositories).where(eq(repositories.id, repoId)).get() ?? null;
}

export interface BulkMonitoringResult {
  /** Repos whose monitoring flag changed. */
  updated: number;
  /** Repos whose webhook is being created or removed in the background. */
  hooksPending: number;
}

/**
 * Turn monitoring on or off for all of a user's repos, or only `repoIds`, optionally setting the mode too.
 * Rows change immediately; webhooks are created or removed in the background.
 */
export function setMonitoringForRepos(
  userId: string,
  monitored: boolean,
  repoIds?: number[],
  mode?: Repository["mode"],
): BulkMonitoringResult {
  const db = getDb();
  const scope = and(
    eq(repositories.userId, userId),
    isNull(repositories.removedAt),
    repoIds ? inArray(repositories.id, repoIds.length ? repoIds : [-1]) : undefined,
  );
  const rows = db.select().from(repositories).where(scope).all();

  const changed = rows.filter((r) => r.monitored !== monitored || (mode !== undefined && r.mode !== mode));
  // Turning off also cleans up hooks left on repos that were already off.
  const needsHookWork = rows.filter(
    (r) => changed.includes(r) || (!monitored && (r.hookId !== null || r.hookStatus !== "none")),
  );

  if (changed.length) {
    db.update(repositories)
      .set(mode === undefined ? { monitored } : { monitored, mode })
      .where(inArray(repositories.id, changed.map((r) => r.id)))
      .run();
    if (monitored) markImportQueued(changed.map((r) => r.id));
  }

  const ids = needsHookWork.map((r) => r.id);
  // Only count repos where a webhook is actually created or removed (polling-only repos need none).
  const hooksPending = needsHookWork.filter((r) => {
    const next = { ...r, monitored, mode: mode ?? r.mode };
    return wantsWebhook(next) || r.hookId !== null || r.hookStatus !== "none";
  }).length;
  if (ids.length) void syncHooksFor(userId, ids);
  log.info("bulk monitoring change", { userId, monitored, mode, updated: changed.length, hooksPending });
  return { updated: changed.length, hooksPending };
}

const hookQueues = new Map<string, Promise<void>>();

/** Queue webhook updates per user so quick on/off toggles run in order. Rows are re-read when the work runs. */
function syncHooksFor(userId: string, repoIds: number[]): Promise<void> {
  const previous = hookQueues.get(userId) ?? Promise.resolve();
  const next = previous
    .then(() => runHookSync(userId, repoIds))
    .catch((err) => log.error("bulk webhook update failed", { userId, err }));
  hookQueues.set(userId, next);
  void next.finally(() => {
    if (hookQueues.get(userId) === next) hookQueues.delete(userId);
  });
  return next;
}

async function runHookSync(userId: string, repoIds: number[]) {
  const client = getGithubClient(userId);
  if (!client) return;
  const repos = getDb().select().from(repositories).where(inArray(repositories.id, repoIds)).all();
  for (const repo of repos) {
    if (client.shouldBackOff(3)) {
      log.warn("rate limit low, the next sync will finish the remaining webhooks", { userId });
      break;
    }
    await syncRepoHook(client, repo).catch((err) => log.error("webhook update failed", { repo: repo.fullName, err }));
    if (repo.monitored && !repo.backfilledAt) void backfillRepository(repo);
  }
}
