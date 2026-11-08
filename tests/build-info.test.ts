import { describe, expect, test } from "bun:test";
import { buildCommit } from "../src/server/lib/build-info";

const SHA = "3f05798c1a2b4d5e6f708192a3b4c5d6e7f80912";

/** Fake git that answers rev-parse with `head` and describe with `tag`. */
function git(head: string | null, tag: string | null = null) {
  return (args: string[]) => (args[0] === "rev-parse" ? head : tag);
}

describe("buildCommit", () => {
  test("shows the version for stable release images", () => {
    expect(buildCommit({ STARWATCH_RELEASE: "true", STARWATCH_COMMIT: SHA }, git(null), "1.2.3")).toBeNull();
  });

  test("shortens the commit from the environment", () => {
    expect(buildCommit({ STARWATCH_RELEASE: "false", STARWATCH_COMMIT: SHA }, git(null), "1.2.3")).toBe("3f05798");
  });

  test("falls back to the git HEAD", () => {
    expect(buildCommit({ STARWATCH_COMMIT: "" }, git("abc1234"), "1.2.3")).toBe("abc1234");
  });

  test("shows the version when HEAD is the stable tag", () => {
    expect(buildCommit({}, git("abc1234", "v1.2.3"), "1.2.3")).toBeNull();
  });

  test("shows the commit for pre-release tags and other tags", () => {
    expect(buildCommit({}, git("abc1234", "v1.3.0-rc.1"), "1.3.0-rc.1")).toBe("abc1234");
    expect(buildCommit({}, git("abc1234", "v1.2.2"), "1.2.3")).toBe("abc1234");
  });

  test("shows the version without a commit", () => {
    expect(buildCommit({}, git(null), "1.2.3")).toBeNull();
  });
});
