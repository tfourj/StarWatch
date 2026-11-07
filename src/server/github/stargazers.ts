import type { GitHubStargazer } from "./client";

/** GitHub refuses stargazer pages beyond this (40,000 entries at 100 per page). */
export const MAX_STARGAZER_PAGES = 400;

export interface RemoteStargazer {
  id: number;
  login: string;
  avatarUrl: string | null;
  htmlUrl: string;
  starredAt: Date | null;
}

export interface KnownStargazer {
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
  starredAt: Date | null;
}

export interface StargazerDiff {
  added: RemoteStargazer[];
  removed: KnownStargazer[];
  /** True when the full stargazer list was compared, so `removed` is exact. */
  complete: boolean;
  pagesFetched: number;
}

export function toRemoteStargazer(entry: GitHubStargazer): RemoteStargazer {
  return {
    id: entry.user.id,
    login: entry.user.login,
    avatarUrl: entry.user.avatar_url ?? null,
    htmlUrl: entry.user.html_url ?? `https://github.com/${entry.user.login}`,
    starredAt: entry.starred_at ? new Date(entry.starred_at) : null,
  };
}

/**
 * Compare fetched stargazers with the stored ones. New stars are always reported.
 * Unstars are only reported when `complete` is true, because a partial list cannot
 * tell a missing entry from one on a page that was not fetched.
 */
export function diffStargazers(
  known: Map<number, KnownStargazer>,
  fetched: RemoteStargazer[],
  complete: boolean,
): Pick<StargazerDiff, "added" | "removed"> {
  const seen = new Set<number>();
  const added: RemoteStargazer[] = [];
  for (const entry of fetched) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (!known.has(entry.id)) added.push(entry);
  }
  added.sort((a, b) => (a.starredAt?.getTime() ?? 0) - (b.starredAt?.getTime() ?? 0));

  const removed = complete ? [...known.values()].filter((k) => !seen.has(k.githubUserId)) : [];
  return { added, removed };
}

export interface CollectOptions {
  known: Map<number, KnownStargazer>;
  /** Current stargazers_count reported by GitHub. */
  remoteCount: number;
  perPage?: number;
  fetchPage: (page: number) => Promise<RemoteStargazer[]>;
}

/**
 * Stargazers are listed oldest first, so new stars live on the last pages.
 * Walk backwards from the last page until a page contains only known stargazers.
 * If the counts then show that someone unstarred, fetch the remaining pages and do a full diff.
 */
export async function collectStargazerChanges(options: CollectOptions): Promise<StargazerDiff> {
  const { known, remoteCount, fetchPage } = options;
  const perPage = options.perPage ?? 100;
  const lastPage = Math.max(1, Math.ceil(remoteCount / perPage));
  const pages = new Map<number, RemoteStargazer[]>();

  let lowest = lastPage + 1;
  for (let page = lastPage; page >= 1; page--) {
    const items = await fetchPage(page);
    pages.set(page, items);
    lowest = page;
    if (items.length > 0 && items.every((s) => known.has(s.id))) break;
  }

  let complete = lowest === 1;
  const partial = flatten(pages);
  const { added } = diffStargazers(known, partial, false);
  const impliedRemovals = known.size + added.length - remoteCount;

  if (!complete && impliedRemovals > 0) {
    for (let page = lowest - 1; page >= 1; page--) pages.set(page, await fetchPage(page));
    complete = true;
  }

  const result = diffStargazers(known, flatten(pages), complete);
  return { ...result, complete, pagesFetched: pages.size };
}

function flatten(pages: Map<number, RemoteStargazer[]>): RemoteStargazer[] {
  return [...pages.entries()].sort(([a], [b]) => a - b).flatMap(([, items]) => items);
}
