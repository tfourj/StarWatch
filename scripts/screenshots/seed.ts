// Fills a fresh StarWatch instance with the shared demo data for README screenshots.
// Runs inside the app container started by scripts/screenshots.sh, with the server on localhost:4321.
import { Database } from "bun:sqlite";
import { createCipher } from "../../src/server/lib/crypto";
import {
  DEMO_GITHUB_LOGIN,
  DEMO_USER,
  DEMO_WEBHOOK_BASE_URL,
  generateDemoData,
} from "../../src/shared/demo-data";

const BASE = "http://localhost:4321";
const DATA_DIR = process.env.DATA_DIR ?? "/tmp/data";
const MINUTE = 60_000;
const now = Date.now();

const register = await fetch(`${BASE}/api/setup/register`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ ...DEMO_USER, password: "demopass123" }),
});
if (!register.ok) throw new Error(`register failed: ${register.status} ${await register.text()}`);

const secrets = JSON.parse(await Bun.file(`${DATA_DIR}/secrets.json`).text());
const cipher = createCipher(secrets.encryptionSecret);
const db = new Database(`${DATA_DIR}/starwatch.db`);
const userId = (db.query("select id from user").get() as { id: string }).id;
const data = generateDemoData(now);
const ms = (date: Date | null) => (date ? date.getTime() : null);

db.run(
  `insert or replace into user_settings
     (user_id, github_token, github_token_hint, github_login, github_scopes,
      github_token_checked_at, last_sync_at, last_poll_at)
   values (?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    userId,
    cipher.encrypt("ghp_demo"),
    "••••x9Qa",
    DEMO_GITHUB_LOGIN,
    JSON.stringify(["admin:repo_hook", "public_repo"]),
    now - 120 * MINUTE,
    now - 4 * MINUTE,
    now - 6 * MINUTE,
  ],
);
db.run("insert or replace into app_settings (key, value) values ('webhook_base_url', ?)", [DEMO_WEBHOOK_BASE_URL]);

const insertRepo = db.prepare(
  `insert into repositories
     (id, user_id, github_id, full_name, name, owner, html_url, description, private, fork, star_count, monitored,
      mode, hook_id, hook_status, hook_checked_at, last_delivery_at, backfilled_at, last_polled_at)
   values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const r of data.repos) {
  insertRepo.run(
    r.id, userId, r.githubId, r.fullName, r.name, r.owner, r.htmlUrl, r.description, r.private ? 1 : 0,
    r.fork ? 1 : 0, r.starCount, r.monitored ? 1 : 0, r.mode, r.hookId, r.hookStatus, ms(r.hookCheckedAt),
    ms(r.lastDeliveryAt), ms(r.backfilledAt), ms(r.lastPolledAt),
  );
}

const insertStargazer = db.prepare("insert into stargazers values (?, ?, ?, ?, ?)");
db.transaction(() => {
  for (const s of data.stargazers) {
    insertStargazer.run(s.repositoryId, s.githubUserId, s.login, s.avatarUrl, ms(s.starredAt));
  }
})();

const insertChannel = db.prepare(
  `insert into channels
     (id, user_id, name, type, config, enabled, all_repos, notify_star, notify_unstar, milestone_every,
      frequency_tiers)
   values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const c of data.channels) {
  insertChannel.run(
    c.id, userId, c.name, c.type, cipher.encryptJson(c.config), c.enabled ? 1 : 0, c.allRepos ? 1 : 0,
    c.notifyStar ? 1 : 0, c.notifyUnstar ? 1 : 0, c.milestoneEvery,
    c.frequencyTiers ? JSON.stringify(c.frequencyTiers) : null,
  );
}
for (const rc of data.repoChannels) {
  db.run("insert into repository_channels values (?, ?)", [rc.repositoryId, rc.channelId]);
}

const insertEvent = db.prepare(
  `insert into star_events
     (id, user_id, repository_id, action, actor_id, actor_login, actor_avatar_url, actor_url, star_count, source,
      occurred_at)
   values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const e of data.events) {
  insertEvent.run(
    e.id, userId, e.repositoryId, e.action, e.actorId, e.actorLogin, e.actorAvatarUrl, e.actorUrl, e.starCount,
    e.source, ms(e.occurredAt),
  );
}

const insertDelivery = db.prepare(
  `insert into notification_deliveries
     (id, event_id, channel_id, status, attempts, last_error, next_attempt_at, delivered_at)
   values (?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const d of data.deliveries) {
  insertDelivery.run(
    d.id, d.eventId, d.channelId, d.status, d.attempts, d.lastError, ms(d.nextAttemptAt), ms(d.deliveredAt),
  );
}

console.log("demo data seeded");
