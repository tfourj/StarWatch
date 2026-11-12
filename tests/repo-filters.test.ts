import { describe, expect, test } from "bun:test";
import {
  NO_HIDDEN_KINDS,
  assignedChannels,
  hiddenCount,
  isVisible,
  matchesChannel,
  matchesMode,
  matchesQuery,
  matchesStatus,
  sortRepos,
} from "../web/src/lib/repo-filters";
import type { ChannelSummary, Repo } from "../web/src/lib/types";

function repo(fullName: string, extra: Partial<Repo> = {}): Repo {
  const [owner, name] = fullName.split("/");
  return {
    id: 1,
    githubId: 1,
    fullName,
    name,
    owner,
    htmlUrl: `https://github.com/${fullName}`,
    description: null,
    private: false,
    fork: false,
    archived: false,
    starCount: 0,
    monitored: true,
    mode: "webhook",
    hookId: null,
    hookStatus: "active",
    hookError: null,
    hookCheckedAt: null,
    lastDeliveryAt: null,
    backfilledAt: null,
    backfillError: null,
    importing: false,
    lastPolledAt: null,
    channelIds: [],
    ...extra,
  };
}

const names = (repos: Repo[]) => repos.map((r) => r.fullName);

describe("sortRepos", () => {
  const repos = [
    repo("o/beta", { starCount: 5 }),
    repo("o/Alpha", { starCount: 50 }),
    repo("o/gamma", { starCount: 5 }),
  ];

  test("sorts by name ignoring case", () => {
    expect(names(sortRepos(repos, "name"))).toEqual(["o/Alpha", "o/beta", "o/gamma"]);
  });

  test("sorts by stars descending with name as tie breaker", () => {
    expect(names(sortRepos(repos, "stars-desc"))).toEqual(["o/Alpha", "o/beta", "o/gamma"]);
  });

  test("sorts by stars ascending with name as tie breaker", () => {
    expect(names(sortRepos(repos, "stars-asc"))).toEqual(["o/beta", "o/gamma", "o/Alpha"]);
  });

  test("does not change the input", () => {
    sortRepos(repos, "stars-asc");
    expect(names(repos)).toEqual(["o/beta", "o/Alpha", "o/gamma"]);
  });
});

describe("filters", () => {
  test("matches the query against the full name", () => {
    expect(matchesQuery(repo("Owner/StarWatch"), " starw ")).toBe(true);
    expect(matchesQuery(repo("owner/other"), "starw")).toBe(false);
    expect(matchesQuery(repo("owner/other"), "  ")).toBe(true);
  });

  test("matches the mode", () => {
    expect(matchesMode(repo("o/r", { mode: "polling" }), "all")).toBe(true);
    expect(matchesMode(repo("o/r", { mode: "polling" }), "polling")).toBe(true);
    expect(matchesMode(repo("o/r", { mode: "both" }), "webhook")).toBe(false);
  });

  test("matches webhook status and problems", () => {
    const failing = repo("o/r", { hookStatus: "error" });
    const missing = repo("o/r", { hookStatus: "missing" });
    const importFailed = repo("o/r", { backfillError: "boom" });

    expect(matchesStatus(failing, "failing")).toBe(true);
    expect(matchesStatus(failing, "active")).toBe(false);
    expect(matchesStatus(missing, "missing")).toBe(true);
    expect(matchesStatus(repo("o/r"), "active")).toBe(true);
    expect(matchesStatus(failing, "problems")).toBe(true);
    expect(matchesStatus(importFailed, "problems")).toBe(true);
    expect(matchesStatus(missing, "problems")).toBe(false);
  });

  test("hides private, forks and archived repositories", () => {
    const hidden = { private: true, forks: true, archived: false };
    expect(isVisible(repo("o/r", { private: true }), hidden)).toBe(false);
    expect(isVisible(repo("o/r", { fork: true }), hidden)).toBe(false);
    expect(isVisible(repo("o/r", { archived: true }), hidden)).toBe(true);
    expect(isVisible(repo("o/r", { private: true }), NO_HIDDEN_KINDS)).toBe(true);
    expect(hiddenCount(hidden)).toBe(2);
  });

  describe("channels", () => {
    const channel = (id: number, allRepos = false): ChannelSummary => ({
      id,
      name: `channel ${id}`,
      type: "discord",
      allRepos,
      enabled: true,
    });
    const scoped = [channel(1), channel(2)];
    const withGlobal = [...scoped, channel(3, true)];

    test("lists assigned channels including global ones", () => {
      const r = repo("o/r", { channelIds: [2] });
      expect(assignedChannels(r, scoped).map((c) => c.id)).toEqual([2]);
      expect(assignedChannels(r, withGlobal).map((c) => c.id)).toEqual([2, 3]);
    });

    test("matches a specific channel", () => {
      expect(matchesChannel(repo("o/r", { channelIds: [1] }), 1, scoped)).toBe(true);
      expect(matchesChannel(repo("o/r", { channelIds: [1] }), 2, scoped)).toBe(false);
      expect(matchesChannel(repo("o/r"), 3, withGlobal)).toBe(true);
      expect(matchesChannel(repo("o/r"), "all", scoped)).toBe(true);
    });

    test("matches repositories without any channel", () => {
      expect(matchesChannel(repo("o/r"), "none", scoped)).toBe(true);
      expect(matchesChannel(repo("o/r", { channelIds: [1] }), "none", scoped)).toBe(false);
      expect(matchesChannel(repo("o/r"), "none", withGlobal)).toBe(false);
    });
  });
});
