import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { withLock } from "../lib/locks";
import { logger } from "../logger";

const log = logger.child("tunnel");
const LATEST_RELEASE_URL = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

export interface BinaryInfo {
  path: string;
  /** True when StarWatch downloaded it and keeps it updated, false for CLOUDFLARED_PATH. */
  managed: boolean;
  version: string | null;
}

export interface UpdateResult {
  version: string;
  updated: boolean;
}

/** Release asset for this platform, or null when Cloudflare does not publish one. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string | null {
  const goArch = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : arch === "arm" ? "arm" : null;
  if (!goArch) return null;
  if (platform === "linux") return `cloudflared-linux-${goArch}`;
  if (platform === "darwin" && goArch !== "arm") return `cloudflared-darwin-${goArch}.tgz`;
  return null;
}

/** "2026.10.7" > "2026.9.12", compared numerically per part. */
export function isNewerVersion(candidate: string, current: string | null): boolean {
  if (!current) return true;
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function binDir() {
  return path.join(getConfig().dataDir, "bin");
}

function managedPath() {
  return path.join(binDir(), "cloudflared");
}

function versionFile() {
  return path.join(binDir(), "cloudflared.version");
}

function customPath(): string | null {
  return process.env.CLOUDFLARED_PATH?.trim() || null;
}

const customVersions = new Map<string, string | null>();

function readCustomVersion(binary: string): string | null {
  if (customVersions.has(binary)) return customVersions.get(binary)!;
  let version: string | null = null;
  try {
    const out = Bun.spawnSync([binary, "--version"]).stdout.toString();
    version = out.match(/version (\S+)/)?.[1] ?? null;
  } catch {
    // missing or not executable, reported when the tunnel starts
  }
  customVersions.set(binary, version);
  return version;
}

/** Whether a binary can be used or downloaded on this machine. */
export function cloudflaredSupported(): boolean {
  return Boolean(customPath() || assetName());
}

export function getBinary(): BinaryInfo | null {
  const custom = customPath();
  if (custom) return { path: custom, managed: false, version: readCustomVersion(custom) };
  if (!existsSync(managedPath())) return null;
  const version = existsSync(versionFile()) ? readFileSync(versionFile(), "utf8").trim() || null : null;
  return { path: managedPath(), managed: true, version };
}

async function fetchLatestRelease(): Promise<{ version: string; asset: ReleaseAsset }> {
  const name = assetName();
  if (!name) throw new Error(`No cloudflared build for ${process.platform}/${process.arch}. Set CLOUDFLARED_PATH.`);
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "StarWatch" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Could not check cloudflared releases: GitHub returned ${res.status}`);
  const release = (await res.json()) as { tag_name: string; assets: ReleaseAsset[] };
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) throw new Error(`Release ${release.tag_name} has no ${name}`);
  return { version: release.tag_name.replace(/^v/, ""), asset };
}

async function install(version: string, asset: ReleaseAsset) {
  const expected = asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  if (!expected) throw new Error(`${asset.name} has no SHA-256 digest, refusing to install it`);

  log.info("downloading cloudflared", { version, asset: asset.name });
  const res = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "StarWatch" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Downloading ${asset.name} failed with HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) throw new Error(`${asset.name} failed the checksum check`);

  mkdirSync(binDir(), { recursive: true });
  const tmp = mkdtempSync(path.join(binDir(), ".download-"));
  try {
    const binary = path.join(tmp, "cloudflared");
    if (asset.name.endsWith(".tgz")) {
      const archive = path.join(tmp, asset.name);
      writeFileSync(archive, data);
      const tar = Bun.spawnSync(["tar", "-xzf", archive, "-C", tmp]);
      if (tar.exitCode !== 0 || !existsSync(binary)) throw new Error(`Could not extract ${asset.name}`);
    } else {
      writeFileSync(binary, data);
    }
    chmodSync(binary, 0o755);
    // Same directory, so the rename is atomic and a running tunnel keeps its old inode.
    renameSync(binary, managedPath());
    writeFileSync(versionFile(), version);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  log.info("cloudflared installed", { version });
}

/**
 * Download cloudflared if it is missing, or replace it when a newer release exists.
 * Does nothing for a CLOUDFLARED_PATH binary.
 */
export function ensureLatestBinary(): Promise<UpdateResult | null> {
  return withLock("cloudflared-binary", async () => {
    if (customPath()) return null;
    const current = getBinary();
    const { version, asset } = await fetchLatestRelease();
    if (current && !isNewerVersion(version, current.version)) return { version: current.version!, updated: false };
    await install(version, asset);
    return { version, updated: true };
  });
}
