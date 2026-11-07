// Fills a fresh StarWatch instance with made-up demo data for README screenshots.
// Runs inside the app container started by scripts/screenshots.sh, with the server on localhost:4321.
// All names are fictional; dates are relative to now so the dashboard always looks current.
import { Database } from "bun:sqlite";
import { createCipher } from "../../src/server/lib/crypto";

const BASE = "http://localhost:4321";
const DATA_DIR = process.env.DATA_DIR ?? "/tmp/data";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();

// Deterministic pseudo-random numbers so every run produces the same picture.
let state = 7;
const random = () => (state = (state * 16807) % 2147483647) / 2147483647;

const avatar = (login: string) => `https://github.com/identicons/${login}.png`;

async function register() {
  const res = await fetch(`${BASE}/api/setup/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ name: "Alex Rivera", email: "alex@example.com", password: "demopass123" }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
}

await register();

const secrets = JSON.parse(await Bun.file(`${DATA_DIR}/secrets.json`).text());
const cipher = createCipher(secrets.encryptionSecret);
const db = new Database(`${DATA_DIR}/starwatch.db`);
const userId = (db.query("select id from user").get() as { id: string }).id;

/* --------------------------------- Settings -------------------------------- */

db.run(
  `insert or replace into user_settings
     (user_id, github_token, github_token_hint, github_login, github_scopes,
      github_token_checked_at, last_sync_at, last_poll_at)
   values (?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    userId,
    cipher.encrypt("ghp_demo"),
    "••••x9Qa",
    "demo",
    JSON.stringify(["admin:repo_hook", "public_repo"]),
    now - 2 * HOUR,
    now - 4 * MINUTE,
    now - 6 * MINUTE,
  ],
);
db.run("insert or replace into app_settings (key, value) values ('webhook_base_url', 'https://stars.example.com')");

/* ------------------------------- Repositories ------------------------------ */

interface DemoRepo {
  name: string;
  description: string;
  stars: number;
  monitored: boolean;
  mode: "webhook" | "polling" | "both";
  private?: boolean;
  fork?: boolean;
  /** Relative share of new stars in the last 30 days. */
  weight: number;
}

const REPOS: DemoRepo[] = [
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

const repoIds: Record<string, number> = {};
REPOS.forEach((repo, i) => {
  const hasHook = repo.monitored && repo.mode !== "polling";
  const row = db
    .query(
      `insert into repositories
         (user_id, github_id, full_name, name, owner, html_url, description, private, fork, star_count,
          monitored, mode, hook_id, hook_status, hook_checked_at, last_delivery_at, backfilled_at, last_polled_at)
       values (?, ?, ?, ?, 'demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       returning id`,
    )
    .get(
      userId,
      9000 + i,
      `demo/${repo.name}`,
      repo.name,
      `https://github.com/demo/${repo.name}`,
      repo.description,
      repo.private ? 1 : 0,
      repo.fork ? 1 : 0,
      repo.stars,
      repo.monitored ? 1 : 0,
      repo.mode,
      hasHook ? 100 + i : null,
      hasHook ? "active" : "none",
      now - 4 * MINUTE,
      hasHook ? now - Math.floor(random() * 3 * HOUR) : null,
      repo.monitored ? now - 20 * DAY : null,
      repo.monitored && repo.mode !== "webhook" ? now - 6 * MINUTE : null,
    ) as { id: number };
  repoIds[repo.name] = row.id;
});

/* -------------------------------- Stargazers ------------------------------- */

const LOGINS = [
  "nightowl42", "bitwrangler", "pixel-paula", "rustacean-ray", "kernelkat", "devnomad", "quietcoder",
  "lambda-lena", "fernbyte", "sudo-sam", "mira-codes", "yaml-yeti", "gopher-gabe", "astro-ada", "cachemiss",
  "tabsnotspaces", "loopy-lou", "nullpointer-nina", "heapster", "octo-otto", "byte-bella", "async-andy",
  "vim-vera", "segfault-sid",
];

const insertStargazer = db.prepare("insert into stargazers values (?, ?, ?, ?, ?)");
let githubUserId = 1;
const monitored = REPOS.filter((r) => r.monitored);

for (const repo of monitored) {
  // Older stars from the initial import.
  for (let i = 0; i < 60; i++) {
    const login = `user${githubUserId}`;
    const starredAt = now - (40 + random() * 400) * DAY;
    insertStargazer.run(repoIds[repo.name], githubUserId++, login, avatar(login), starredAt);
  }
}

for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
  for (const repo of monitored) {
    // An upward trend with one viral day.
    const base = repo.weight * (0.4 + (29 - daysAgo) / 30) + (daysAgo === 9 ? repo.weight * 4 : 0);
    const count = Math.floor(base * (0.5 + random()));
    for (let i = 0; i < count; i++) {
      const named = random() < 0.3;
      const login = named ? `${LOGINS[Math.floor(random() * LOGINS.length)]}-${githubUserId}` : `dev${githubUserId}`;
      const starredAt = now - daysAgo * DAY - random() * 20 * HOUR;
      insertStargazer.run(repoIds[repo.name], githubUserId++, login, avatar(login), starredAt);
    }
  }
}

/* --------------------------------- Channels -------------------------------- */

const CHANNELS = [
  { name: "Discord #stars", type: "discord", config: { webhookUrl: "https://discord.com/api/webhooks/1/x" } },
  { name: "Phone (ntfy)", type: "ntfy", config: { serverUrl: "https://ntfy.sh", topic: "stars", priority: "3" } },
  { name: "Team Slack", type: "slack", config: { webhookUrl: "https://hooks.slack.com/services/x" }, allRepos: false },
  {
    name: "Milestones",
    type: "email",
    config: { host: "smtp.example.com", port: 587, from: "stars@example.com", to: "alex@example.com" },
    milestoneEvery: 100,
    notifyUnstar: false,
  },
];

const channelIds: Record<string, number> = {};
for (const ch of CHANNELS) {
  const row = db
    .query(
      `insert into channels (user_id, name, type, config, enabled, all_repos, notify_unstar, milestone_every)
       values (?, ?, ?, ?, 1, ?, ?, ?) returning id`,
    )
    .get(
      userId,
      ch.name,
      ch.type,
      cipher.encryptJson(ch.config),
      ch.allRepos === false ? 0 : 1,
      ch.notifyUnstar === false ? 0 : 1,
      ch.milestoneEvery ?? null,
    ) as { id: number };
  channelIds[ch.name] = row.id;
}
for (const repo of ["starwatch", "tiny-http"]) {
  db.run("insert into repository_channels values (?, ?)", [repoIds[repo], channelIds["Team Slack"]]);
}

/* ---------------------------- Events and delivery -------------------------- */

const EVENT_REPOS = [
  "starwatch", "starwatch", "tiny-http", "homelab-dash", "starwatch",
  "cli-kit", "tiny-http", "dotfiles", "homelab-dash", "aqua-sensor",
];
const counts = Object.fromEntries(REPOS.map((r) => [r.name, r.stars]));

for (let i = 0; i < 70; i++) {
  const repo = EVENT_REPOS[i % EVENT_REPOS.length];
  const action = i % 9 === 4 ? "deleted" : "created";
  const login = LOGINS[(i * 7) % LOGINS.length];
  const occurredAt = now - i * 2.3 * HOUR - random() * HOUR;
  const mode = REPOS.find((r) => r.name === repo)!.mode;
  const source = mode === "polling" || (mode === "both" && i % 5 === 2) ? "polling" : "webhook";

  const event = db
    .query(
      `insert into star_events
         (user_id, repository_id, action, actor_id, actor_login, actor_avatar_url, actor_url, star_count,
          source, occurred_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`,
    )
    .get(
      userId,
      repoIds[repo],
      action,
      5000 + i,
      login,
      avatar(login),
      `https://github.com/${login}`,
      counts[repo],
      source,
      occurredAt,
    ) as { id: number };
  counts[repo] += action === "created" ? -1 : 1;

  const targets = ["Discord #stars", "Phone (ntfy)"];
  if (repo === "starwatch" || repo === "tiny-http") targets.push("Team Slack");
  for (const channel of targets) {
    if (channel === "Phone (ntfy)" && action === "deleted") continue;
    // One retrying and one failed delivery so the statuses show up.
    const status =
      i === 1 && channel === "Phone (ntfy)" ? "retrying" : i === 5 && channel === "Team Slack" ? "failed" : "success";
    db.run(
      `insert into notification_deliveries (event_id, channel_id, status, attempts, last_error, delivered_at)
       values (?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        channelIds[channel],
        status,
        status === "success" ? 1 : status === "failed" ? 6 : 2,
        status === "success" ? null : "HTTP 503: Service Unavailable",
        status === "success" ? occurredAt + 2000 : null,
      ],
    );
  }
}

console.log("demo data seeded");
