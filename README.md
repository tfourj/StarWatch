# StarWatch

Self-hosted star alerts for your GitHub repos. Get notified when someone stars or unstars one of your repositories.

## Features

- Instant alerts through GitHub webhooks, with polling as a fallback
- Webhooks are created and repaired automatically
- Notifications for stars, unstars or only milestones (every 10, 100 ... stars)
- Custom message templates
- Dashboard with stats, chart and event log
- Dark and light mode, multiple users

## Install with Docker Compose

1. Download [docker-compose.yml](docker-compose.yml).
2. Start it with your public URL:

   ```bash
   BASE_URL=https://starwatch.example.com docker compose up -d
   ```

3. Open the URL and create the first account. It becomes the admin.
4. In **Settings → GitHub**, add a classic token with `public_repo` (or `repo`) and `admin:repo_hook` scopes.

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
