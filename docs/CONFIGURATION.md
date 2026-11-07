# Configuration

## Setup

1. Register the admin account.
2. Create a classic personal access token ([shortcut](https://github.com/settings/tokens/new?description=StarWatch&scopes=public_repo,admin:repo_hook)) with:
   - `public_repo`, or `repo` if you want to monitor private repositories
   - `admin:repo_hook` to manage webhooks
3. In **Settings → GitHub**, paste the token. StarWatch validates it, shows its scopes and starts a sync.
4. In **Channels**, add at least one channel and press **Test**.
5. In **Repositories**, press **Add repositories**, pick one or more repos and a mode (webhook, polling or both).
   The page lists monitored repos only. **Stop all** stops every listed repo and removes its webhook. Click a star
   count to see the tracked stargazers. To monitor new repos automatically, enable
   **Settings → Monitoring → Monitor new repositories**.

Since July 2026 GitHub only returns stargazer lists to repo admins and collaborators, and tokens without scopes no
longer work, so a scoped token is required.

## How it works

**Webhooks (default).** Each monitored repo gets a webhook for the `star` event pointing at
`BASE_URL/api/webhooks/github`. Deliveries are verified with `X-Hub-Signature-256` against a per-install secret and
deduplicated by `X-GitHub-Delivery`. The background sync (hourly, and on **Sync webhooks**) lists your repos, creates
missing hooks, repairs changed or failing ones and removes hooks from repos you stop monitoring.

**Polling.** Every polling interval (default 15 minutes) StarWatch reads `stargazers_count` for your repos in one
request per 100 repos. Only when a count differs from the stored stargazers does it fetch the newest stargazer pages
and diff them. Rate limit headers are tracked and polling backs off when fewer than 50 requests remain.

**Both.** Webhook and polling run side by side. The stored stargazer list deduplicates events, so you still get one
notification per star.

**Initial import.** When a repo is first monitored, its current stargazers are imported without notifications.

## Configuration

| Variable               | Default                   | Description                                                        |
| ---------------------- | ------------------------- | ------------------------------------------------------------------ |
| `PORT`                 | `4321`                    | Port the app listens on                                            |
| `BASE_URL`             | `http://localhost:PORT`   | Public URL, used for webhook URLs, auth callbacks and cookies      |
| `BETTER_AUTH_SECRET`   | generated                 | Session signing secret, at least 32 characters                     |
| `ENCRYPTION_SECRET`    | generated                 | Key for encrypting tokens and channel credentials                  |
| `ALLOW_REGISTRATION`   | `false`                   | Let more users sign up after the first admin                       |
| `TZ`                   | `UTC`                     | Timezone for `{time}` and the dashboard day boundaries             |
| `GITHUB_CLIENT_ID`     |                           | Optional GitHub OAuth app for "Continue with GitHub"               |
| `GITHUB_CLIENT_SECRET` |                           | Secret for the OAuth app                                           |
| `SYNC_INTERVAL_MINUTES`| `60`                      | How often repos and webhooks are synced                            |
| `LOG_LEVEL`            | `info`                    | `debug`, `info`, `warn` or `error`                                 |
| `LOG_BUFFER_SIZE`      | `1000`                    | Recent log lines kept in memory for the Logs page                  |

If `BETTER_AUTH_SECRET` or `ENCRYPTION_SECRET` is not set, StarWatch generates one into `/data/secrets.json` and logs a
warning. Back up that file together with the database: without the encryption secret, stored tokens and channel
credentials cannot be decrypted.

For GitHub OAuth login, set the OAuth app callback URL to `BASE_URL/api/auth/callback/github`. OAuth can only sign in
existing users (matched by email) unless `ALLOW_REGISTRATION=true`.

All data lives in the `/data` volume: `starwatch.db` (SQLite) and `secrets.json`. Migrations run on startup. Logs are
JSON lines on stdout (`docker logs starwatch`). Admins can also read recent lines on the **Logs** page, filtered by
level, area or text. `GET /api/health` is used by the Docker healthcheck.

## Notification channels

Each channel has a type, its credentials (stored encrypted, never sent back to the browser in full), an enabled
toggle, a **Test** button and filters:

- all repositories or a selected list
- stars, unstars or both
- frequency: every star (default), milestones (only when the star count is a multiple of N), or dynamic:

  | Stars        | Notify on            |
  | ------------ | -------------------- |
  | 0 to 99      | Every new star       |
  | 100 to 199   | Every 5 new stars    |
  | 200 to 499   | Every 10 new stars   |
  | 500 and more | Every 20 new stars   |

  The dynamic tiers can be edited per channel. "Every 5" means the star count is a multiple of 5. Unstars are not
  thinned out; they follow the unstar setting.

Templates are set in **Settings → Templates** and can be overridden per channel. Variables:

| Variable     | Value                              |
| ------------ | ---------------------------------- |
| `{user}`     | Login of the stargazer             |
| `{user_url}` | Profile URL                        |
| `{avatar}`   | Avatar URL                         |
| `{repo}`     | `owner/name`                       |
| `{repo_url}` | Repository URL                     |
| `{stars}`    | Star count after the event         |
| `{action}`   | `starred` or `unstarred`           |
| `{time}`     | Event time in `TZ`                 |

Failed deliveries are retried up to 6 times with exponential backoff (30s, 1m, 2m, 4m, 8m). Every attempt is logged
and visible in **Events**, where you can also retry by hand.

## Reverse proxy, Coolify and Cloudflare

- Set `BASE_URL` to the public HTTPS URL. It is used for webhook URLs and auth callbacks, and turns on secure cookies.
- `X-Forwarded-*`, `X-Real-IP` and `CF-Connecting-IP` are trusted for client IPs.
- **Coolify:** deploy `docker-compose.yml` (published image) or build from this repository with the Dockerfile, set the domain,
  add the env vars and keep `/data` on a persistent volume. The container exposes port 4321.
- **Cloudflare:** GitHub's webhook deliveries come from GitHub's servers and can be blocked as bots. Disable
  **Bot Fight Mode**, or add a WAF custom rule that skips security features for
  `http.request.uri.path eq "/api/webhooks/github"`. A failing hook shows as **Error** on the Repositories page with
  GitHub's last response code. Use the ping button there to test after changing rules.
- If the app is reachable under a different URL than GitHub should use, admins can set a webhook base URL in
  **Settings → Monitoring**. Changing it updates all hooks.

## Limitations

- Polling compares counts, so a star and an unstar between two polls cancel out and are missed. Webhooks catch both.
- GitHub lists at most 40,000 stargazers per repo. Larger repos are imported partially and should use webhook mode.
- Removing the GitHub token or deleting a user leaves existing webhooks on GitHub. Disable monitoring first to remove
  them.
