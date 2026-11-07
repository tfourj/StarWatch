import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setDb } from "../src/server/db/client";
import { repositories, stargazers, starEvents, user, type Repository } from "../src/server/db/schema";
import { recordStarEvent } from "../src/server/services/stars";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;
let repo: Repository;

const actor = { id: 7, login: "octocat", avatarUrl: null, htmlUrl: null };

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
      starCount: 10,
      monitored: true,
      backfilledAt: new Date(),
    })
    .returning()
    .get();
});
afterEach(() => ctx.cleanup());

describe("recordStarEvent", () => {
  test("a star seen by webhook and then polling is recorded once", () => {
    const first = recordStarEvent(repo, { action: "created", actor, starredAt: null, starCount: 11, source: "webhook" });
    const second = recordStarEvent(repo, { action: "created", actor, starredAt: null, starCount: 11, source: "polling" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(ctx.db.select().from(starEvents).all()).toHaveLength(1);
  });

  test("unstar removes the stargazer and updates the count", () => {
    recordStarEvent(repo, { action: "created", actor, starredAt: null, starCount: 11, source: "webhook" });
    const unstar = recordStarEvent(repo, { action: "deleted", actor, starredAt: null, starCount: null, source: "webhook" });
    expect(unstar?.starCount).toBe(10);
    expect(ctx.db.select().from(stargazers).all()).toHaveLength(0);
    expect(ctx.db.select().from(repositories).where(eq(repositories.id, repo.id)).get()?.starCount).toBe(10);
  });

  test("an unknown unstar on a backfilled repo is treated as a duplicate", () => {
    expect(recordStarEvent(repo, { action: "deleted", actor, starredAt: null, starCount: 9, source: "polling" })).toBeNull();
  });
});
