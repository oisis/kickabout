#!/usr/bin/env sh
# Starts the Kickabout API server (accounts + online matches) without Docker.
# The website and the browser game are served by the web image: docker compose up.
# Usage: scripts/start-server.sh            (port 8787, DEV_LOGIN=1 for local sign-in)
#        PORT=9000 scripts/start-server.sh
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
exec node server/server.ts
