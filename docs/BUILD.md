# Building and Development

## Build the image from source

```bash
BASE_URL=https://starwatch.example.com docker compose -f docker-compose-local.yml up -d --build
```

Or with plain Docker:

```bash
docker build -t starwatch .
docker run -d --name starwatch -p 4321:4321 -e BASE_URL=https://starwatch.example.com -v starwatch-data:/data starwatch
```

## Published images

CI (`.github/workflows/ci.yml`) runs the typecheck, tests and build on every push and pull request, and publishes
`ghcr.io/tfourj/starwatch` for `linux/amd64` and `linux/arm64` from `main` and version tags.

| Tag              | Built from                    |
| ---------------- | ----------------------------- |
| `latest`         | `main`                        |
| `1.2.3`, `1.2`   | Git tags like `v1.2.3`        |
| `sha-<commit>`   | Every push                    |

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

This starts the API on port 4321 and Vite on port 5173 with `/api` proxied. Other scripts:

```bash
bun test             # unit tests
bun run typecheck    # TypeScript
bun run build        # frontend into dist/web, server bundle into dist/server
bun run db:generate  # create a migration after editing src/server/db/schema.ts
```

## Screenshots

The README screenshots are generated from made-up demo data. Only Docker is needed:

```bash
sh scripts/screenshots.sh        # dark mode, or pass light
```

It starts StarWatch with an empty database, seeds it with `scripts/screenshots/seed.ts`, captures each page at
1440×900 (2×) with headless Chrome and writes `docs/screenshots/*.png`. Edit `SHOTS` in
`scripts/screenshots/shoot.js` to change the pages.

See [STRUCTURE.md](STRUCTURE.md) for the code layout and [DATABASE.md](DATABASE.md) for the schema.
