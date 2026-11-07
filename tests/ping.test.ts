import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setDb } from "../src/server/db/client";
import { repositories, user, type Repository } from "../src/server/db/schema";
import { GitHubClient } from "../src/server/github/client";
import { describeDelivery } from "../src/server/github/hooks";
import { pingAndVerify } from "../src/server/services/ping";
import { handlePing } from "../src/server/services/webhooks";
import { createTestDb } from "./helpers";

describe("describeDelivery", () => {
  test("explains common failures", () => {
    expect(describeDelivery({ statusCode: 0, status: "failed to connect to host" })).toMatchObject({
      ok: false,
      statusCode: null,
    });
    expect(describeDelivery({ statusCode: 0, status: "failed to connect to host" }).message).toContain(
      "could not reach",
    );
    expect(describeDelivery({ statusCode: 401, status: "Unauthorized" }).message).toContain("signature");
    expect(describeDelivery({ statusCode: 403, status: "Forbidden" }).message).toContain("Cloudflare");
    expect(describeDelivery({ statusCode: 302, status: "Found" }).message).toContain("redirects");
    expect(describeDelivery({ statusCode: 502, status: "Bad Gateway" }).message).toContain("proxy");
  });

  test("a 2xx that never reached StarWatch is still a failure", () => {
    const result = describeDelivery({ statusCode: 200, status: "OK" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("another server");
  });
});

describe("pingAndVerify", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let repo: Repository;

  beforeEach(() => {
    ctx = createTestDb();
    setDb(ctx.db);
    ctx.db.insert(user).values({ id: "u1", name: "One", email: "one@example.com" }).run();
    repo = ctx.db
      .insert(repositories)
      .values({
        userId: "u1",
        githubId: 77,
        fullName: "o/r",
        name: "r",
        owner: "o",
        htmlUrl: "https://github.com/o/r",
        monitored: true,
        hookId: 5,
        hookStatus: "active",
      })
      .returning()
      .get();
  });
  afterEach(() => ctx.cleanup());

  function fakeGitHub(onPing: () => void, deliveries: unknown[] = []) {
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pings")) {
        onPing();
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/deliveries")) return Response.json(deliveries);
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    return new GitHubClient("token", `test-${Math.random()}`, fetchImpl);
  }

  test("succeeds when the ping arrives", async () => {
    const deliver = () => handlePing({ hook_id: 5, repository: { id: 77, full_name: "o/r" } });
    const client = fakeGitHub(() => setTimeout(deliver, 100));
    const result = await pingAndVerify(client, { ...repo, hookId: 5 });
    expect(result.ok).toBe(true);
    const row = ctx.db.select().from(repositories).where(eq(repositories.id, repo.id)).get()!;
    expect(row.hookStatus).toBe("active");
    expect(row.lastDeliveryAt).not.toBeNull();
  });

  test("reports GitHub's response when the ping is blocked", async () => {
    const delivery = {
      id: 1,
      guid: "g",
      delivered_at: new Date().toISOString(),
      redelivery: false,
      duration: 0.1,
      status: "Invalid HTTP Response: 403",
      status_code: 403,
      event: "ping",
      action: null,
    };
    const client = fakeGitHub(() => undefined, [delivery]);
    const result = await pingAndVerify(client, { ...repo, hookId: 5 });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
    const row = ctx.db.select().from(repositories).where(eq(repositories.id, repo.id)).get()!;
    expect(row.hookStatus).toBe("error");
    expect(row.hookError).toContain("403");
  });
});
