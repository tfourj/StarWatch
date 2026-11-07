import { describe, expect, test } from "bun:test";
import { parseChangelog } from "../src/shared/changelog";

describe("parseChangelog", () => {
  test("parses releases, sections and items", () => {
    const releases = parseChangelog(`# Changelog

Intro text is ignored.

## [1.1.0] - 2026-12-01

### Added

- Dynamic frequency
- \`{time}\` variable

### Fixed

- Something

## [1.0.0] - 2026-11-07

First release.
`);
    expect(releases.map((r) => r.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(releases[0].date).toBe("2026-12-01");
    expect(releases[0].sections.map((s) => s.title)).toEqual(["Added", "Fixed"]);
    expect(releases[0].sections[0].items).toEqual(["Dynamic frequency", "`{time}` variable"]);
    expect(releases[1].sections).toEqual([{ title: null, items: [], paragraphs: ["First release."] }]);
  });

  test("the real changelog has the current package version on top", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    const releases = parseChangelog(await Bun.file(new URL("../CHANGELOG.md", import.meta.url)).text());
    expect(releases[0].version).toBe(pkg.version);
  });
});
