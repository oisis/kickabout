# Kickabout API: accounts (/api) and the online-match relay (WebSocket). Data in /data (SQLite).
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/kickabout.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server/server.ts"]
