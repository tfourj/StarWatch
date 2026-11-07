import { describe, expect, test } from "bun:test";
import { createCipher, hint } from "../src/server/lib/crypto";

describe("AES-GCM encryption", () => {
  const cipher = createCipher("a-test-secret-that-is-long-enough-123");

  test("round-trips strings and JSON", () => {
    expect(cipher.decrypt(cipher.encrypt("ghp_secret"))).toBe("ghp_secret");
    expect(cipher.decryptJson(cipher.encryptJson({ a: 1, b: "x" }))).toEqual({ a: 1, b: "x" });
  });

  test("uses a fresh IV each time", () => {
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  test("detects tampering", () => {
    const parts = cipher.encrypt("ghp_secret").split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    parts[3] = ct.toString("base64url");
    expect(() => cipher.decrypt(parts.join("."))).toThrow();
  });

  test("a different key cannot decrypt", () => {
    const other = createCipher("another-secret-that-is-long-enough-456");
    expect(() => other.decrypt(cipher.encrypt("ghp_secret"))).toThrow();
  });

  test("hint only shows the last four characters", () => {
    expect(hint("ghp_abcdefgh1234")).toBe("••••1234");
    expect(hint("abc")).toBe("••••");
  });
});
