import { describe, expect, test } from "bun:test";
import { signPayload, verifySignature } from "../src/server/github/signature";

describe("webhook signature verification", () => {
  test("matches GitHub's documented test vector", () => {
    const secret = "It's a Secret to Everybody";
    const header = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(signPayload(secret, "Hello, World!")).toBe(header);
    expect(verifySignature(secret, "Hello, World!", header)).toBe(true);
  });

  test("accepts a valid signature for a JSON body", () => {
    const body = JSON.stringify({ action: "created", sender: { login: "octocat" } });
    expect(verifySignature("s3cret", body, signPayload("s3cret", body))).toBe(true);
  });

  test("works with a binary body", () => {
    const body = new TextEncoder().encode('{"a":1}');
    expect(verifySignature("s3cret", body, signPayload("s3cret", '{"a":1}'))).toBe(true);
  });

  test("rejects a tampered body", () => {
    const header = signPayload("s3cret", '{"action":"created"}');
    expect(verifySignature("s3cret", '{"action":"deleted"}', header)).toBe(false);
  });

  test("rejects the wrong secret", () => {
    const body = "{}";
    expect(verifySignature("other", body, signPayload("s3cret", body))).toBe(false);
  });

  test("rejects missing, malformed or truncated headers", () => {
    const body = "{}";
    const valid = signPayload("s3cret", body);
    expect(verifySignature("s3cret", body, null)).toBe(false);
    expect(verifySignature("s3cret", body, "")).toBe(false);
    expect(verifySignature("s3cret", body, valid.replace("sha256=", "sha1="))).toBe(false);
    expect(verifySignature("s3cret", body, valid.slice(0, -2))).toBe(false);
  });

  test("rejects everything when no secret is configured", () => {
    expect(verifySignature("", "{}", signPayload("", "{}"))).toBe(false);
  });
});
