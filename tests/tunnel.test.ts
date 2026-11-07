import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setConfig } from "../src/server/config";
import { setDb } from "../src/server/db/client";
import {
  getTunnelSettings,
  getWebhookUrl,
  normalizeTunnelHostname,
  setAppSetting,
  updateTunnelSettings,
} from "../src/server/services/settings";
import { parseCloudflaredLine } from "../src/server/services/tunnel";
import { createTestDb } from "./helpers";

describe("parseCloudflaredLine", () => {
  test("reads level and message", () => {
    const line = parseCloudflaredLine("2026-11-08T10:00:00Z WRN Retrying connection in 2s");
    expect(line).toMatchObject({ level: "warn", message: "Retrying connection in 2s", event: null });
  });

  test("detects registered and unregistered connections", () => {
    const up = "2026-11-08T10:00:00Z INF Registered tunnel connection connIndex=0 location=vie01 protocol=quic";
    expect(parseCloudflaredLine(up)?.event).toBe("connected");
    const down = "2026-11-08T10:00:00Z INF Unregistered tunnel connection connIndex=0";
    expect(parseCloudflaredLine(down)?.event).toBe("disconnected");
  });

  test("extracts the quick tunnel url from the banner", () => {
    const line = parseCloudflaredLine("2026-11-08T10:00:00Z INF |  https://brave-fox-42.trycloudflare.com      |");
    expect(line?.quickUrl).toBe("https://brave-fox-42.trycloudflare.com");
    expect(line?.message).toBe("https://brave-fox-42.trycloudflare.com");
  });

  test("ignores the quick tunnel api host in errors", () => {
    const line = parseCloudflaredLine(
      '2026-11-08T10:00:00Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel"',
    );
    expect(line).toMatchObject({ level: "error", quickUrl: null });
  });

  test("skips blank lines and keeps unformatted ones", () => {
    expect(parseCloudflaredLine("   ")).toBeNull();
    expect(parseCloudflaredLine("2026-11-08T10:00:00Z INF ")).toBeNull();
    expect(parseCloudflaredLine("2026-11-08T10:00:00Z INF +--------------------+")).toBeNull();
    expect(parseCloudflaredLine("plain output")).toMatchObject({ level: "info", message: "plain output" });
  });
});

describe("normalizeTunnelHostname", () => {
  test("accepts bare hosts and urls", () => {
    expect(normalizeTunnelHostname("Stars.Example.com")).toBe("stars.example.com");
    expect(normalizeTunnelHostname("https://stars.example.com/some/path")).toBe("stars.example.com");
  });

  test("rejects invalid hosts", () => {
    expect(normalizeTunnelHostname("")).toBeNull();
    expect(normalizeTunnelHostname("not a host")).toBeNull();
    expect(normalizeTunnelHostname("localhost")).toBeNull();
  });
});

describe("webhook url with a tunnel", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    ctx = createTestDb();
    setDb(ctx.db);
    setConfig({
      port: 4321,
      tunnelPort: 4322,
      baseUrl: "https://app.example.com",
      dataDir: "/tmp",
      dbPath: ctx.file,
      betterAuthSecret: "x".repeat(32),
      encryptionSecret: "a-test-secret-that-is-long-enough-123",
      allowRegistration: false,
      timezone: "UTC",
      github: null,
      isProduction: false,
    });
  });
  afterEach(() => ctx.cleanup());

  test("is off by default and uses BASE_URL", () => {
    expect(getTunnelSettings()).toMatchObject({ enabled: false, mode: "token" });
    expect(getWebhookUrl()).toBe("https://app.example.com/api/webhooks/github");
  });

  test("token mode uses the public hostname over the manual override", () => {
    setAppSetting("webhook_base_url", "https://override.example.com");
    updateTunnelSettings({ enabled: true, token: "eyJ0IjoiMSJ9", hostname: "stars.example.com" });
    expect(getWebhookUrl()).toBe("https://stars.example.com/api/webhooks/github");
    expect(getTunnelSettings().token).toBe("eyJ0IjoiMSJ9");
  });

  test("quick mode uses the last reported url, then falls back when disabled", () => {
    updateTunnelSettings({ enabled: true, mode: "quick" });
    expect(getWebhookUrl()).toBe("https://app.example.com/api/webhooks/github");
    updateTunnelSettings({ quickUrl: "https://brave-fox-42.trycloudflare.com" });
    expect(getWebhookUrl()).toBe("https://brave-fox-42.trycloudflare.com/api/webhooks/github");
    updateTunnelSettings({ enabled: false });
    expect(getWebhookUrl()).toBe("https://app.example.com/api/webhooks/github");
  });
});
