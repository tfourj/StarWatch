import { describe, expect, test } from "bun:test";
import { buildAhead, buildCommit, parseDescribe } from "../src/server/lib/build-info";

const SHA = "3f05798c1a2b4d5e6f708192a3b4c5d6e7f80912";

/** Fake git that answers rev-parse with `head`, tag lookups with `tags` and describe with `describe`. */
function git(head: string | null, tags: string[] = [], describe: string | null = null) {
  return (args: string[]) => {
    if (args[0] === "rev-parse") return head;
    if (args[0] === "describe") return describe;
    return tags.join("\n") || null;
  };
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

describe("parseDescribe", () => {
  test("reads the release and commit count", () => {
    expect(parseDescribe("v1.1.0-5-g3f05798")).toEqual({ release: "1.1.0", commits: 5 });
  });

  test("ignores the release commit itself and other output", () => {
    expect(parseDescribe("v1.1.0-0-g3f05798")).toBeNull();
    expect(parseDescribe("3f05798")).toBeNull();
    expect(parseDescribe("")).toBeNull();
    expect(parseDescribe(null)).toBeNull();
  });
});

describe("buildAhead", () => {
  test("uses the describe output from the environment", () => {
    const env = { STARWATCH_COMMIT: SHA, STARWATCH_DESCRIBE: "v1.2.3-4-g3f05798" };
    expect(buildAhead(env, git(null), "1.2.4")).toEqual({ release: "1.2.3", commits: 4 });
  });

  test("describes the git HEAD", () => {
    expect(buildAhead({}, git(SHA, [], "v1.2.3-12-g3f05798"), "1.2.3")).toEqual({ release: "1.2.3", commits: 12 });
  });

  test("is null for stable releases", () => {
    const env = { STARWATCH_RELEASE: "true", STARWATCH_COMMIT: SHA, STARWATCH_DESCRIBE: "v1.2.3-4-g3f05798" };
    expect(buildAhead(env, git(null), "1.2.3")).toBeNull();
    expect(buildAhead({}, git(SHA, ["v1.2.3"], "v1.2.3-0-g3f05798"), "1.2.3")).toBeNull();
  });

  test("is null without a release tag before the commit", () => {
    expect(buildAhead({}, git(SHA), "1.2.3")).toBeNull();
  });
});
