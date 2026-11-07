import { describe, expect, test } from "bun:test";
import { GitHubClient, getRateLimit } from "../src/server/github/client";

function respond(headers: Record<string, string>) {
  return new Response("{}", { status: 200, headers: { "content-type": "application/json", ...headers } });
}

describe("rate limit tracking", () => {
  test("keeps GitHub's resource buckets apart", async () => {
    const replies = [
      respond({ "x-ratelimit-resource": "core", "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4990" }),
      respond({ "x-ratelimit-resource": "other", "x-ratelimit-limit": "500", "x-ratelimit-remaining": "497" }),
    ];
    const client = new GitHubClient("t", "rate-test", (async () => replies.shift()!) as unknown as typeof fetch);

    await client.request("GET", "/user");
    await client.request("GET", "/something-else");

    expect(getRateLimit("rate-test")).toMatchObject({ limit: 5000, remaining: 4990 });
    expect(getRateLimit("rate-test", "other")).toMatchObject({ limit: 500, remaining: 497 });
    expect(client.rateLimit?.limit).toBe(5000);
  });

  test("responses without a resource header count as core", async () => {
    const client = new GitHubClient(
      "t",
      "rate-test-2",
      (async () =>
        respond({
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "12",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600),
        })) as unknown as typeof fetch,
    );
    await client.request("GET", "/user");
    expect(getRateLimit("rate-test-2")?.remaining).toBe(12);
    expect(client.shouldBackOff()).toBe(true);
  });
});
