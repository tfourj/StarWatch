/** From `from` stars upward, notify on every `every`-th star (when the count is a multiple of `every`). */
export interface FrequencyTier {
  from: number;
  every: number;
}

export const DEFAULT_FREQUENCY_TIERS: FrequencyTier[] = [
  { from: 0, every: 1 },
  { from: 100, every: 5 },
  { from: 200, every: 10 },
  { from: 500, every: 20 },
];

export const MAX_FREQUENCY_TIERS = 10;

/** The `every` value that applies at a star count: the tier with the highest `from` not above it. */
export function frequencyFor(stars: number, tiers: FrequencyTier[]): number {
  let every = 1;
  for (const tier of [...tiers].sort((a, b) => a.from - b.from)) {
    if (tier.from <= stars) every = tier.every;
  }
  return every;
}

/** Whether a new star that brought the repo to `stars` should be announced. */
export function notifiesAt(stars: number, tiers: FrequencyTier[]): boolean {
  return stars > 0 && stars % frequencyFor(stars, tiers) === 0;
}

/** Validate and normalize tiers from user input. Throws an Error with a readable message. */
export function validateFrequencyTiers(input: unknown): FrequencyTier[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Add at least one frequency tier");
  if (input.length > MAX_FREQUENCY_TIERS) throw new Error(`Use at most ${MAX_FREQUENCY_TIERS} frequency tiers`);

  const tiers = input.map((raw) => {
    const tier = raw as Partial<FrequencyTier>;
    const from = Number(tier?.from);
    const every = Number(tier?.every);
    if (!Number.isInteger(from) || from < 0) throw new Error("Star counts must be whole numbers of 0 or more");
    if (!Number.isInteger(every) || every < 1 || every > 100_000) {
      throw new Error("Frequency must be a whole number between 1 and 100000");
    }
    return { from, every };
  });

  tiers.sort((a, b) => a.from - b.from);
  if (tiers[0].from !== 0) throw new Error("The first frequency tier must start at 0 stars");
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].from === tiers[i - 1].from) throw new Error(`Two tiers start at ${tiers[i].from} stars`);
  }
  return tiers;
}
