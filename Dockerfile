# syntax=docker/dockerfile:1

# The JS bundle and frontend are platform independent, so build them natively
# and only assemble the runtime stage per target platform.
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build:web \
  && bun build src/server/index.ts --target bun --minify --outfile dist/server/index.js

FROM oven/bun:1-alpine AS runtime
RUN apk add --no-cache tzdata su-exec
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4321 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle

COPY --from=build /app/dist/server/index.js ./server.js
COPY --from=build /app/dist/web ./web
COPY --from=build /app/drizzle ./drizzle
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data && chown bun:bun /data

VOLUME /data
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["entrypoint.sh"]
CMD ["bun", "server.js"]
