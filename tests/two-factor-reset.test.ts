import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthedEnv, CurrentUser } from "../src/server/auth/middleware";
import { setDb } from "../src/server/db/client";
import { twoFactor, user, verification } from "../src/server/db/schema";
import { users } from "../src/server/routes/users";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;
const admin: CurrentUser = { id: "admin", name: "Admin", email: "admin@example.com", image: null, role: "admin" };
const app = new Hono<AuthedEnv>()
  .use("*", async (c, next) => {
    c.set("user", admin);
    await next();
  })
  .route("/users", users);

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  ctx.db
    .insert(user)
    .values([
      { id: "admin", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "u2", name: "Sam", email: "sam@example.com", role: "user", twoFactorEnabled: true },
    ])
    .run();
  ctx.db.insert(twoFactor).values({ id: "tf", userId: "u2", secret: "s", backupCodes: "c" }).run();
  const expiresAt = new Date(Date.now() + 60_000);
  ctx.db
    .insert(verification)
    .values([
      { id: "v1", identifier: "trust-device-abc", value: "u2", expiresAt },
      { id: "v2", identifier: "trust-device-def", value: "admin", expiresAt },
    ])
    .run();
});
afterEach(() => ctx.cleanup());

test("an admin can turn off another user's 2FA and trusted devices", async () => {
  const res = await app.request("/users/u2/two-factor/reset", { method: "POST" });
  expect(res.status).toBe(200);
  expect((await res.json()).twoFactorEnabled).toBe(false);
  expect(ctx.db.select().from(twoFactor).all()).toHaveLength(0);
  expect(ctx.db.select().from(verification).all().map((v) => v.id)).toEqual(["v2"]);
});

test("the user list shows who has 2FA", async () => {
  const body = await (await app.request("/users")).json();
  const sam = body.users.find((u: { id: string }) => u.id === "u2");
  expect(sam.twoFactorEnabled).toBe(true);
});
