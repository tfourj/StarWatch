<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-white.png">
    <img src="docs/assets/logo-black.png" alt="StarWatch logo" width="96">
  </picture>
</p>

<h1 align="center">StarWatch</h1>

<p align="center">
  Self-hosted star alerts for your GitHub repos.<br>
  Get notified when someone stars or unstars one of your repositories.
</p>

## Features

- Instant alerts through GitHub webhooks, with polling as a fallback
- Webhooks are created and repaired automatically
- Notifications for stars, unstars or only milestones (every 10, 100 ... stars)
- Custom message templates
- Dashboard with stats, chart and event log
- Dark and light mode, multiple users

## Screenshots

| Dashboard | Repositories |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Repositories](docs/screenshots/repositories.png) |
| **Events** | **Channels** |
| ![Events](docs/screenshots/events.png) | ![Channels](docs/screenshots/channels.png) |

## Install with Docker Compose

1. Download [docker-compose.yml](docker-compose.yml).
2. Create a `.env` file next to it:

   ```bash
   # Public HTTPS URL, used for GitHub webhooks and login
   BASE_URL=https://starwatch.example.com
   TZ=Europe/Berlin

   # Generate each with: openssl rand -base64 32
   # Optional, generated into /data/secrets.json if empty. Never change ENCRYPTION_SECRET later.
   BETTER_AUTH_SECRET=
   ENCRYPTION_SECRET=

   # Optional
   PORT=4321
   ALLOW_REGISTRATION=false
   GITHUB_CLIENT_ID=
   GITHUB_CLIENT_SECRET=
   ```

3. Start it:

   ```bash
   docker compose up -d
   ```

4. Open `BASE_URL` and create the first account. It becomes the admin.
5. In **Settings → GitHub**, add a classic token with `public_repo` (or `repo`) and `admin:repo_hook` scopes.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options and [docs/BUILD.md](docs/BUILD.md) to build from source.

## Notification providers

- Discord
- Telegram
- ntfy
- Gotify
- Slack
- Pushover
- Email (SMTP)
- Webhook (JSON)

## License

[GPL-3.0](LICENSE)
