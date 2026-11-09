import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setDb } from "../src/server/db/client";
import { repositories, stargazers, starEvents, user, type Repository } from "../src/server/db/schema";
import type { GitHubClient, GitHubStargazer } from "../src/server/github/client";
import { reconcileStargazers, trackedStargazerCount } from "../src/server/services/polling";
import { recordStarEvent } from "../src/server/services/stars";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;
let repo: Repository;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A client whose stargazer pages list `ids` oldest first, recording the pages requested. */
function fakeClient(ids: number[]) {
  const requested: number[] = [];
  const client = {
    async listStargazersPage(_fullName: string, page: number, perPage = 100): Promise<GitHubStargazer[]> {
      requested.push(page);
      return ids.slice((page - 1) * perPage, page * perPage).map((id) => ({
        starred_at: new Date(Date.UTC(2026, 0, 1, 0, id)).toISOString(),
        user: { id, login: `user${id}`, avatar_url: "", html_url: `https://github.com/user${id}` },
      }));
    },
  } as unknown as GitHubClient;
  return { client, requested };
}

function track(ids: number[]) {
  for (const id of ids) {
    ctx.db
      .insert(stargazers)
      .values({ repositoryId: repo.id, githubUserId: id, login: `user${id}`, starredAt: new Date() })
      .run();
  }
}

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  ctx.db.insert(user).values({ id: "u1", name: "Owner", email: "o@example.com", role: "admin" }).run();
  repo = ctx.db
    .insert(repositories)
    .values({
      userId: "u1",
      githubId: 99,
      fullName: "o/r",
      name: "r",
      owner: "o",
      htmlUrl: "https://github.com/o/r",
      starCount: 150,
      monitored: true,
      mode: "webhook",
      backfilledAt: new Date(),
    })
    .returning()
    .get();
});
afterEach(() => ctx.cleanup());

describe("reconcileStargazers", () => {
  test("removes a stargazer GitHub dropped without a webhook", async () => {
    track(range(1, 151));
    const { client } = fakeClient(range(1, 151).filter((id) => id !== 42));

    const result = await reconcileStargazers(client, repo, 150, "sync");

    expect(result).toEqual({ added: 0, removed: 1, events: 1 });
    expect(trackedStargazerCount(repo.id)).toBe(150);
    const events = ctx.db.select().from(starEvents).all();
    expect(events.map((e) => [e.action, e.actorId, e.starCount])).toEqual([["deleted", 42, 150]]);
    expect(ctx.db.select().from(repositories).where(eq(repositories.id, repo.id)).get()?.starCount).toBe(150);
  });

  test("adds a star whose webhook was lost", async () => {
    track(range(1, 149));
    const { client, requested } = fakeClient(range(1, 150));

    const result = await reconcileStargazers(client, repo, 150, "sync");

    expect(result).toEqual({ added: 1, removed: 0, events: 1 });
    expect(trackedStargazerCount(repo.id)).toBe(150);
    // Page 2 has the new star, page 1 is fully known, so the walk stops there.
    expect(requested).toEqual([2, 1]);
  });

  test("fetches nothing when the counts match", async () => {
    track(range(1, 150));
    const { client, requested } = fakeClient(range(1, 150));

    expect(await reconcileStargazers(client, repo, 150, "sync")).toBeNull();
    expect(requested).toEqual([]);
    expect(ctx.db.select().from(starEvents).all()).toEqual([]);
  });

  test("a webhook arriving after the reconcile is not recorded twice", async () => {
    track(range(1, 151));
    const { client } = fakeClient(range(1, 150));
    await reconcileStargazers(client, repo, 150, "sync");

    const late = recordStarEvent(repo, {
      action: "deleted",
      actor: { id: 151, login: "user151", avatarUrl: null, htmlUrl: null },
      starredAt: null,
      starCount: 150,
      source: "webhook",
    });
    expect(late).toBeNull();
    expect(ctx.db.select().from(starEvents).all()).toHaveLength(1);
  });
});
