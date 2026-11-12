# Changelog

All notable changes to StarWatch are listed here. The newest version is at the top.

## [1.2.0] - 2026-11-12

### Added

- Follower tracking in a new **Followers** tab. Get notified on any channel when someone follows or unfollows the GitHub account, with a 30-day summary, activity log and searchable follower list. Off by default.
- **New followers** and **Unfollows** options per channel.
- Per-account time settings in **Settings → Account → Time display**: timezone, 12 or 24-hour clock, and relative or full dates. They apply to the app, `{time}`, login alerts and the dashboard.
- Bold in message templates with `**text**`, for example `**[{user}]({user_url})**`.
- **Start a new thread for each email** option for Email (SMTP) channels, so Gmail stops grouping alerts into one conversation.
- Install StarWatch as an app from the browser. It opens offline to the last loaded page.
- Repository filters for mode, webhook status and channel, and sorting by name or star count. Click a column title on the Repositories table to filter it, and **Clear** to reset.
- Sorting and **Hide** private, fork and archived repositories in the **Add repositories** dialog.

### Changed

- What's new is redesigned with collapsible releases and a card showing the running version, or how many commits a build is ahead of the last release.
- The What's new dot is cleared per account, so opening it on one device clears it everywhere.
- Any build of a release commit shows the version instead of the short commit, including `:main`, `:preview` and the demo.

### Fixed

- Webhook-only repositories kept stargazers that GitHub removed without a webhook, such as deleted or spam accounts. The hourly sync now finds and records these changes.
- The Followers list stretched the page, and its Activity scrollbar overlapped the card corner.

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
