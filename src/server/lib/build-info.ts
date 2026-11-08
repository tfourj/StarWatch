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

/**
 * Short commit shown in place of the version for builds that are not a stable release, or null to show the version.
 * Images get STARWATCH_COMMIT and STARWATCH_RELEASE from CI. Without them, a git checkout uses its HEAD, unless HEAD
 * is the stable tag for this version.
 */
export function buildCommit(env: Env = process.env, git: Git = runGit, version = VERSION): string | null {
  if (env.STARWATCH_RELEASE === "true") return null;
  const fromEnv = env.STARWATCH_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);

  const head = git(["rev-parse", "--short=7", "HEAD"]);
  if (!head) return null;
  const isStableTag = !version.includes("-") && git(["describe", "--tags", "--exact-match", "HEAD"]) === `v${version}`;
  return isStableTag ? null : head;
}

export const COMMIT = buildCommit();
