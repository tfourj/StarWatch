#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"

# Running as root: make sure the data volume belongs to the bun user, then drop privileges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u "$DATA_DIR")" != "1000" ]; then
    chown -R bun:bun "$DATA_DIR" || echo "warning: could not chown $DATA_DIR" >&2
  fi
  exec su-exec bun "$@"
fi

exec "$@"
