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
`ghcr.io/tfourj/starwatch` for `linux/amd64` and `linux/arm64` from `main`, version tags and pull requests. Pull
requests from forks are built but not published.

| Tag                        | Built from                                   |
| -------------------------- | -------------------------------------------- |
| `latest`                   | The newest release                           |
| `v1.2.3`, `v1.2`, `v1`     | Git tags like `v1.2.3`                        |
| `v1.3.0-rc.1`              | Pre-release tags (exact tag only)            |
| `main`                     | Every push to `main` (unreleased)            |
| `preview`                  | The newest pull request build                |
| `pr-<number>`              | Every push to that pull request              |

The version label in the sidebar shows the version for any build of a stable release commit, including `main`,
`preview` and `pr-<number>` images of that commit, and the short commit for every other build. A tag pushed while
its commit is still the head of `main` also updates `main`.

To release, bump `version` in `package.json`, add the release to `CHANGELOG.md`, commit, then tag and push:

```bash
git tag -a v1.2.3 -m "StarWatch v1.2.3"
git push origin main v1.2.3
```

CI fails if the tag does not match `package.json`.

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

## Demo site

`bun run build:demo` builds a static demo into `dist/demo`. It is the normal frontend with the API answered in the
browser by `web/src/demo/api.ts`, using the same made-up data as the screenshots. Changes stay in memory and reset on
reload; syncing, pings, test notifications and token changes show a "not available in the demo" message. Normal
builds and the Docker image do not include any of it.

To host it on Cloudflare Pages, create a Pages project from the GitHub repository with:

| Setting                | Value                                               |
| ---------------------- | --------------------------------------------------- |
| Build command          | `bun install --frozen-lockfile && bun run build:demo` |
| Build output directory | `dist/demo`                                         |
| Root directory         | `/`                                                 |

Pages then redeploys on every push and the version label shows the deployed commit, or the version when that
commit is a release tag. Set `BUN_VERSION` in the
project's environment variables to pin a Bun version.
The build includes a `_redirects` file so routes like `/events` work on reload. Any other static host works too.

Run it locally with `bun run dev:demo`.

## Screenshots

The README screenshots are generated from made-up demo data. Only Docker is needed:

```bash
sh scripts/screenshots.sh        # dark mode, or pass light
```

It starts StarWatch with an empty database, seeds it with `scripts/screenshots/seed.ts`, captures each page at
1440×900 (2×) with headless Chrome and writes `docs/screenshots/*.png`. Edit `SHOTS` in
`scripts/screenshots/shoot.js` to change the pages.

See [STRUCTURE.md](STRUCTURE.md) for the code layout and [DATABASE.md](DATABASE.md) for the schema.
