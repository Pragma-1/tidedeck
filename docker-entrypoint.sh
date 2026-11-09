#!/bin/sh
set -e

# Runs as root just long enough to hand the data folder to PUID:PGID,
# then drops privileges for the actual server.
if [ "$(id -u)" != "0" ]; then
  # Started with "user:" in compose: nothing to hand over.
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_DIR"
chown -R "$PUID:$PGID" "$DATA_DIR"

exec su-exec "$PUID:$PGID" "$@"
