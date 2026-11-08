import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthedEnv, CurrentUser } from "../src/server/auth/middleware";
import { setDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";
import { HttpError } from "../src/server/lib/http";
import { me } from "../src/server/routes/me";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;
let current: CurrentUser;
const sam: CurrentUser = { id: "sam", name: "Sam", email: "sam@example.com", image: null, role: "user" };
const alex: CurrentUser = { id: "alex", name: "Alex", email: "alex@example.com", image: null, role: "user" };
const app = new Hono<AuthedEnv>()
  .use("*", async (c, next) => {
    c.set("user", current);
    await next();
  })
  .route("/me", me)
  .onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({}, 500)));

const seen = async () => (await (await app.request("/me/seen-version")).json()).version;
const markSeen = (version: unknown) =>
  app.request("/me/seen-version", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version }),
  });

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  ctx.db
    .insert(user)
    .values([
      { id: "sam", name: "Sam", email: "sam@example.com" },
      { id: "alex", name: "Alex", email: "alex@example.com" },
    ])
    .run();
  current = sam;
});
afterEach(() => ctx.cleanup());

test("returns the signed-in user", async () => {
  expect((await (await app.request("/me")).json()).user.id).toBe("sam");
});

test("nothing is seen until the release notes are opened", async () => {
  expect(await seen()).toBeNull();
});

test("the seen version is stored per account", async () => {
  expect((await markSeen("1.2.0")).status).toBe(200);
  expect(await seen()).toBe("1.2.0");

  current = alex;
  expect(await seen()).toBeNull();
});

test("rejects a missing or invalid version", async () => {
  expect((await markSeen("")).status).toBe(400);
  expect((await markSeen(12)).status).toBe(400);
  expect((await markSeen("x".repeat(65))).status).toBe(400);
  expect(await seen()).toBeNull();
});
