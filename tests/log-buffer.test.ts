import { describe, expect, test } from "bun:test";
import { LogBuffer, logBuffer } from "../src/server/log-buffer";
import { createLogger } from "../src/server/logger";

const entry = (level: "debug" | "info" | "warn" | "error", scope: string | null, msg: string, fields = {}) => ({
  time: new Date().toISOString(),
  level,
  scope,
  msg,
  fields,
});

describe("LogBuffer", () => {
  test("keeps only the newest entries up to its capacity", () => {
    const buffer = new LogBuffer(3);
    for (let i = 1; i <= 5; i++) buffer.push(entry("info", null, `m${i}`));
    expect(buffer.query().map((e) => e.msg)).toEqual(["m3", "m4", "m5"]);
    expect(buffer.lastId).toBe(5);
  });

  test("returns only entries after a given id", () => {
    const buffer = new LogBuffer(10);
    buffer.push(entry("info", null, "a"));
    const b = buffer.push(entry("info", null, "b"));
    buffer.push(entry("info", null, "c"));
    expect(buffer.query({ after: b.id }).map((e) => e.msg)).toEqual(["c"]);
  });

  test("filters by minimum level, scope and text", () => {
    const buffer = new LogBuffer(10);
    buffer.push(entry("debug", "sync", "noise"));
    buffer.push(entry("info", "sync", "sync complete", { repos: 3 }));
    buffer.push(entry("warn", "sync.hooks", "webhook problem", { repo: "o/aqua" }));
    buffer.push(entry("error", "delivery", "delivery failed"));

    expect(buffer.query({ minLevel: "warn" }).map((e) => e.msg)).toEqual(["webhook problem", "delivery failed"]);
    expect(buffer.query({ scope: "sync" }).map((e) => e.msg)).toEqual(["noise", "sync complete", "webhook problem"]);
    expect(buffer.query({ q: "AQUA" }).map((e) => e.msg)).toEqual(["webhook problem"]);
    expect(buffer.scopes()).toEqual(["delivery", "sync", "sync.hooks"]);
  });

  test("limit keeps the newest matches", () => {
    const buffer = new LogBuffer(10);
    for (let i = 1; i <= 5; i++) buffer.push(entry("info", null, `m${i}`));
    expect(buffer.query({ limit: 2 }).map((e) => e.msg)).toEqual(["m4", "m5"]);
  });
});

describe("logger", () => {
  test("writes into the shared buffer with scope and fields", () => {
    const before = logBuffer.lastId;
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    const out = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      createLogger("test").child("buffer").info("hello", { repo: "o/r" });
    } finally {
      process.stdout.write = out;
      process.env.LOG_LEVEL = prev;
    }
    const [logged] = logBuffer.query({ after: before });
    expect(logged).toMatchObject({ level: "info", scope: "test.buffer", msg: "hello", fields: { repo: "o/r" } });
  });
});
