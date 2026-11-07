import { parseChangelog } from "@shared/changelog";
import raw from "../../../CHANGELOG.md?raw";

export type { ChangelogRelease, ChangelogSection } from "@shared/changelog";

export const CHANGELOG = parseChangelog(raw);
