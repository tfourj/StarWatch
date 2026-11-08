import { execFileSync } from "node:child_process";
import pkg from "../../../package.json";

/** From package.json, bundled into the server at build time. */
export const VERSION: string = pkg.version;

type Env = Record<string, string | undefined>;
type Git = (args: string[]) => string | null;

function runGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** True when `commit` carries the stable tag for this version. Pre-release versions never count. */
function isReleaseCommit(commit: string, git: Git, version: string): boolean {
  if (version.includes("-")) return false;
  const tags = git(["tag", "--points-at", commit]);
  return tags?.split("\n").some((tag) => tag.trim() === `v${version}`) ?? false;
}

/**
 * Short commit shown in place of the version for builds that are not a stable release, or null to show the version.
 * Images get STARWATCH_COMMIT and STARWATCH_RELEASE from CI. Without them, a git checkout uses its HEAD. Any build
 * whose commit carries the stable tag for this version shows the version, whatever branch or tag it was built from.
 */
export function buildCommit(env: Env = process.env, git: Git = runGit, version = VERSION): string | null {
  return unreleasedCommit(env, git, version)?.slice(0, 7) ?? null;
}

/** Full commit of a build that is not a stable release, or null. */
function unreleasedCommit(env: Env, git: Git, version: string): string | null {
  if (env.STARWATCH_RELEASE === "true") return null;
  const commit = env.STARWATCH_COMMIT?.trim() || git(["rev-parse", "HEAD"]);
  if (!commit) return null;
  return isReleaseCommit(commit, git, version) ? null : commit;
}

/** How far a build is past the newest stable release before it. */
export interface ReleaseDistance {
  /** Version of that release, without the leading "v". */
  release: string;
  commits: number;
}

/** Reads `git describe --long` output such as "v1.1.0-5-g3f05798". */
export function parseDescribe(describe: string | null | undefined): ReleaseDistance | null {
  const match = describe?.trim().match(/^v(\d[^\s-]*)-(\d+)-g[0-9a-f]+$/);
  if (!match) return null;
  const commits = Number(match[2]);
  return commits > 0 ? { release: match[1], commits } : null;
}

/**
 * Commits between the newest stable release tag and a build that is not a stable release, or null. Images get
 * STARWATCH_DESCRIBE from CI. Without it, a git checkout describes the build's commit.
 */
export function buildAhead(env: Env = process.env, git: Git = runGit, version = VERSION): ReleaseDistance | null {
  const commit = unreleasedCommit(env, git, version);
  if (!commit) return null;
  const describe =
    env.STARWATCH_DESCRIBE?.trim() ||
    git(["describe", "--tags", "--long", "--match", "v[0-9]*", "--exclude", "*-*", commit]);
  return parseDescribe(describe);
}

export const COMMIT = buildCommit();
export const AHEAD = buildAhead();
