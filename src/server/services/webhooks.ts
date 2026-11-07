import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { repositories } from "../db/schema";
import { recordStarEvent } from "./stars";

export interface StarWebhookPayload {
  action: "created" | "deleted";
  starred_at: string | null;
  repository: { id: number; full_name: string; stargazers_count: number };
  sender: { id: number; login: string; avatar_url?: string; html_url?: string };
}

export interface PingPayload {
  hook_id?: number;
  repository?: { id: number; full_name: string };
}

function targetRepos(githubId: number) {
  return getDb()
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.githubId, githubId),
        eq(repositories.monitored, true),
        isNull(repositories.removedAt),
        inArray(repositories.mode, ["webhook", "both"]),
      ),
    )
    .all();
}

export function isStarPayload(value: unknown): value is StarWebhookPayload {
  const p = value as StarWebhookPayload;
  return (
    !!p &&
    (p.action === "created" || p.action === "deleted") &&
    typeof p.repository?.id === "number" &&
    typeof p.sender?.id === "number" &&
    typeof p.sender?.login === "string"
  );
}

/** Returns the number of events recorded (0 when the repo is not monitored or it was a duplicate). */
export function handleStarWebhook(payload: StarWebhookPayload, deliveryId: string): number {
  const repos = targetRepos(payload.repository.id);
  let recorded = 0;
  for (const repo of repos) {
    getDb()
      .update(repositories)
      .set({ hookStatus: "active", hookError: null, hookCheckedAt: new Date() })
      .where(eq(repositories.id, repo.id))
      .run();
    const event = recordStarEvent(repo, {
      action: payload.action,
      actor: {
        id: payload.sender.id,
        login: payload.sender.login,
        avatarUrl: payload.sender.avatar_url ?? null,
        htmlUrl: payload.sender.html_url ?? null,
      },
      starredAt: payload.starred_at ? new Date(payload.starred_at) : null,
      starCount: payload.repository.stargazers_count,
      source: "webhook",
      deliveryId,
    });
    if (event) recorded++;
  }
  return recorded;
}

export function handlePing(payload: PingPayload): number {
  if (!payload.repository?.id) return 0;
  return getDb()
    .update(repositories)
    .set({ hookStatus: "active", hookError: null, hookCheckedAt: new Date(), hookId: payload.hook_id ?? undefined })
    .where(and(eq(repositories.githubId, payload.repository.id), eq(repositories.monitored, true)))
    .run().changes;
}
