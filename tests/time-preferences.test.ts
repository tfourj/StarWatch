import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthedEnv, CurrentUser } from "../src/server/auth/middleware";
import { setConfig, type AppConfig } from "../src/server/config";
import { setDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";
import { HttpError } from "../src/server/lib/http";
import { me } from "../src/server/routes/me";
import { getUserTimeFormat, updateUserSettings } from "../src/server/services/settings";
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

const prefs = async () => (await app.request("/me/preferences")).json();
const save = (body: unknown) =>
  app.request("/me/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  setConfig({ timezone: "Europe/Berlin" } as AppConfig);
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

test("defaults to the server timezone, the locale hour format and relative times", async () => {
  expect(await prefs()).toEqual({
    timezone: null,
    timeFormat: "auto",
    timeStyle: "relative",
    serverTimezone: "Europe/Berlin",
  });
  expect(getUserTimeFormat("sam")).toEqual({ timeZone: "Europe/Berlin", timeFormat: "auto" });
});

test("stores preferences per account", async () => {
  const res = await save({ timezone: "America/New_York", timeFormat: "12h", timeStyle: "absolute" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ timezone: "America/New_York", timeFormat: "12h", timeStyle: "absolute" });
  expect(getUserTimeFormat("sam")).toEqual({ timeZone: "America/New_York", timeFormat: "12h" });

  current = alex;
  expect((await prefs()).timezone).toBeNull();
});

test("a null timezone goes back to the server timezone", async () => {
  await save({ timezone: "Asia/Tokyo" });
  await save({ timezone: null });
  expect((await prefs()).timezone).toBeNull();
  expect(getUserTimeFormat("sam").timeZone).toBe("Europe/Berlin");
});

test("only changes the fields that are sent", async () => {
  await save({ timezone: "Asia/Tokyo", timeFormat: "24h" });
  await save({ timeStyle: "absolute" });
  expect(await prefs()).toMatchObject({ timezone: "Asia/Tokyo", timeFormat: "24h", timeStyle: "absolute" });
});

test("rejects unknown values", async () => {
  expect((await save({ timezone: "Mars/Olympus" })).status).toBe(400);
  expect((await save({ timezone: "" })).status).toBe(400);
  expect((await save({ timezone: 5 })).status).toBe(400);
  expect((await save({ timeFormat: "36h" })).status).toBe(400);
  expect((await save({ timeStyle: "fuzzy" })).status).toBe(400);
  expect(await prefs()).toMatchObject({ timezone: null, timeFormat: "auto", timeStyle: "relative" });
});

test("a stored timezone the runtime no longer knows falls back to the server timezone", () => {
  updateUserSettings("sam", { timezone: "Mars/Olympus" });
  expect(getUserTimeFormat("sam").timeZone).toBe("Europe/Berlin");
});
