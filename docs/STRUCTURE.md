# Project Structure

StarWatch is a single Bun process that serves the JSON API, the GitHub webhook receiver, the background jobs
and the built React frontend on one port.

```text
StarWatch/
├── .github/workflows/ci.yml    Typecheck, tests, build, multi-arch image to GHCR
├── Dockerfile                  Multi-stage build (deps, build, slim runtime)
├── docker-compose.yml          Runs the published GHCR image with a /data volume
├── docker-compose-local.yml    Builds the image from source instead
├── docker/entrypoint.sh        Fixes /data ownership, drops to the bun user
├── drizzle/                    Generated SQL migrations (applied on startup)
├── drizzle.config.ts           drizzle-kit config
├── scripts/screenshots.sh      Regenerates README screenshots from demo data (Docker only)
├── scripts/screenshots/        Demo data seed and headless Chrome capture
├── vite.config.ts              Frontend build and dev proxy
├── docs/
│   ├── STRUCTURE.md            This file
│   ├── DATABASE.md             Database schema
│   ├── CONFIGURATION.md        Setup, env vars, channels, reverse proxy notes
│   ├── BUILD.md                Building from source, CI images, development
│   ├── assets/                 README logo (light and dark)
│   └── screenshots/            README screenshots
├── CHANGELOG.md                Release notes, also shown in the app
├── .env.example                Example environment for docker compose
├── src/
│   ├── server/
│   │   ├── index.ts            Entry point: config, migrations, HTTP server, jobs
│   │   ├── app.ts              Hono app: API routes, static files, SPA fallback
│   │   ├── config.ts           Env vars and auto-generated secrets in /data
│   │   ├── logger.ts           JSON logger for stdout
│   │   ├── log-buffer.ts       Recent log lines in memory for the Logs page
│   │   ├── db/                 Drizzle client, schema and migrator
│   │   ├── auth/               Better Auth setup, first-user registration, session middleware
│   │   ├── lib/                Encryption, template rendering, small helpers
│   │   ├── github/             GitHub REST client, rate limits, signatures, stargazer diffing, hooks
│   │   ├── services/           Settings, repo sync, star event recording, polling, backfill
│   │   ├── notifications/      Provider interface, providers, dispatcher and retry worker
│   │   ├── jobs/               Background scheduler
│   │   └── routes/             API route modules
│   └── shared/                 Code shared by server and frontend (templates, channels, frequency, demo data)
├── web/
│   ├── index.html
│   ├── public/                 Favicon, app icons, web manifest
│   └── src/
│       ├── main.tsx            React entry
│       ├── App.tsx             Router and auth guards
│       ├── index.css           Tailwind and theme tokens
│       ├── lib/                API client, auth client, response types, utilities
│       ├── hooks/              Session and setup-status queries
│       ├── components/ui/      shadcn/ui components
│       ├── demo/               In-browser fake API for the static demo build
│       ├── components/repos/   Repository dialogs (add repositories, stargazers)
│       ├── components/         Layout, sidebar, shared widgets
│       └── pages/              Dashboard, Repositories, Events, Channels, Logs, Settings, auth pages
└── tests/                      bun test suites
```
