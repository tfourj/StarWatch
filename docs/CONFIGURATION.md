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
missing hooks, repairs changed or failing ones and removes hooks from repos you stop monitoring. It also compares
each webhook-only repo's `stargazers_count` with the stored stargazers. When they differ, it fetches the stargazer
list and records the stars and unstars that never arrived as a webhook. This covers lost deliveries and stars GitHub
removes on its own, for example when an account is deleted or flagged as spam, which send no webhook.

**Polling.** Every polling interval (default 15 minutes) StarWatch reads `stargazers_count` for your repos in one
request per 100 repos. Only when a count differs from the stored stargazers does it fetch the newest stargazer pages
and diff them. Rate limit headers are tracked and polling backs off when fewer than 50 requests remain.

**Both.** Webhook and polling run side by side. The stored stargazer list deduplicates events, so you still get one
notification per star.

**Initial import.** When a repo is first monitored, its current stargazers are imported without notifications.

**Followers.** **Followers → Track followers** watches who follows the GitHub account the token belongs to. GitHub
sends no webhook for follows, so StarWatch checks the follower count every polling interval and fetches the follower
list only when it changed. Current followers are imported without notifications. **Stop tracking** clears the stored
list; turning it back on imports it again. Saving a token for a different account starts a fresh import.

## Configuration

| Variable               | Default                   | Description                                                        |
| ---------------------- | ------------------------- | ------------------------------------------------------------------ |
| `PORT`                 | `4321`                    | Port the app listens on                                            |
| `BASE_URL`             | `http://localhost:PORT`   | Public URL, used for webhook URLs, auth callbacks and cookies      |
| `BETTER_AUTH_SECRET`   | generated                 | Session signing secret, at least 32 characters                     |
| `ENCRYPTION_SECRET`    | generated                 | Key for encrypting tokens and channel credentials                  |
| `ALLOW_REGISTRATION`   | `false`                   | Let more users sign up after the first admin                       |
| `TZ`                   | `UTC`                     | Default timezone for `{time}` and dashboard days                   |
| `GITHUB_CLIENT_ID`     |                           | Optional GitHub OAuth app for "Continue with GitHub"               |
| `GITHUB_CLIENT_SECRET` |                           | Secret for the OAuth app                                           |
| `SYNC_INTERVAL_MINUTES`| `60`                      | How often repos and webhooks are synced                            |
| `LOG_LEVEL`            | `info`                    | `debug`, `info`, `warn` or `error`                                 |
| `LOG_BUFFER_SIZE`      | `1000`                    | Recent log lines kept in memory for the Logs page                  |
| `TUNNEL_PORT`          | `4322`                    | Local webhook-only port the Cloudflare tunnel points at            |
| `CLOUDFLARED_PATH`     | downloaded                | Use your own `cloudflared` binary instead of the managed one       |

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
- new followers, unfollows or both (these ignore the repository filter)
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
| `{time}`     | Event time in your timezone        |

Write `[text](url)` for a link, for example `[{user}]({user_url}) starred [{repo}]({repo_url})`, and `**text**` for
bold, for example `**[{user}]({user_url})**`. Each channel renders them in its own format. Titles show plain text only,
and ntfy shows each link as a button without bold.

The **Main link** option on a channel picks the repository, the stargazer or nothing. It is opened when a Gotify, ntfy
or Pushover notification is tapped and linked from the Discord embed title. On Telegram, Slack, Email and Gotify it is
also added below the message when the template has no links of its own.

Email channels have a **Sender name**, shown in the inbox instead of the bare address, and add the StarWatch logo at
the top of each message unless **Show StarWatch logo** is off. The avatar next to the sender is picked by the mail
client (for example a Google account photo or a BIMI record on the domain), so StarWatch cannot set it.

Follower messages use fixed text, for example "octocat followed you on GitHub. You now have 120 followers.", and
their main link opens the follower's profile. The JSON webhook sends `"event": "follow"` with `action` `followed` or
`unfollowed`.

Failed deliveries are retried up to 6 times with exponential backoff (30s, 1m, 2m, 4m, 8m). Every attempt is logged
and visible in **Events**, where you can also retry by hand. Follower deliveries are listed on **Followers**; click a
failed one to retry it.

## Account security

**Settings → Security** has two options per account:

- **Two-factor authentication:** scan the QR code with an authenticator app and enter a code to turn it on. Save the
  10 backup codes it shows; each works once. Password sign-ins then ask for a code, and **Trust this device** skips it
  for 30 days. GitHub sign-ins do not ask for a code. Accounts without a password cannot turn it on. If a user loses
  their codes, an admin can turn it off in **Settings → Users**.
- **Login alerts:** pick one or more existing channels. Every sign-in sends a message with the method, device, IP
  address and time. Disabled channels are skipped. **Send test** sends a sample to the selected channels.

## Time display

**Settings → Account → Time display** sets your timezone, a 12 or 24-hour clock, and whether recent times show as
"5 minutes ago" or as a date and time. Each account has its own choice.

With the **Default** timezone, the app uses your browser's timezone, and `{time}`, login alerts and dashboard days use
`TZ`. A chosen timezone is used everywhere and overrides `TZ`. Changing `TZ` later only affects accounts on Default.

## Cloudflare Tunnel

StarWatch can run `cloudflared` itself, so GitHub reaches the webhook without a reverse proxy or open port. It is off
by default. Admins turn it on in **Settings → Cloudflared**. The tunnel only exposes the webhook receiver on
`TUNNEL_PORT`, never the UI or API.

- **Tunnel token (default):** create a tunnel in [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) under
  **Networks → Tunnels**, add a public hostname with the service `http://localhost:4322`, then paste the token (or the
  whole install command) and the hostname into StarWatch. The webhook URL stays stable.
- **Quick tunnel:** no account needed, but the `trycloudflare.com` URL changes every time the tunnel starts. StarWatch
  updates all webhooks when it does. Use **both** mode on repositories so polling covers restarts.

While the tunnel is on, it sets the webhook URL and the webhook base URL setting is ignored.

`cloudflared` is not part of the image. StarWatch downloads the latest release from GitHub into `/data/bin` when the
tunnel starts, checks its SHA-256 digest, and checks for updates on start, daily, and with the refresh button. A new
version restarts the tunnel. With `CLOUDFLARED_PATH` set, StarWatch uses that binary and never updates it.

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
  The same applies to the sync check on webhook-only repos.
- Follower checks compare counts too, so a follow and an unfollow between two checks cancel out. Accounts with more
  than 10,000 followers are not tracked.
- GitHub lists at most 40,000 stargazers per repo. Larger repos are imported partially and should use webhook mode.
- Removing the GitHub token or deleting a user leaves existing webhooks on GitHub. Disable monitoring first to remove
  them.
