import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FREQUENCY_TIERS,
  frequencyFor,
  notifiesAt,
  validateFrequencyTiers,
} from "../src/shared/frequency";
import { channelMatches } from "../src/server/notifications/dispatcher";

const announced = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((n) => notifiesAt(n, DEFAULT_FREQUENCY_TIERS));

describe("dynamic frequency", () => {
  test("default tiers match the documented table", () => {
    expect(frequencyFor(1, DEFAULT_FREQUENCY_TIERS)).toBe(1);
    expect(frequencyFor(99, DEFAULT_FREQUENCY_TIERS)).toBe(1);
    expect(frequencyFor(100, DEFAULT_FREQUENCY_TIERS)).toBe(5);
    expect(frequencyFor(199, DEFAULT_FREQUENCY_TIERS)).toBe(5);
    expect(frequencyFor(200, DEFAULT_FREQUENCY_TIERS)).toBe(10);
    expect(frequencyFor(500, DEFAULT_FREQUENCY_TIERS)).toBe(20);
    expect(frequencyFor(12_345, DEFAULT_FREQUENCY_TIERS)).toBe(20);
  });

  test("announces every star below 100, then fewer", () => {
    expect(announced(97, 101)).toEqual([97, 98, 99, 100]);
    expect(announced(101, 120)).toEqual([105, 110, 115, 120]);
    expect(announced(195, 230)).toEqual([195, 200, 210, 220, 230]);
    expect(announced(490, 560)).toEqual([490, 500, 520, 540, 560]);
  });

  test("never announces zero stars", () => {
    expect(notifiesAt(0, DEFAULT_FREQUENCY_TIERS)).toBe(false);
  });

  test("tier order does not matter", () => {
    const shuffled = [...DEFAULT_FREQUENCY_TIERS].reverse();
    expect(frequencyFor(250, shuffled)).toBe(10);
  });

  test("validation sorts tiers and rejects bad input", () => {
    expect(
      validateFrequencyTiers([
        { from: 100, every: "5" },
        { from: 0, every: 1 },
      ]),
    ).toEqual([
      { from: 0, every: 1 },
      { from: 100, every: 5 },
    ]);
    expect(() => validateFrequencyTiers([])).toThrow("at least one");
    expect(() => validateFrequencyTiers([{ from: 10, every: 1 }])).toThrow("start at 0");
    expect(() => validateFrequencyTiers([{ from: 0, every: 0 }])).toThrow("between 1");
    expect(() => validateFrequencyTiers([{ from: 0, every: 1.5 }])).toThrow("between 1");
    expect(() =>
      validateFrequencyTiers([
        { from: 0, every: 1 },
        { from: 0, every: 2 },
      ]),
    ).toThrow("Two tiers");
  });
});

describe("channelMatches with dynamic frequency", () => {
  const channel = {
    enabled: true,
    allRepos: true,
    notifyStar: true,
    notifyUnstar: true,
    milestoneEvery: null,
    frequencyTiers: DEFAULT_FREQUENCY_TIERS,
  };

  test("filters stars by the tier", () => {
    expect(channelMatches(channel, { action: "created", starCount: 50 }, false)).toBe(true);
    expect(channelMatches(channel, { action: "created", starCount: 103 }, false)).toBe(false);
    expect(channelMatches(channel, { action: "created", starCount: 105 }, false)).toBe(true);
  });

  test("unstars still follow the unstar setting", () => {
    expect(channelMatches(channel, { action: "deleted", starCount: 103 }, false)).toBe(true);
    expect(channelMatches({ ...channel, notifyUnstar: false }, { action: "deleted", starCount: 103 }, false)).toBe(
      false,
    );
  });

  test("off by default", () => {
    expect(channelMatches({ ...channel, frequencyTiers: null }, { action: "created", starCount: 103 }, false)).toBe(
      true,
    );
  });
});
