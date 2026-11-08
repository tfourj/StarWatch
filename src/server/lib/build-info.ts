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
  if (env.STARWATCH_RELEASE === "true") return null;
  const commit = env.STARWATCH_COMMIT?.trim() || git(["rev-parse", "HEAD"]);
  if (!commit) return null;
  return isReleaseCommit(commit, git, version) ? null : commit.slice(0, 7);
}

export const COMMIT = buildCommit();
