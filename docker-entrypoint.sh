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

case "$PUID:$PGID" in
  *[!0-9:]* | :* | *:) echo "[tidedeck] PUID and PGID must be numbers (got '$PUID:$PGID')" >&2; exit 1 ;;
esac
if [ "$PUID" = "0" ]; then
  echo "[tidedeck] Refusing to run the server as root (PUID=0). Use the id of a normal user." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
# Only touch ownership when it's off, so a big data folder doesn't slow every start.
if [ "$(stat -c %u:%g "$DATA_DIR")" != "$PUID:$PGID" ] || [ -n "$(find "$DATA_DIR" ! -user "$PUID" -print -quit)" ]; then
  chown -R "$PUID:$PGID" "$DATA_DIR"
fi
# Secrets and the password hash are for the server user only.
chmod 700 "$DATA_DIR"

exec su-exec "$PUID:$PGID" "$@"
