import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { repositories } from "../db/schema";
import type { GitHubClient, GitHubHookDelivery } from "../github/client";
import { describeDelivery, type PingResult } from "../github/hooks";
import { logger } from "../logger";

const log = logger.child("ping");

const TIMEOUT_MS = 15_000;
const POLL_MS = 1_000;
/** Tolerance for clock differences between this server and GitHub. */
const SKEW_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function receivedSince(repoId: number, since: number): boolean {
  const row = getDb()
    .select({ at: repositories.lastDeliveryAt })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get();
  return Boolean(row?.at && row.at.getTime() >= since);
}

async function latestPingDelivery(client: GitHubClient, fullName: string, hookId: number, sentAt: number) {
  try {
    const deliveries = await client.listHookDeliveries(fullName, hookId);
    return deliveries.find(
      (d: GitHubHookDelivery) => d.event === "ping" && Date.parse(d.delivered_at) >= sentAt - SKEW_MS,
    );
  } catch (err) {
    log.debug("could not read hook deliveries", { repo: fullName, error: String(err) });
    return undefined;
  }
}

/**
 * Ask GitHub to ping the webhook, then wait for it to arrive here. If it does not, read GitHub's
 * delivery log to explain what GitHub got back. The repo's webhook status is updated either way.
 */
export async function pingAndVerify(
  client: GitHubClient,
  repo: { id: number; userId: string; fullName: string; hookId: number },
): Promise<PingResult> {
  const sentAt = Date.now();
  await client.pingHook(repo.fullName, repo.hookId);

  let result: PingResult | null = null;
  let lastDelivery: GitHubHookDelivery | undefined;

  for (let waited = 0; waited < TIMEOUT_MS && !result; waited += POLL_MS) {
    await sleep(POLL_MS);
    if (receivedSince(repo.id, sentAt)) {
      result = { ok: true, statusCode: 200, message: "Ping received. The webhook works." };
      break;
    }
    // GitHub's delivery log lags a little, so only check it every other second.
    if (waited % (2 * POLL_MS) === POLL_MS) {
      lastDelivery = await latestPingDelivery(client, repo.fullName, repo.hookId, sentAt);
      const failed = lastDelivery && !(lastDelivery.status_code >= 200 && lastDelivery.status_code < 300);
      if (failed) result = describeDelivery({ statusCode: lastDelivery!.status_code, status: lastDelivery!.status });
    }
  }

  if (!result) {
    result = lastDelivery
      ? describeDelivery({ statusCode: lastDelivery.status_code, status: lastDelivery.status })
      : {
          ok: false,
          statusCode: null,
          message:
            "No ping arrived within 15 seconds and GitHub has not logged a delivery yet. " +
            "Check Recent Deliveries for this webhook on GitHub.",
        };
  }

  getDb()
    .update(repositories)
    .set({
      hookStatus: result.ok ? "active" : "error",
      hookError: result.ok ? null : result.message,
      hookCheckedAt: new Date(),
    })
    .where(and(eq(repositories.id, repo.id), eq(repositories.userId, repo.userId)))
    .run();

  log.info("webhook ping checked", { repo: repo.fullName, ok: result.ok, statusCode: result.statusCode });
  return result;
}
