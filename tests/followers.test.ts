import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setConfig } from "../src/server/config";
import { setDb } from "../src/server/db/client";
import { channels, followerDeliveries, followerEvents, followers, user } from "../src/server/db/schema";
import type { GitHubUserSummary } from "../src/server/github/client";
import { cipher } from "../src/server/lib/crypto";
import { followChannelMatches } from "../src/server/notifications/dispatcher";
import { buildFollowMessage } from "../src/server/notifications/follow-message";
import { mainLink } from "../src/server/notifications/links";
import { registerProvider } from "../src/server/notifications/providers";
import { webhook } from "../src/server/notifications/providers/webhook";
import {
  diffFollowers,
  recordFollowerEvent,
  setFollowerTracking,
  syncFollowers,
} from "../src/server/services/followers";
import { getUserSettings, updateUserSettings } from "../src/server/services/settings";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;
let remote: number[] = [];
let requests: string[] = [];
const realFetch = globalThis.fetch;

registerProvider({ type: "fake-follow", async send() {} });

const summary = (id: number): GitHubUserSummary => ({
  id,
  login: `user${id}`,
  avatar_url: "",
  html_url: `https://github.com/user${id}`,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function addChannel(extra: Partial<typeof channels.$inferInsert> = {}) {
  return ctx.db
    .insert(channels)
    .values({ userId: "u1", name: "Fake", type: "fake-follow", config: cipher().encryptJson({}), ...extra })
    .returning()
    .get();
}

const stored = () =>
  ctx.db
    .select()
    .from(followers)
    .where(eq(followers.userId, "u1"))
    .all()
    .map((f) => f.githubUserId)
    .sort((a, b) => a - b);

const events = () => ctx.db.select().from(followerEvents).all();

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  setConfig({
    port: 4321,
    tunnelPort: 4322,
    baseUrl: "https://stars.example.com",
    dataDir: "/tmp",
    dbPath: ctx.file,
    betterAuthSecret: "a-better-auth-secret-that-is-long-enough",
    encryptionSecret: "a-test-secret-that-is-long-enough-123",
    allowRegistration: true,
    timezone: "UTC",
    github: null,
    isProduction: false,
  });
  ctx.db.insert(user).values({ id: "u1", name: "Owner", email: "o@example.com", role: "admin" }).run();
  updateUserSettings("u1", { githubToken: cipher().encrypt("ghp_test"), githubLogin: "me", followersEnabled: true });

  remote = [];
  requests = [];
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === "/user") return json({ ...summary(1), login: "me", name: null, followers: remote.length });
    if (url.pathname === "/user/followers") return json(remote.map(summary));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.cleanup();
});

describe("diffFollowers", () => {
  test("finds new and removed followers and ignores duplicates", () => {
    const known = new Map([1, 2, 3].map((id) => [id, { githubUserId: id, login: `user${id}`, avatarUrl: null }]));
    const diff = diffFollowers(known, [summary(2), summary(3), summary(4), summary(4)]);
    expect(diff.added.map((f) => f.id)).toEqual([4]);
    expect(diff.removed.map((f) => f.githubUserId)).toEqual([1]);
    expect(diff.total).toBe(3);
  });
});

describe("syncFollowers", () => {
  test("imports current followers silently on the first run", async () => {
    addChannel();
    remote = [10, 11, 12];
    const result = await syncFollowers("u1");
    expect(result).toMatchObject({ imported: true, followers: 3, followed: 0, unfollowed: 0 });
    expect(stored()).toEqual([10, 11, 12]);
    expect(events()).toHaveLength(0);
    expect(getUserSettings("u1").followersImportedAt).not.toBeNull();
  });

  test("records follows and unfollows and queues deliveries", async () => {
    const channel = addChannel({ notifyUnfollow: false });
    remote = [10, 11, 12];
    await syncFollowers("u1");

    remote = [11, 12, 13, 14];
    const result = await syncFollowers("u1");
    expect(result).toMatchObject({ imported: false, followers: 4, followed: 2, unfollowed: 1 });
    expect(stored()).toEqual([11, 12, 13, 14]);

    const recorded = events().sort((a, b) => a.id - b.id);
    expect(recorded.map((e) => [e.action, e.actorId, e.followerCount])).toEqual([
      ["unfollowed", 10, 2],
      ["followed", 13, 3],
      ["followed", 14, 4],
    ]);

    const deliveries = ctx.db.select().from(followerDeliveries).all();
    const delivered = recorded.filter((e) => deliveries.some((d) => d.eventId === e.id));
    expect(delivered.map((e) => e.action)).toEqual(["followed", "followed"]);
    expect(deliveries.every((d) => d.channelId === channel.id)).toBe(true);
    expect(getUserSettings("u1").followerCount).toBe(4);
  });

  test("skips the follower list when the count is unchanged", async () => {
    remote = [10, 11];
    await syncFollowers("u1");
    requests = [];
    await syncFollowers("u1");
    expect(requests).toEqual(["/user"]);
  });

  test("does nothing while tracking is off", async () => {
    updateUserSettings("u1", { followersEnabled: false });
    const result = await syncFollowers("u1");
    expect(result.skipped).toBe(true);
    expect(requests).toHaveLength(0);
  });

  test("stores the error when GitHub fails", async () => {
    const denied = async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    globalThis.fetch = denied as unknown as typeof fetch;
    await expect(syncFollowers("u1")).rejects.toThrow("Bad credentials");
    expect(getUserSettings("u1").followersError).toContain("Bad credentials");
  });

  test("turning tracking off forgets the stored followers but keeps events", async () => {
    remote = [10];
    await syncFollowers("u1");
    remote = [10, 11];
    await syncFollowers("u1");
    setFollowerTracking("u1", false);
    expect(stored()).toEqual([]);
    expect(events()).toHaveLength(1);
    expect(getUserSettings("u1")).toMatchObject({ followersEnabled: false, followersImportedAt: null });
  });
});

describe("recordFollowerEvent", () => {
  test("ignores a follow that is already stored", () => {
    const actor = { id: 5, login: "user5", avatarUrl: null, htmlUrl: null };
    const input = { action: "followed" as const, actor, followerCount: 1 };
    expect(recordFollowerEvent("u1", input, { notify: false })).not.toBeNull();
    expect(recordFollowerEvent("u1", input, { notify: false })).toBeNull();
    expect(events()).toHaveLength(1);
  });
});

describe("follower notifications", () => {
  const event = {
    action: "followed" as const,
    actorLogin: "octocat",
    actorUrl: "https://github.com/octocat",
    actorAvatarUrl: null,
    followerCount: 1,
    occurredAt: new Date(Date.UTC(2026, 10, 7, 19)),
  };

  test("channels filter follows and unfollows on their own", () => {
    const channel = { enabled: true, notifyFollow: true, notifyUnfollow: false };
    expect(followChannelMatches(channel, { action: "followed" })).toBe(true);
    expect(followChannelMatches(channel, { action: "unfollowed" })).toBe(false);
    expect(followChannelMatches({ ...channel, enabled: false }, { action: "followed" })).toBe(false);
  });

  test("message names the follower and the new count", () => {
    const msg = buildFollowMessage(event, "me", { timeZone: "UTC" });
    expect(msg.title).toBe("New follower: octocat");
    expect(msg.body).toBe("[octocat](https://github.com/octocat) followed you on GitHub. You now have 1 follower.");
    const lost = { ...event, action: "unfollowed" as const, followerCount: 0 };
    const unfollow = buildFollowMessage(lost, "me", { timeZone: "UTC" });
    expect(unfollow.body).toContain("unfollowed you on GitHub. You now have 0 followers.");
  });

  test("main link opens the follower profile", () => {
    const msg = buildFollowMessage(event, "me", { timeZone: "UTC" });
    expect(mainLink({}, msg)).toEqual({ url: "https://github.com/octocat", label: "octocat" });
    expect(mainLink({ mainLink: "none" }, msg)).toBeNull();
  });

  test("webhook sends a follow payload", async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await webhook.send({ url: "https://example.com/hook" }, buildFollowMessage(event, "me", { timeZone: "UTC" }));
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      event: "follow",
      action: "followed",
      account: { login: "me", url: "https://github.com/me?tab=followers", followers: 1 },
      user: { login: "octocat", url: "https://github.com/octocat" },
    });
  });
});
