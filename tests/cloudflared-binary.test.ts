import { describe, expect, test } from "bun:test";
import { assetName, isNewerVersion } from "../src/server/services/cloudflared-binary";

describe("assetName", () => {
  test("maps linux and macOS builds", () => {
    expect(assetName("linux", "x64")).toBe("cloudflared-linux-amd64");
    expect(assetName("linux", "arm64")).toBe("cloudflared-linux-arm64");
    expect(assetName("linux", "arm")).toBe("cloudflared-linux-arm");
    expect(assetName("darwin", "arm64")).toBe("cloudflared-darwin-arm64.tgz");
  });

  test("returns null for unsupported platforms", () => {
    expect(assetName("win32", "x64")).toBeNull();
    expect(assetName("darwin", "arm")).toBeNull();
    expect(assetName("linux", "ia32")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  test("compares each part as a number", () => {
    expect(isNewerVersion("2026.10.7", "2026.9.12")).toBe(true);
    expect(isNewerVersion("2026.10.7", "2026.10.7")).toBe(false);
    expect(isNewerVersion("2026.10.2", "2026.10.7")).toBe(false);
    expect(isNewerVersion("2026.10.7.1", "2026.10.7")).toBe(true);
  });

  test("treats an unknown installed version as outdated", () => {
    expect(isNewerVersion("2026.10.7", null)).toBe(true);
  });
});
