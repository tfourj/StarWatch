import { describe, expect, test } from "bun:test";
import { describeUserAgent } from "../src/server/lib/user-agent";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const WIN_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 " +
  "Edg/131.0.0.0";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 " +
  "Mobile/15E148 Safari/604.1";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";

describe("describeUserAgent", () => {
  test("names the browser and operating system", () => {
    expect(describeUserAgent(MAC_CHROME)).toBe("Chrome on macOS");
    expect(describeUserAgent(MAC_SAFARI)).toBe("Safari on macOS");
    expect(describeUserAgent(WIN_EDGE)).toBe("Edge on Windows");
    expect(describeUserAgent(IPHONE_SAFARI)).toBe("Safari on iOS");
    expect(describeUserAgent(ANDROID_FIREFOX)).toBe("Firefox on Android");
    expect(describeUserAgent(LINUX_FIREFOX)).toBe("Firefox on Linux");
  });

  test("keeps the first token of scripts and handles missing values", () => {
    expect(describeUserAgent("curl/8.7.1")).toBe("curl/8.7.1");
    expect(describeUserAgent("")).toBe("Unknown device");
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
});
