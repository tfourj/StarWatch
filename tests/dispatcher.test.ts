import { describe, expect, test } from "bun:test";
import { channelMatches } from "../src/server/notifications/dispatcher";
import { backoffMs } from "../src/server/notifications/worker";

const channel = {
  enabled: true,
  allRepos: true,
  notifyStar: true,
  notifyUnstar: true,
  milestoneEvery: null as number | null,
};

describe("channel filters", () => {
  test("matches stars and unstars by default", () => {
    expect(channelMatches(channel, { action: "created", starCount: 5 }, false)).toBe(true);
    expect(channelMatches(channel, { action: "deleted", starCount: 4 }, false)).toBe(true);
  });

  test("respects enabled, event type and repo assignment", () => {
    expect(channelMatches({ ...channel, enabled: false }, { action: "created", starCount: 5 }, false)).toBe(false);
    expect(channelMatches({ ...channel, notifyUnstar: false }, { action: "deleted", starCount: 4 }, false)).toBe(false);
    expect(channelMatches({ ...channel, allRepos: false }, { action: "created", starCount: 5 }, false)).toBe(false);
    expect(channelMatches({ ...channel, allRepos: false }, { action: "created", starCount: 5 }, true)).toBe(true);
  });

  test("milestone mode only fires on multiples and never on unstars", () => {
    const m = { ...channel, milestoneEvery: 100 };
    expect(channelMatches(m, { action: "created", starCount: 99 }, false)).toBe(false);
    expect(channelMatches(m, { action: "created", starCount: 100 }, false)).toBe(true);
    expect(channelMatches(m, { action: "created", starCount: 200 }, false)).toBe(true);
    expect(channelMatches(m, { action: "deleted", starCount: 100 }, false)).toBe(false);
  });
});

describe("retry backoff", () => {
  test("doubles from 30 seconds and caps at one hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(5)).toBe(480_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
