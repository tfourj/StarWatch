# Changelog

All notable changes to StarWatch are listed here. The newest version is at the top.

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
