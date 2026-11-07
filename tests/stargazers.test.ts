import { describe, expect, test } from "bun:test";
import {
  collectStargazerChanges,
  diffStargazers,
  type KnownStargazer,
  type RemoteStargazer,
} from "../src/server/github/stargazers";

const remote = (id: number, day = id): RemoteStargazer => ({
  id,
  login: `user${id}`,
  avatarUrl: null,
  htmlUrl: `https://github.com/user${id}`,
  starredAt: new Date(Date.UTC(2026, 0, day)),
});

const knownMap = (ids: number[]) =>
  new Map<number, KnownStargazer>(
    ids.map((id) => [id, { githubUserId: id, login: `user${id}`, avatarUrl: null, starredAt: null }]),
  );

/** Simulates GitHub's oldest-first stargazer pagination and records requested pages. */
function pager(ids: number[], perPage: number) {
  const requested: number[] = [];
  const list = ids.map((id) => remote(id));
  return {
    requested,
    fetchPage: async (page: number) => {
      requested.push(page);
      return list.slice((page - 1) * perPage, page * perPage);
    },
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("diffStargazers", () => {
  test("finds new stargazers sorted by starred_at", () => {
    const { added, removed } = diffStargazers(knownMap([1, 2]), [remote(1), remote(4, 9), remote(3, 5)], false);
    expect(added.map((s) => s.id)).toEqual([3, 4]);
    expect(removed).toEqual([]);
  });

  test("only reports removals when the list is complete", () => {
    const known = knownMap([1, 2, 3]);
    expect(diffStargazers(known, [remote(1), remote(3)], false).removed).toEqual([]);
    expect(diffStargazers(known, [remote(1), remote(3)], true).removed.map((s) => s.githubUserId)).toEqual([2]);
  });

  test("ignores duplicate entries across overlapping pages", () => {
    const { added } = diffStargazers(knownMap([]), [remote(5), remote(5)], true);
    expect(added).toHaveLength(1);
  });
});

describe("collectStargazerChanges", () => {
  test("new stars only need the last page", async () => {
    const all = range(1, 25);
    const p = pager(all, 10);
    const result = await collectStargazerChanges({
      known: knownMap(range(1, 23)),
      remoteCount: 25,
      perPage: 10,
      fetchPage: p.fetchPage,
    });
    expect(result.added.map((s) => s.id)).toEqual([24, 25]);
    expect(result.removed).toEqual([]);
    // Page 3 has 21..25 with new entries, page 2 is fully known so the walk stops.
    expect(p.requested).toEqual([3, 2]);
    expect(result.complete).toBe(false);
  });

  test("walks back further when many stars arrived", async () => {
    const p = pager(range(1, 40), 10);
    const result = await collectStargazerChanges({
      known: knownMap(range(1, 15)),
      remoteCount: 40,
      perPage: 10,
      fetchPage: p.fetchPage,
    });
    expect(result.added.map((s) => s.id)).toEqual(range(16, 40));
    expect(p.requested).toEqual([4, 3, 2, 1]);
  });

  test("an unstar triggers a full fetch and is detected", async () => {
    // user7 unstarred, user31 starred: count stays 30 but the set changed.
    const current = [...range(1, 30).filter((id) => id !== 7), 31];
    const p = pager(current, 10);
    const result = await collectStargazerChanges({
      known: knownMap(range(1, 30)),
      remoteCount: 30,
      perPage: 10,
      fetchPage: p.fetchPage,
    });
    expect(result.added.map((s) => s.id)).toEqual([31]);
    expect(result.removed.map((s) => s.githubUserId)).toEqual([7]);
    expect(result.complete).toBe(true);
    expect([...p.requested].sort()).toEqual([1, 2, 3]);
  });

  test("pure unstar with a lower count", async () => {
    const current = range(1, 20).filter((id) => id !== 12 && id !== 3);
    const p = pager(current, 10);
    const result = await collectStargazerChanges({
      known: knownMap(range(1, 20)),
      remoteCount: 18,
      perPage: 10,
      fetchPage: p.fetchPage,
    });
    expect(result.added).toEqual([]);
    expect(result.removed.map((s) => s.githubUserId).sort((a, b) => a - b)).toEqual([3, 12]);
  });

  test("everyone unstarred", async () => {
    const p = pager([], 10);
    const result = await collectStargazerChanges({
      known: knownMap([1, 2]),
      remoteCount: 0,
      perPage: 10,
      fetchPage: p.fetchPage,
    });
    expect(result.removed).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  test("first poll of an empty repository", async () => {
    const p = pager([1, 2, 3], 100);
    const result = await collectStargazerChanges({
      known: knownMap([]),
      remoteCount: 3,
      fetchPage: p.fetchPage,
    });
    expect(result.added.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(p.requested).toEqual([1]);
  });
});
