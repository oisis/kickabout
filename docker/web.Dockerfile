# Kickabout website: home page, account pages, the game at /play/ and the APK at /download/.
# /api/ and /ws are proxied to the API service (API_UPSTREAM, e.g. api:8787).
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:1.29-alpine
ENV API_UPSTREAM=api:8787
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY web /usr/share/nginx/html
COPY --from=build /src/dist /usr/share/nginx/html/play
# Built separately (needs the Android SDK): npm run apk puts it in apk/kickabout.apk (.dockerignore drops the rest).
COPY apk/ /usr/share/nginx/html/download/
EXPOSE 8080
