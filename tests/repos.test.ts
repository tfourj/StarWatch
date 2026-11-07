import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setDb } from "../src/server/db/client";
import { repositories, stargazers, user } from "../src/server/db/schema";
import { setMonitoringForRepos } from "../src/server/services/repos";
import { getUserSettings } from "../src/server/services/settings";
import { listStargazers } from "../src/server/services/stargazers";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;

function addRepo(userId: string, githubId: number, extra: Partial<typeof repositories.$inferInsert> = {}) {
  return ctx.db
    .insert(repositories)
    .values({
      userId,
      githubId,
      fullName: `o/r${githubId}`,
      name: `r${githubId}`,
      owner: "o",
      htmlUrl: `https://github.com/o/r${githubId}`,
      ...extra,
    })
    .returning()
    .get();
}

const monitoredIds = (userId: string) =>
  ctx.db
    .select()
    .from(repositories)
    .where(eq(repositories.userId, userId))
    .all()
    .filter((r) => r.monitored)
    .map((r) => r.githubId)
    .sort();

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  ctx.db.insert(user).values([
    { id: "u1", name: "One", email: "one@example.com" },
    { id: "u2", name: "Two", email: "two@example.com" },
  ]).run();
});
afterEach(() => ctx.cleanup());

describe("defaults", () => {
  test("new repositories are not monitored automatically", () => {
    expect(getUserSettings("u1").autoMonitorNew).toBe(false);
    expect(addRepo("u1", 1).monitored).toBe(false);
  });
});

describe("setMonitoringForRepos", () => {
  test("turns every repo of the user off and leaves other users alone", () => {
    addRepo("u1", 1, { monitored: true });
    addRepo("u1", 2, { monitored: true });
    addRepo("u1", 3);
    addRepo("u2", 4, { monitored: true });

    const result = setMonitoringForRepos("u1", false);
    expect(result.updated).toBe(2);
    expect(monitoredIds("u1")).toEqual([]);
    expect(monitoredIds("u2")).toEqual([4]);
  });

  test("turns repos on, limited to the given ids", () => {
    const a = addRepo("u1", 1);
    addRepo("u1", 2);
    const result = setMonitoringForRepos("u1", true, [a.id]);
    expect(result.updated).toBe(1);
    expect(monitoredIds("u1")).toEqual([1]);
  });

  test("ignores ids that belong to another user", () => {
    const other = addRepo("u2", 9);
    expect(setMonitoringForRepos("u1", true, [other.id]).updated).toBe(0);
    expect(monitoredIds("u2")).toEqual([]);
  });

  test("an empty id list changes nothing", () => {
    addRepo("u1", 1);
    expect(setMonitoringForRepos("u1", true, []).updated).toBe(0);
  });

  test("skips repos that were removed from GitHub", () => {
    addRepo("u1", 1, { monitored: true, removedAt: new Date() });
    expect(setMonitoringForRepos("u1", false).updated).toBe(0);
  });

  test("sets the mode when turning repos on", () => {
    const a = addRepo("u1", 1);
    const b = addRepo("u1", 2, { monitored: true, mode: "webhook" });
    const result = setMonitoringForRepos("u1", true, [a.id, b.id], "polling");
    expect(result.updated).toBe(2);
    // Repo b had no webhook and polling needs none, so nothing to create or remove.
    expect(result.hooksPending).toBe(0);
    const modes = ctx.db.select().from(repositories).all().map((r) => [r.githubId, r.monitored, r.mode]);
    expect(modes).toEqual([
      [1, true, "polling"],
      [2, true, "polling"],
    ]);
  });

  test("turning off still queues cleanup for leftover webhooks", () => {
    addRepo("u1", 1, { monitored: false, hookId: 55, hookStatus: "active" });
    const result = setMonitoringForRepos("u1", false);
    expect(result.updated).toBe(0);
    expect(result.hooksPending).toBe(1);
  });
});

describe("listStargazers", () => {
  function addStargazers(repoId: number, n: number) {
    for (let i = 1; i <= n; i++) {
      ctx.db
        .insert(stargazers)
        .values({
          repositoryId: repoId,
          githubUserId: i,
          login: `user${i}`,
          starredAt: i === n ? null : new Date(Date.UTC(2026, 0, i)),
        })
        .run();
    }
  }

  test("lists newest first with unknown dates last, paginated", () => {
    const repo = addRepo("u1", 1);
    addStargazers(repo.id, 5);
    const first = listStargazers("u1", repo.id, { pageSize: 2 })!;
    expect(first.total).toBe(5);
    expect(first.items.map((s) => s.login)).toEqual(["user4", "user3"]);
    const last = listStargazers("u1", repo.id, { pageSize: 2, page: 3 })!;
    expect(last.items.map((s) => s.login)).toEqual(["user5"]);
  });

  test("filters by login", () => {
    const repo = addRepo("u1", 1);
    addStargazers(repo.id, 12);
    const result = listStargazers("u1", repo.id, { q: "user1" })!;
    expect(result.items.map((s) => s.login).sort()).toEqual(["user1", "user10", "user11", "user12"]);
  });

  test("reports import progress fields", () => {
    const repo = addRepo("u1", 1, { backfillError: "403 Resource not accessible" });
    const result = listStargazers("u1", repo.id)!;
    expect(result.repo.importing).toBe(false);
    expect(result.repo.backfillError).toBe("403 Resource not accessible");
  });

  test("returns null for another user's repo", () => {
    const repo = addRepo("u2", 1);
    expect(listStargazers("u1", repo.id)).toBeNull();
  });
});
