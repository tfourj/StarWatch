import { describe, expect, test } from "bun:test";
import { buildCommit } from "../src/server/lib/build-info";

const SHA = "3f05798c1a2b4d5e6f708192a3b4c5d6e7f80912";

/** Fake git that answers rev-parse with `head` and tag lookups with `tags`. */
function git(head: string | null, tags: string[] = []) {
  return (args: string[]) => (args[0] === "rev-parse" ? head : tags.join("\n") || null);
}

describe("buildCommit", () => {
  test("shows the version for stable release images", () => {
    expect(buildCommit({ STARWATCH_RELEASE: "true", STARWATCH_COMMIT: SHA }, git(null), "1.2.3")).toBeNull();
  });

  test("shortens the commit from the environment", () => {
    expect(buildCommit({ STARWATCH_RELEASE: "false", STARWATCH_COMMIT: SHA }, git(null), "1.2.3")).toBe("3f05798");
  });

  test("falls back to the git HEAD", () => {
    expect(buildCommit({ STARWATCH_COMMIT: "" }, git(SHA), "1.2.3")).toBe("3f05798");
  });

  test("shows the version when HEAD is the stable tag", () => {
    expect(buildCommit({}, git(SHA, ["v1.2.3"]), "1.2.3")).toBeNull();
  });

  test("shows the version when the commit from the environment is the stable tag", () => {
    const env = { STARWATCH_RELEASE: "false", STARWATCH_COMMIT: SHA };
    expect(buildCommit(env, git(null, ["v1.2.3"]), "1.2.3")).toBeNull();
  });

  test("finds the stable tag among other tags on the commit", () => {
    expect(buildCommit({}, git(SHA, ["deploy", "v1.2.3"]), "1.2.3")).toBeNull();
  });

  test("shows the commit for pre-release tags and other tags", () => {
    expect(buildCommit({}, git(SHA, ["v1.3.0-rc.1"]), "1.3.0-rc.1")).toBe("3f05798");
    expect(buildCommit({}, git(SHA, ["v1.2.2"]), "1.2.3")).toBe("3f05798");
  });

  test("shows the version without a commit", () => {
    expect(buildCommit({}, git(null), "1.2.3")).toBeNull();
  });
});
