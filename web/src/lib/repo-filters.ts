import type { ChannelSummary, Repo, RepoMode } from "@/lib/types";

export type RepoSort = "name" | "stars-desc" | "stars-asc";
export type ModeFilter = "all" | RepoMode;
export type StatusFilter = "all" | "problems" | "active" | "failing" | "missing";
/** A channel id, or repositories that send to no channel at all. */
export type ChannelFilter = "all" | "none" | number;

/** Kinds of repositories that can be hidden from a list. */
export interface HiddenKinds {
  private: boolean;
  forks: boolean;
  archived: boolean;
}

export const NO_HIDDEN_KINDS: HiddenKinds = { private: false, forks: false, archived: false };

export const SORT_OPTIONS: { value: RepoSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "stars-desc", label: "Most stars" },
  { value: "stars-asc", label: "Fewest stars" },
];

export const MODE_FILTER_OPTIONS: { value: ModeFilter; label: string }[] = [
  { value: "all", label: "All modes" },
  { value: "webhook", label: "Webhook" },
  { value: "polling", label: "Polling" },
  { value: "both", label: "Both" },
];

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "problems", label: "With problems" },
  { value: "active", label: "Webhook active" },
  { value: "failing", label: "Webhook failing" },
  { value: "missing", label: "Webhook missing" },
];

export function matchesQuery(repo: Repo, query: string) {
  const q = query.trim().toLowerCase();
  return !q || repo.fullName.toLowerCase().includes(q);
}

export function matchesMode(repo: Repo, mode: ModeFilter) {
  return mode === "all" || repo.mode === mode;
}

export function matchesStatus(repo: Repo, status: StatusFilter) {
  switch (status) {
    case "all":
      return true;
    case "problems":
      return repo.hookStatus === "error" || Boolean(repo.backfillError);
    case "active":
      return repo.hookStatus === "active";
    case "failing":
      return repo.hookStatus === "error";
    case "missing":
      return repo.hookStatus === "missing";
  }
}

/** Channels a repository sends to, including channels that cover all repositories. */
export function assignedChannels(repo: Repo, channels: ChannelSummary[]) {
  return channels.filter((c) => c.allRepos || repo.channelIds.includes(c.id));
}

export function matchesChannel(repo: Repo, filter: ChannelFilter, channels: ChannelSummary[]) {
  if (filter === "all") return true;
  const assigned = assignedChannels(repo, channels);
  if (filter === "none") return assigned.length === 0;
  return assigned.some((c) => c.id === filter);
}

export function isVisible(repo: Repo, hidden: HiddenKinds) {
  if (hidden.private && repo.private) return false;
  if (hidden.forks && repo.fork) return false;
  if (hidden.archived && repo.archived) return false;
  return true;
}

export function hiddenCount(hidden: HiddenKinds) {
  return Object.values(hidden).filter(Boolean).length;
}

const byName = (a: Repo, b: Repo) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });

/** A sorted copy of `repos`. Ties on star count fall back to the name. */
export function sortRepos(repos: Repo[], sort: RepoSort) {
  const sorted = [...repos];
  if (sort === "name") return sorted.sort(byName);
  const dir = sort === "stars-desc" ? -1 : 1;
  return sorted.sort((a, b) => (a.starCount - b.starCount) * dir || byName(a, b));
}
