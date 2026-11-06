#!/bin/sh
# Runtime config for the website and the browser game: where the API lives.
# PUBLIC_API_URL empty  → same site, /api and /ws are proxied to the API service.
# PUBLIC_API_URL set    → e.g. https://api.example.pl (WebSocket: wss://api.example.pl/ws).
set -e
api="${PUBLIC_API_URL%/}"
ws=""
[ -n "$api" ] && ws="$(echo "$api" | sed 's#^https://#wss://#; s#^http://#ws://#')/ws"
printf 'window.KICKABOUT = { api: "%s", ws: "%s" };\n' "$api" "$ws" > /usr/share/nginx/html/config.js
