#!/usr/bin/env sh
# Starts the Kopanka multiplayer server (also serves the game for phone browsers).
# Usage: scripts/start-server.sh            (port 8787)
#        PORT=9000 scripts/start-server.sh
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
npm run --silent build >/dev/null
exec node server/server.ts
