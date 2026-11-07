// Made-up demo data shared by the screenshot script and the browser demo, so both look the same.
// All names are fictional and every date is relative to `now`, so the dashboard always looks current.
import { DEFAULT_FREQUENCY_TIERS, type FrequencyTier } from "./frequency";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEMO_USER = { name: "Alex Rivera", email: "alex@example.com" };
export const DEMO_GITHUB_LOGIN = "demo";
export const DEMO_WEBHOOK_BASE_URL = "https://stars.example.com";

export type DemoRepoMode = "webhook" | "polling" | "both";

export interface DemoRepo {
  id: number;
  githubId: number;
  name: string;
  fullName: string;
  owner: string;
  htmlUrl: string;
  description: string;
  private: boolean;
  fork: boolean;
  starCount: number;
  monitored: boolean;
  mode: DemoRepoMode;
  hookId: number | null;
  hookStatus: "active" | "none";
  hookCheckedAt: Date;
  lastDeliveryAt: Date | null;
  backfilledAt: Date | null;
  lastPolledAt: Date | null;
}

export interface DemoStargazer {
  repositoryId: number;
  githubUserId: number;
  login: string;
  avatarUrl: string;
  starredAt: Date;
}

export interface DemoChannel {
  id: number;
  name: string;
  type: string;
  config: Record<string, string | number | boolean>;
  enabled: boolean;
  allRepos: boolean;
  notifyStar: boolean;
  notifyUnstar: boolean;
  milestoneEvery: number | null;
  frequencyTiers: FrequencyTier[] | null;
}

export interface DemoEvent {
  id: number;
  repositoryId: number;
  action: "created" | "deleted";
  actorId: number;
  actorLogin: string;
  actorAvatarUrl: string;
  actorUrl: string;
  starCount: number;
  source: "webhook" | "polling";
  occurredAt: Date;
}

export interface DemoDelivery {
  id: number;
  eventId: number;
  channelId: number;
  status: "success" | "retrying" | "failed";
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
}

export interface DemoData {
  repos: DemoRepo[];
  stargazers: DemoStargazer[];
  channels: DemoChannel[];
  repoChannels: { repositoryId: number; channelId: number }[];
  events: DemoEvent[];
  deliveries: DemoDelivery[];
}

interface RepoSpec {
  name: string;
  description: string;
  stars: number;
  monitored: boolean;
  mode: DemoRepoMode;
  private?: boolean;
  fork?: boolean;
  /** Relative share of new stars in the last 30 days. */
  weight: number;
}

const REPOS: RepoSpec[] = [
  {
    name: "starwatch",
    description: "Self-hosted star alerts for your GitHub repos",
    stars: 1284,
    monitored: true,
    mode: "webhook",
    weight: 6,
  },
  {
    name: "tiny-http",
    description: "A minimal HTTP server in 300 lines",
    stars: 2317,
    monitored: true,
    mode: "webhook",
    weight: 4,
  },
  {
    name: "homelab-dash",
    description: "Dashboard for everything running at home",
    stars: 642,
    monitored: true,
    mode: "both",
    weight: 3,
  },
  {
    name: "cli-kit",
    description: "Batteries for building command line tools",
    stars: 315,
    monitored: true,
    mode: "webhook",
    weight: 2,
  },
  {
    name: "dotfiles",
    description: "My shell, editor and terminal setup",
    stars: 87,
    monitored: true,
    mode: "polling",
    weight: 1,
  },
  {
    name: "aqua-sensor",
    description: "ESP32 pool temperature sensor",
    stars: 41,
    monitored: true,
    mode: "polling",
    private: true,
    weight: 0.5,
  },
  {
    name: "notes",
    description: "Personal notes",
    stars: 3,
    monitored: false,
    mode: "webhook",
    private: true,
    weight: 0,
  },
  {
    name: "old-experiments",
    description: "Things I tried once",
    stars: 12,
    monitored: false,
    mode: "webhook",
    fork: true,
    weight: 0,
  },
  {
    name: "blog",
    description: "Source of my personal blog",
    stars: 28,
    monitored: false,
    mode: "webhook",
    weight: 0,
  },
];

const LOGINS = [
  "nightowl42", "bitwrangler", "pixel-paula", "rustacean-ray", "kernelkat", "devnomad", "quietcoder",
  "lambda-lena", "fernbyte", "sudo-sam", "mira-codes", "yaml-yeti", "gopher-gabe", "astro-ada", "cachemiss",
  "tabsnotspaces", "loopy-lou", "nullpointer-nina", "heapster", "octo-otto", "byte-bella", "async-andy",
  "vim-vera", "segfault-sid",
];

const EVENT_REPOS = [
  "starwatch", "starwatch", "tiny-http", "homelab-dash", "starwatch",
  "cli-kit", "tiny-http", "dotfiles", "homelab-dash", "aqua-sensor",
];

export const demoAvatar = (login: string) => `https://github.com/identicons/${login}.png`;

export function generateDemoData(now = Date.now()): DemoData {
  // Deterministic pseudo-random numbers so every run produces the same picture.
  let state = 7;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;

  const repos: DemoRepo[] = REPOS.map((spec, i) => {
    const hasHook = spec.monitored && spec.mode !== "polling";
    return {
      id: i + 1,
      githubId: 9000 + i,
      name: spec.name,
      fullName: `demo/${spec.name}`,
      owner: "demo",
      htmlUrl: `https://github.com/demo/${spec.name}`,
      description: spec.description,
      private: Boolean(spec.private),
      fork: Boolean(spec.fork),
      starCount: spec.stars,
      monitored: spec.monitored,
      mode: spec.mode,
      hookId: hasHook ? 100 + i : null,
      hookStatus: hasHook ? "active" : "none",
      hookCheckedAt: new Date(now - 4 * MINUTE),
      lastDeliveryAt: hasHook ? new Date(now - Math.floor(random() * 3 * HOUR)) : null,
      backfilledAt: spec.monitored ? new Date(now - 20 * DAY) : null,
      lastPolledAt: spec.monitored && spec.mode !== "webhook" ? new Date(now - 6 * MINUTE) : null,
    };
  });
  const repoId = (name: string) => repos.find((r) => r.name === name)!.id;

  const stargazers: DemoStargazer[] = [];
  let githubUserId = 1;
  const addStargazer = (repositoryId: number, login: string, starredAt: number) =>
    stargazers.push({
      repositoryId,
      githubUserId: githubUserId++,
      login,
      avatarUrl: demoAvatar(login),
      starredAt: new Date(starredAt),
    });

  const monitored = REPOS.filter((r) => r.monitored);
  for (const spec of monitored) {
    // Older stars from the initial import.
    for (let i = 0; i < 60; i++) {
      addStargazer(repoId(spec.name), `user${githubUserId}`, now - (40 + random() * 400) * DAY);
    }
  }
  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    for (const spec of monitored) {
      // An upward trend with one viral day.
      const base = spec.weight * (0.4 + (29 - daysAgo) / 30) + (daysAgo === 9 ? spec.weight * 4 : 0);
      const count = Math.floor(base * (0.5 + random()));
      for (let i = 0; i < count; i++) {
        const named = random() < 0.3;
        const login = named ? `${LOGINS[Math.floor(random() * LOGINS.length)]}-${githubUserId}` : `dev${githubUserId}`;
        addStargazer(repoId(spec.name), login, now - daysAgo * DAY - random() * 20 * HOUR);
      }
    }
  }

  const channels: DemoChannel[] = [
    {
      id: 1,
      name: "Discord #stars",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/1/demo", username: "StarWatch" },
      enabled: true,
      allRepos: true,
      notifyStar: true,
      notifyUnstar: true,
      milestoneEvery: null,
      frequencyTiers: null,
    },
    {
      id: 2,
      name: "Phone (ntfy)",
      type: "ntfy",
      config: { serverUrl: "https://ntfy.sh", topic: "stars", priority: "3" },
      enabled: true,
      allRepos: true,
      notifyStar: true,
      notifyUnstar: true,
      milestoneEvery: null,
      frequencyTiers: DEFAULT_FREQUENCY_TIERS,
    },
    {
      id: 3,
      name: "Team Slack",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/services/demo" },
      enabled: true,
      allRepos: false,
      notifyStar: true,
      notifyUnstar: true,
      milestoneEvery: null,
      frequencyTiers: null,
    },
    {
      id: 4,
      name: "Milestones",
      type: "email",
      config: { host: "smtp.example.com", port: 587, secure: false, from: "stars@example.com", to: DEMO_USER.email },
      enabled: true,
      allRepos: true,
      notifyStar: true,
      notifyUnstar: false,
      milestoneEvery: 100,
      frequencyTiers: null,
    },
  ];
  const repoChannels = ["starwatch", "tiny-http"].map((name) => ({ repositoryId: repoId(name), channelId: 3 }));

  const events: DemoEvent[] = [];
  const deliveries: DemoDelivery[] = [];
  const counts = Object.fromEntries(REPOS.map((r) => [r.name, r.stars]));

  for (let i = 0; i < 70; i++) {
    const name = EVENT_REPOS[i % EVENT_REPOS.length];
    const action = i % 9 === 4 ? "deleted" : "created";
    const login = LOGINS[(i * 7) % LOGINS.length];
    const occurredAt = now - i * 2.3 * HOUR - random() * HOUR;
    const mode = REPOS.find((r) => r.name === name)!.mode;
    const event: DemoEvent = {
      id: i + 1,
      repositoryId: repoId(name),
      action,
      actorId: 5000 + i,
      actorLogin: login,
      actorAvatarUrl: demoAvatar(login),
      actorUrl: `https://github.com/${login}`,
      starCount: counts[name],
      source: mode === "polling" || (mode === "both" && i % 5 === 2) ? "polling" : "webhook",
      occurredAt: new Date(occurredAt),
    };
    events.push(event);
    counts[name] += action === "created" ? -1 : 1;

    const targets = [1, 2];
    if (name === "starwatch" || name === "tiny-http") targets.push(3);
    for (const channelId of targets) {
      if (channelId === 2 && action === "deleted") continue;
      // One retrying and one failed delivery so the statuses show up.
      const status = i === 1 && channelId === 2 ? "retrying" : i === 6 && channelId === 3 ? "failed" : "success";
      deliveries.push({
        id: deliveries.length + 1,
        eventId: event.id,
        channelId,
        status,
        attempts: status === "success" ? 1 : status === "failed" ? 6 : 2,
        lastError: status === "success" ? null : "HTTP 503: Service Unavailable",
        nextAttemptAt: status === "retrying" ? new Date(now + 4 * MINUTE) : null,
        deliveredAt: status === "success" ? new Date(occurredAt + 2000) : null,
      });
    }
  }

  return { repos, stargazers, channels, repoChannels, events, deliveries };
}
