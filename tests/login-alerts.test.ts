import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createAuth } from "../src/server/auth/auth";
import { signInMethod } from "../src/server/auth/login-alerts";
import { registerUser } from "../src/server/auth/registration";
import { setConfig, type AppConfig } from "../src/server/config";
import { setDb } from "../src/server/db/client";
import { channels, user } from "../src/server/db/schema";
import { cipher } from "../src/server/lib/crypto";
import { registerProvider } from "../src/server/notifications/providers";
import { discord } from "../src/server/notifications/providers/discord";
import { webhook } from "../src/server/notifications/providers/webhook";
import type { NotificationMessage } from "../src/server/notifications/types";
import {
  buildLoginMessage,
  getLoginAlertChannelIds,
  loginAlertRetry,
  sendLoginAlerts,
  setLoginAlertChannelIds,
} from "../src/server/services/login-alerts";
import { createTestDb } from "./helpers";

const PASSWORD = "password123";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537";

let ctx: ReturnType<typeof createTestDb>;
let config: AppConfig;
let sent: NotificationMessage[] = [];
let failNext = 0;

registerProvider({
  type: "fake",
  async send(_config, message) {
    if (failNext > 0) {
      failNext--;
      throw new Error("boom");
    }
    sent.push(message);
  },
});

function addChannel(userId: string, name: string, enabled = true) {
  return ctx.db
    .insert(channels)
    .values({ userId, name, type: "fake", config: cipher().encryptJson({}), enabled })
    .returning()
    .get().id;
}

async function addUser(n: number) {
  const created = await registerUser(
    ctx.db,
    { name: `User ${n}`, email: `user${n}@example.com`, password: PASSWORD },
    { allowRegistration: true },
  );
  return created.id;
}

/** The hook sends in the background; wait until it has finished. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => {
  ctx = createTestDb();
  setDb(ctx.db);
  config = {
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
  };
  setConfig(config);
  sent = [];
  failNext = 0;
  loginAlertRetry.delaysMs = [0, 0];
});
afterEach(() => ctx.cleanup());

describe("sign-in methods", () => {
  test("maps auth paths to a readable method", () => {
    expect(signInMethod("/sign-in/email", false)).toBe("Password");
    expect(signInMethod("/sign-in/email", true)).toBe("Password on a trusted device");
    expect(signInMethod("/two-factor/verify-totp", true)).toBe("Password and authenticator app");
    expect(signInMethod("/two-factor/verify-backup-code", true)).toBe("Password and backup code");
    expect(signInMethod("/callback/:id", false, "github")).toBe("GitHub");
    expect(signInMethod("/change-password", false)).toBeNull();
    expect(signInMethod("/two-factor/enable", false)).toBeNull();
  });
});

describe("channel selection", () => {
  test("keeps only the user's own channels and forgets deleted ones", async () => {
    const me = await addUser(1);
    const other = await addUser(2);
    const mine = addChannel(me, "Mine");
    const theirs = addChannel(other, "Theirs");
    expect(setLoginAlertChannelIds(me, [mine, theirs, 999])).toEqual([mine]);
    expect(getLoginAlertChannelIds(me)).toEqual([mine]);
    ctx.db.delete(channels).run();
    expect(getLoginAlertChannelIds(me)).toEqual([]);
  });
});

describe("login alert message", () => {
  test("lists the method, device, IP and a link to security settings", () => {
    const at = new Date(Date.UTC(2026, 10, 8, 14, 5));
    const details = {
      name: "Ada",
      email: "ada@example.com",
      method: "Password",
      ip: "203.0.113.7",
      device: "Chrome on macOS",
      userAgent: UA,
    };
    const msg = buildLoginMessage(details, at);
    expect(msg.title).toBe("New sign-in to StarWatch");
    expect(msg.body).toContain("Ada (ada@example.com) signed in");
    expect(msg.body).toContain("Device: Chrome on macOS");
    expect(msg.body).toContain("IP address: 203.0.113.7");
    expect(msg.link.url).toBe("https://stars.example.com/settings?tab=security");
    expect(buildLoginMessage(details, at, true).title).toBe("[Test] New sign-in to StarWatch");
  });

  describe("providers", () => {
    const realFetch = globalThis.fetch;
    let bodies: unknown[] = [];
    beforeEach(() => {
      bodies = [];
      globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    const msg = () =>
      buildLoginMessage(
        { name: "Ada", email: "ada@example.com", method: "Password", ip: null, device: "curl/8", userAgent: "curl/8" },
        new Date(),
      );

    test("discord drops the stargazer author and star footer", async () => {
      await discord.send({ webhookUrl: "https://discord.test/hook" }, msg());
      const embed = (bodies[0] as { embeds: Record<string, unknown>[] }).embeds[0]!;
      expect(embed.url).toBe("https://stars.example.com/settings?tab=security");
      expect(embed.footer).toBeUndefined();
      expect(embed.author).toBeUndefined();
    });

    test("the JSON webhook sends a login event", async () => {
      await webhook.send({ url: "https://hooks.test/in" }, msg());
      expect(bodies[0]).toMatchObject({
        event: "login",
        account: { name: "Ada", email: "ada@example.com" },
        login: { method: "Password", ip: null, device: "curl/8" },
      });
      expect(bodies[0]).not.toHaveProperty("repository");
    });
  });
});

describe("sending", () => {
  test("skips disabled channels and retries failures", async () => {
    const me = await addUser(1);
    const on = addChannel(me, "On");
    const off = addChannel(me, "Off", false);
    setLoginAlertChannelIds(me, [on, off]);
    failNext = 1;
    const results = await sendLoginAlerts({ userId: me, method: "Password", ip: null, userAgent: UA, at: new Date() });
    expect(results).toEqual([{ channelId: on, name: "On", ok: true, error: null }]);
    expect(sent).toHaveLength(1);
  });

  test("test sends try once and report the error", async () => {
    const me = await addUser(1);
    const on = addChannel(me, "On");
    failNext = 1;
    const at = new Date();
    const results = await sendLoginAlerts(
      { userId: me, method: "Password", ip: null, userAgent: UA, at },
      { test: true, channelIds: [on] },
    );
    expect(results).toEqual([{ channelId: on, name: "On", ok: false, error: "boom" }]);
  });
});

describe("sign-in hook", () => {
  const headers = (cookie?: string) =>
    new Headers({ "user-agent": UA, "x-forwarded-for": "203.0.113.7", ...(cookie ? { cookie } : {}) });
  const cookiesOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

  test("alerts on password sign-in with the device and IP", async () => {
    const auth = createAuth(ctx.db, config);
    const me = await addUser(1);
    setLoginAlertChannelIds(me, [addChannel(me, "Alerts")]);

    await auth.api.signInEmail({ body: { email: "user1@example.com", password: PASSWORD }, headers: headers() });
    await settle();

    expect(sent).toHaveLength(1);
    const msg = sent[0]!;
    expect(msg.kind).toBe("login");
    if (msg.kind !== "login") return;
    expect(msg.login).toMatchObject({ method: "Password", ip: "203.0.113.7", device: "Chrome on macOS" });
  });

  test("stays quiet without selected channels and for wrong passwords", async () => {
    const auth = createAuth(ctx.db, config);
    const me = await addUser(1);
    addChannel(me, "Not selected");
    await auth.api.signInEmail({ body: { email: "user1@example.com", password: PASSWORD }, headers: headers() });
    setLoginAlertChannelIds(me, [addChannel(me, "Alerts")]);
    await auth.api
      .signInEmail({ body: { email: "user1@example.com", password: "wrong-password" }, headers: headers() })
      .catch(() => null);
    await settle();
    expect(sent).toHaveLength(0);
  });

  test("with 2FA, alerts once after the code and not while setting it up", async () => {
    const auth = createAuth(ctx.db, config);
    const me = await addUser(1);

    const first = await auth.api.signInEmail({
      body: { email: "user1@example.com", password: PASSWORD },
      headers: headers(),
      asResponse: true,
    });
    const session = cookiesOf(first);
    setLoginAlertChannelIds(me, [addChannel(me, "Alerts")]);

    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: headers(session) });
    if (!("totpURI" in enabled)) throw new Error("expected a TOTP setup");
    const secret = new TextDecoder().decode(base32.decode(new URL(enabled.totpURI).searchParams.get("secret")!));
    const code = () => createOTP(secret).totp();
    await auth.api.verifyTOTP({ body: { code: await code() }, headers: headers(session) });
    await settle();
    expect(sent).toHaveLength(0);
    expect(ctx.db.select().from(user).get()?.twoFactorEnabled).toBe(true);

    const pending = await auth.api.signInEmail({
      body: { email: "user1@example.com", password: PASSWORD },
      headers: headers(),
      asResponse: true,
    });
    expect(await pending.clone().json()).toMatchObject({ twoFactorRedirect: true });
    await settle();
    expect(sent).toHaveLength(0);

    await auth.api.verifyTOTP({ body: { code: await code() }, headers: headers(cookiesOf(pending)) });
    await settle();
    expect(sent).toHaveLength(1);
    const msg = sent[0]!;
    if (msg.kind !== "login") throw new Error("expected a login alert");
    expect(msg.login.method).toBe("Password and authenticator app");

    const again = await auth.api.signInEmail({
      body: { email: "user1@example.com", password: PASSWORD },
      headers: headers(),
      asResponse: true,
    });
    await auth.api.verifyBackupCode({
      body: { code: enabled.backupCodes[0]! },
      headers: headers(cookiesOf(again)),
    });
    await settle();
    expect(sent).toHaveLength(2);
    const backup = sent[1]!;
    if (backup.kind !== "login") throw new Error("expected a login alert");
    expect(backup.login.method).toBe("Password and backup code");
  });
});
