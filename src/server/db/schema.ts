import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FrequencyTier } from "../../shared/frequency";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
};

/* ----------------------------- Better Auth ----------------------------- */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
});

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Encrypted by Better Auth with BETTER_AUTH_SECRET. */
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  },
  (t) => [index("two_factor_user_idx").on(t.userId)],
);

/* ------------------------------- Settings ------------------------------ */

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamps.updatedAt,
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  githubToken: text("github_token"),
  githubTokenHint: text("github_token_hint"),
  githubLogin: text("github_login"),
  githubScopes: text("github_scopes", { mode: "json" }).$type<string[] | null>(),
  githubTokenCheckedAt: integer("github_token_checked_at", { mode: "timestamp_ms" }),
  pollingIntervalMinutes: integer("polling_interval_minutes").notNull().default(15),
  autoMonitorNew: integer("auto_monitor_new", { mode: "boolean" }).notNull().default(false),
  templates: text("templates", { mode: "json" }).$type<Record<string, string> | null>(),
  /** Channels that get a message on every sign-in, null when off. */
  loginAlertChannels: text("login_alert_channels", { mode: "json" }).$type<number[] | null>(),
  /** Last version whose release notes the user opened, null until they open them. */
  seenVersion: text("seen_version"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastSyncError: text("last_sync_error"),
  lastPollAt: integer("last_poll_at", { mode: "timestamp_ms" }),
  ...timestamps,
});

/* ----------------------------- Repositories ---------------------------- */

export const REPO_MODES = ["webhook", "polling", "both"] as const;
export const HOOK_STATUSES = ["none", "active", "missing", "error"] as const;

export const repositories = sqliteTable(
  "repositories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    githubId: integer("github_id").notNull(),
    fullName: text("full_name").notNull(),
    name: text("name").notNull(),
    owner: text("owner").notNull(),
    htmlUrl: text("html_url").notNull(),
    description: text("description"),
    private: integer("private", { mode: "boolean" }).notNull().default(false),
    fork: integer("fork", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    starCount: integer("star_count").notNull().default(0),
    monitored: integer("monitored", { mode: "boolean" }).notNull().default(false),
    mode: text("mode", { enum: REPO_MODES }).notNull().default("webhook"),
    hookId: integer("hook_id"),
    hookStatus: text("hook_status", { enum: HOOK_STATUSES }).notNull().default("none"),
    hookError: text("hook_error"),
    hookCheckedAt: integer("hook_checked_at", { mode: "timestamp_ms" }),
    lastDeliveryAt: integer("last_delivery_at", { mode: "timestamp_ms" }),
    backfilledAt: integer("backfilled_at", { mode: "timestamp_ms" }),
    backfillError: text("backfill_error"),
    lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("repositories_user_github_idx").on(t.userId, t.githubId),
    index("repositories_github_idx").on(t.githubId),
  ],
);

export const stargazers = sqliteTable(
  "stargazers",
  {
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    githubUserId: integer("github_user_id").notNull(),
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
    starredAt: integer("starred_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    primaryKey({ columns: [t.repositoryId, t.githubUserId] }),
    index("stargazers_starred_idx").on(t.starredAt),
  ],
);

/* -------------------------------- Events ------------------------------- */

export const starEvents = sqliteTable(
  "star_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    action: text("action", { enum: ["created", "deleted"] }).notNull(),
    actorId: integer("actor_id").notNull(),
    actorLogin: text("actor_login").notNull(),
    actorAvatarUrl: text("actor_avatar_url"),
    actorUrl: text("actor_url"),
    starCount: integer("star_count").notNull(),
    source: text("source", { enum: ["webhook", "polling"] }).notNull(),
    deliveryId: text("delivery_id"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("star_events_user_idx").on(t.userId, t.occurredAt),
    index("star_events_repo_idx").on(t.repositoryId),
  ],
);

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  status: text("status", { enum: ["processed", "ignored", "failed"] }).notNull(),
  repoFullName: text("repo_full_name"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/* ------------------------------- Channels ------------------------------ */

export const channels = sqliteTable(
  "channels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    allRepos: integer("all_repos", { mode: "boolean" }).notNull().default(true),
    notifyStar: integer("notify_star", { mode: "boolean" }).notNull().default(true),
    notifyUnstar: integer("notify_unstar", { mode: "boolean" }).notNull().default(true),
    milestoneEvery: integer("milestone_every"),
    /** Dynamic frequency tiers, null when off. */
    frequencyTiers: text("frequency_tiers", { mode: "json" }).$type<FrequencyTier[] | null>(),
    templates: text("templates", { mode: "json" }).$type<Record<string, string> | null>(),
    ...timestamps,
  },
  (t) => [index("channels_user_idx").on(t.userId)],
);

export const repositoryChannels = sqliteTable(
  "repository_channels",
  {
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.channelId] })],
);

export const DELIVERY_STATUSES = ["pending", "retrying", "success", "failed"] as const;

export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => starEvents.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("deliveries_event_channel_idx").on(t.eventId, t.channelId),
    index("deliveries_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const deliveryAttempts = sqliteTable(
  "delivery_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deliveryId: integer("delivery_id")
      .notNull()
      .references(() => notificationDeliveries.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("attempts_delivery_idx").on(t.deliveryId)],
);

export type User = typeof user.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type StarEvent = typeof starEvents.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
