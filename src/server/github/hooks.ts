import type { GitHubClient, GitHubHook } from "./client";
import { GitHubError } from "./client";

export interface HookTarget {
  url: string;
  secret: string;
}

export interface HookResult {
  hookId: number | null;
  status: "active" | "missing" | "error" | "none";
  error: string | null;
  action: "created" | "repaired" | "unchanged" | "deleted" | "none";
}

function hookConfig(target: HookTarget) {
  return { url: target.url, content_type: "json", insecure_ssl: "0", secret: target.secret };
}

function needsRepair(hook: GitHubHook, target: HookTarget): boolean {
  return (
    !hook.active ||
    !hook.events.includes("star") ||
    hook.config.url !== target.url ||
    hook.config.content_type !== "json" ||
    hook.config.insecure_ssl === "1"
  );
}

function lastDeliveryFailed(hook: GitHubHook): string | null {
  const last = hook.last_response;
  if (!last || last.code === null || last.code === undefined) return null;
  if (last.code >= 200 && last.code < 300) return null;
  return `Last delivery failed: ${last.code} ${last.message ?? last.status ?? ""}`.trim();
}

/** Find our hook by stored id first (survives URL changes), then by URL. Extra copies are returned too. */
export function matchHooks(hooks: GitHubHook[], target: HookTarget, storedId: number | null) {
  const byId = storedId ? hooks.find((h) => h.id === storedId) : undefined;
  const byUrl = hooks.filter((h) => h.config.url === target.url);
  const primary = byId ?? byUrl[0];
  const duplicates = byUrl.filter((h) => h !== primary);
  return { primary, duplicates };
}

/** Create, repair or confirm the star webhook on a repository. */
export async function ensureHook(
  client: GitHubClient,
  fullName: string,
  target: HookTarget,
  storedId: number | null,
): Promise<HookResult> {
  try {
    const hooks = await client.listHooks(fullName);
    const { primary, duplicates } = matchHooks(hooks, target, storedId);

    for (const dup of duplicates) await client.deleteHook(fullName, dup.id);

    if (!primary) {
      const created = await client.createHook(fullName, {
        name: "web",
        active: true,
        events: ["star"],
        config: hookConfig(target),
      });
      return { hookId: created.id, status: "active", error: null, action: "created" };
    }

    const failure = lastDeliveryFailed(primary);
    if (needsRepair(primary, target) || failure) {
      // Re-sending the config also resets the secret, which GitHub never returns.
      await client.updateHook(fullName, primary.id, {
        active: true,
        events: ["star"],
        config: hookConfig(target),
      });
      return { hookId: primary.id, status: failure ? "error" : "active", error: failure, action: "repaired" };
    }

    return { hookId: primary.id, status: "active", error: null, action: "unchanged" };
  } catch (err) {
    return { hookId: storedId, status: "error", error: describeHookError(err), action: "none" };
  }
}

/** Remove our webhook(s) from a repository. */
export async function removeHook(
  client: GitHubClient,
  fullName: string,
  target: HookTarget,
  storedId: number | null,
): Promise<HookResult> {
  try {
    const hooks = await client.listHooks(fullName);
    const { primary, duplicates } = matchHooks(hooks, target, storedId);
    const toDelete = [primary, ...duplicates].filter((h): h is GitHubHook => Boolean(h));
    for (const hook of toDelete) await client.deleteHook(fullName, hook.id);
    return { hookId: null, status: "none", error: null, action: toDelete.length ? "deleted" : "none" };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return { hookId: null, status: "none", error: null, action: "none" };
    }
    return { hookId: storedId, status: "error", error: describeHookError(err), action: "none" };
  }
}

export function describeHookError(err: unknown): string {
  if (err instanceof GitHubError) {
    if (err.status === 404) return "Repository not found or token lacks admin:repo_hook scope";
    if (err.status === 403) return "Forbidden: token needs admin:repo_hook and admin access to the repository";
    if (err.status === 422) return `GitHub rejected the webhook: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
