# Database Schema

SQLite via Drizzle ORM. The schema lives in `src/server/db/schema.ts`, migrations are generated into `drizzle/`
and applied automatically on startup. Timestamps are stored as Unix milliseconds.

Values marked *encrypted* are AES-256-GCM ciphertext (key derived from `ENCRYPTION_SECRET`).

## Auth (Better Auth)

| Table          | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `user`         | Accounts. Adds `role` (`admin` or `user`) and `two_factor_enabled`       |
| `session`      | Login sessions                                                           |
| `account`      | Credentials (password hash) and linked OAuth providers                   |
| `verification` | Short-lived verification tokens, 2FA challenges and trusted devices      |
| `two_factor`   | TOTP secret and backup codes per user, encrypted with `BETTER_AUTH_SECRET` |

## App settings

**`app_settings`** install-wide key/value pairs

| Column       | Notes                                                        |
| ------------ | ------------------------------------------------------------ |
| `key`        | Primary key, for example `webhook_secret`, `webhook_base_url` |
| `value`      | Text, encrypted for secrets                                  |
| `updated_at` |                                                              |

**`user_settings`** one row per user

| Column                     | Notes                                           |
| -------------------------- | ----------------------------------------------- |
| `user_id`                  | PK, FK `user.id`                                |
| `github_token`             | *encrypted* classic PAT                         |
| `github_token_hint`        | Last 4 characters for display                   |
| `github_login`             | Login the token belongs to                      |
| `github_scopes`            | JSON array from `X-OAuth-Scopes`                |
| `github_token_checked_at`  |                                                 |
| `polling_interval_minutes` | Default 15                                      |
| `auto_monitor_new`         | Monitor newly discovered repos (default off)    |
| `templates`                | JSON `{ starTitle, starBody, unstarTitle, unstarBody }` |
| `login_alert_channels`     | JSON array of channel ids notified on sign-in   |
| `last_sync_at`             | Last repository and webhook sync                |
| `last_poll_at`             | Last polling run                                |

## Repositories and stargazers

**`repositories`**

| Column              | Notes                                                      |
| ------------------- | ---------------------------------------------------------- |
| `id`                | PK                                                         |
| `user_id`           | FK `user.id`                                               |
| `github_id`         | GitHub repository id, unique per user                      |
| `full_name`, `name`, `owner`, `html_url`, `description` |                        |
| `private`, `fork`, `archived` | Flags from GitHub                                |
| `star_count`        | Last known `stargazers_count`                              |
| `monitored`         | Monitoring on or off                                       |
| `mode`              | `webhook`, `polling` or `both`                             |
| `hook_id`           | GitHub webhook id                                          |
| `hook_status`       | `none`, `active`, `missing`, `error`                       |
| `hook_error`        | Last webhook error                                         |
| `hook_checked_at`   |                                                            |
| `last_delivery_at`  | Last ping or star delivery received from GitHub            |
| `backfilled_at`     | Set after the silent initial stargazer import              |
| `last_polled_at`    |                                                            |
| `removed_at`        | Set when the repo no longer shows up on GitHub             |

**`repository_channels`** `(repository_id, channel_id)` repos assigned to a channel when its `all_repos` is off

**`stargazers`** current stargazers per repo, used for diffing and dedupe

| Column           | Notes                         |
| ---------------- | ----------------------------- |
| `repository_id`  | PK part, FK                   |
| `github_user_id` | PK part                       |
| `login`, `avatar_url` |                          |
| `starred_at`     | From `application/vnd.github.star+json` |

## Events and delivery

**`star_events`**

| Column            | Notes                                     |
| ----------------- | ----------------------------------------- |
| `id`              | PK                                        |
| `user_id`         | Owner, for filtering                      |
| `repository_id`   | FK                                        |
| `action`          | `created` (star) or `deleted` (unstar)    |
| `actor_id`, `actor_login`, `actor_avatar_url`, `actor_url` |  |
| `star_count`      | Repo stars right after the event          |
| `source`          | `webhook` or `polling`                    |
| `delivery_id`     | `X-GitHub-Delivery` when from a webhook   |
| `occurred_at`     |                                           |

**`webhook_deliveries`** dedupe log keyed by `X-GitHub-Delivery` (`delivery_id`, `event`, `status`, `received_at`)

**`channels`**

| Column           | Notes                                                |
| ---------------- | ---------------------------------------------------- |
| `id`             | PK                                                   |
| `user_id`        | FK                                                   |
| `name`, `type`   | Type is a provider id, for example `discord`         |
| `config`         | *encrypted* JSON provider config                     |
| `enabled`        |                                                      |
| `all_repos`      | Applies to every repo, otherwise `repository_channels` |
| `notify_star`, `notify_unstar` | Event filters                          |
| `milestone_every` | Only notify when the star count is a multiple of N  |
| `frequency_tiers` | Dynamic frequency: JSON `[{ from, every }]`, null when off |
| `templates`      | Optional JSON template overrides                     |

**`notification_deliveries`** one row per event and channel

| Column            | Notes                                         |
| ----------------- | --------------------------------------------- |
| `id`              | PK                                            |
| `event_id`, `channel_id` | FK, unique together                    |
| `status`          | `pending`, `retrying`, `success`, `failed`    |
| `attempts`        |                                               |
| `next_attempt_at` | Exponential backoff schedule                  |
| `last_error`      |                                               |
| `delivered_at`    |                                               |

**`delivery_attempts`** every send attempt (`delivery_id`, `attempt`, `success`, `error`, `duration_ms`, `created_at`)
