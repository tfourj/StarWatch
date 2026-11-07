export interface ChangelogSection {
  title: string | null;
  items: string[];
  paragraphs: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

/**
 * Parses CHANGELOG.md ("## [1.0.0] - 2026-11-07", "### Added", "- item") into releases, newest first.
 * Only the small subset of Markdown the changelog uses is supported.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^## \[?v?([^\]\s]+)\]?(?:\s*-\s*(\S+))?/);
    if (heading) {
      release = { version: heading[1], date: heading[2] ?? null, sections: [] };
      section = { title: null, items: [], paragraphs: [] };
      release.sections.push(section);
      releases.push(release);
      continue;
    }
    if (!release) continue;
    const sub = line.match(/^### (.+)/);
    if (sub) {
      section = { title: sub[1].trim(), items: [], paragraphs: [] };
      release.sections.push(section);
    } else if (line.startsWith("- ")) {
      section!.items.push(line.slice(2).trim());
    } else if (line.trim()) {
      section!.paragraphs.push(line.trim());
    }
  }

  for (const r of releases) r.sections = r.sections.filter((s) => s.items.length || s.paragraphs.length);
  return releases;
}
