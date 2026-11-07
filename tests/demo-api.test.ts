import { beforeEach, describe, expect, test } from "bun:test";
import { demoRequest, resetDemo, setDemoLatency } from "../web/src/demo/api";
import { generateDemoData } from "../src/shared/demo-data";

setDemoLatency(0);
beforeEach(() => resetDemo());

const get = <T = any>(path: string) => demoRequest<T>("GET", path);
const send = <T = any>(method: string, path: string, body: unknown = {}) => demoRequest<T>(method, path, body);

describe("demo data", () => {
  test("is deterministic for the same moment", () => {
    const now = Date.UTC(2026, 10, 7, 12);
    expect(JSON.stringify(generateDemoData(now))).toBe(JSON.stringify(generateDemoData(now)));
  });
});

describe("demo api", () => {
  test("starts signed in as the demo admin", async () => {
    expect((await get("/setup/status")).needsSetup).toBe(false);
    expect((await get("/me")).user.role).toBe("admin");
  });

  test("dashboard has stats, a 30 day chart and recent events", async () => {
    const d = await get("/dashboard");
    expect(d.stats.totalStars).toBeGreaterThan(4000);
    expect(d.stats.stars30d).toBeGreaterThan(0);
    expect(d.chart).toHaveLength(30);
    expect(d.recentEvents).toHaveLength(10);
    expect(typeof d.recentEvents[0].occurredAt).toBe("string");
  });

  test("monitoring changes stick until reset", async () => {
    const { repos } = await get("/repos");
    const blog = repos.find((r: any) => r.name === "blog");
    expect(blog.monitored).toBe(false);
    const updated = await send("PATCH", `/repos/${blog.id}`, { monitored: true, mode: "polling" });
    expect(updated).toMatchObject({ monitored: true, mode: "polling", hookStatus: "none" });
    expect(updated.backfilledAt).not.toBeNull();

    const result = await send("POST", "/repos/bulk", { monitored: false });
    expect(result.updated).toBe(7);
    expect((await get("/repos")).repos.every((r: any) => !r.monitored)).toBe(true);
  });

  test("events filter by action and delivery status", async () => {
    const unstars = await get("/events?action=deleted&pageSize=100");
    expect(unstars.total).toBeGreaterThan(0);
    expect(unstars.items.every((e: any) => e.action === "deleted")).toBe(true);

    const failed = await get("/events?status=failed");
    expect(failed.total).toBe(1);
    const delivery = failed.items[0].deliveries.find((d: any) => d.status === "failed");
    expect((await get(`/events/deliveries/${delivery.id}/attempts`)).attempts).toHaveLength(6);
    await send("POST", `/events/deliveries/${delivery.id}/retry`);
    expect((await get("/events?status=failed")).total).toBe(0);
  });

  test("channels hide secrets and validate frequency", async () => {
    const { channels } = await get("/channels");
    const discord = channels.find((c: any) => c.type === "discord");
    expect(discord.config.webhookUrl).toBeUndefined();
    expect(discord.secrets.webhookUrl).toMatch(/^••••/);

    await expect(
      send("POST", "/channels", {
        name: "Both",
        type: "ntfy",
        config: { topic: "t" },
        milestoneEvery: 10,
        frequencyTiers: [{ from: 0, every: 1 }],
      }),
    ).rejects.toThrow("not both");

    const created = await send("POST", "/channels", { name: "Mine", type: "ntfy", config: { topic: "t" } });
    expect(created.config.serverUrl).toBe("https://ntfy.sh");
  });

  test("anything that needs GitHub or sends notifications explains it is a demo", async () => {
    await expect(send("POST", "/repos/sync")).rejects.toThrow("not available in the demo");
    await expect(send("POST", "/channels/1/test")).rejects.toThrow("not available in the demo");
    await expect(send("PUT", "/settings/github-token", { token: "x" })).rejects.toThrow("not available in the demo");
  });

  test("logs support filters", async () => {
    const warnings = await get("/logs?level=warn");
    expect(warnings.entries.length).toBeGreaterThan(0);
    expect(warnings.entries.every((e: any) => e.level === "warn" || e.level === "error")).toBe(true);
  });

  test("unknown routes are 404", async () => {
    await expect(get("/nope")).rejects.toMatchObject({ status: 404 });
  });
});
