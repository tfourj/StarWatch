# Changelog

All notable changes to StarWatch are listed here. The newest version is at the top.

## [1.1.0] - 2026-11-08

### Added

- Two-factor authentication with an authenticator app, backup codes and "Trust this device for 30 days". Admins can turn 2FA off for a user who lost their codes.
- Login alerts: get notified on any channel when someone signs in, with the method, device, IP address and time.
- Built-in Cloudflare Tunnel in **Settings → Cloudflared**, so webhooks work without a reverse proxy or open port. Only the webhook path is exposed.
- Links in message templates with `[text](url)`, for example `[{user}]({user_url}) starred [{repo}]({repo_url})`. The default messages now link the user and the repository.
- **Main link** option per channel to open the repository, the stargazer or nothing.
- **Sender name** and **Show StarWatch logo** options for Email (SMTP) channels.
- Pull requests publish `:preview` and `:pr-<number>` Docker images.

### Changed

- Builds that are not a stable release show the short commit in the version label.
- Emails have a small logo header and the stargazer avatar beside the message.
- Page titles and descriptions that repeated the navigation are removed.
- Loading on Events and Logs shows a floating pill instead of moving the page.
- `sha-<commit>` Docker images are no longer published.

### Fixed

- `{time}` in notifications always showed an ISO timestamp. It now reads like `7 Nov 2026, 19:00 UTC`.
- Email inbox previews no longer show link URLs.

## [1.0.0] - 2026-11-07

First release.

### Added

- Star and unstar alerts through GitHub webhooks, with polling as a fallback. Choose webhook, polling or both per repository.
- Webhooks are created, repaired and removed automatically. The ping button checks delivery end to end and explains failures.
- Silent import of existing stargazers when monitoring starts. Click a star count to see every tracked stargazer.
- Notification channels: Discord, Telegram, ntfy, Gotify, Slack, Pushover, Email (SMTP) and JSON webhook.
- Per-channel filters: repositories, stars and unstars, milestones, and **dynamic frequency** that notifies less often as a repository grows.
- Custom message templates with `{user}`, `{repo}`, `{stars}`, `{action}`, `{time}` and more.
- Retries with exponential backoff and a log of every delivery attempt.
- Dashboard with stats and a 30-day chart, a filterable event log, and a live **Logs** page for admins.
- Version label with in-app release notes.
- Multiple users. The first account becomes the admin.
- GitHub token and channel credentials are encrypted at rest.
- Dark and light mode.
