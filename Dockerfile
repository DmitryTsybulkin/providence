# syntax=docker/dockerfile:1
# Providence: one container running the local server, which also serves the built web app.
#
#   docker build -t providence .
#   docker run -d --name providence -p 127.0.0.1:4317:4317 -v providence-data:/data providence
#   open http://localhost:4317
#
# Always publish on 127.0.0.1 (as above): the app has no authentication.

ARG NODE_VERSION=22

# ---------- build ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
# Toolchain for better-sqlite3 in case no prebuilt binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# Dependencies first, so source changes do not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/adapter-bybit/package.json packages/adapter-bybit/
COPY packages/indicators/package.json packages/indicators/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @providence/server deploy --prod --legacy /out \
 && cp -r apps/web/dist /out/web

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PROVIDENCE_IN_DOCKER=1 \
    PROVIDENCE_PORT=4317 \
    PROVIDENCE_DB_PATH=/data/providence.db \
    PROVIDENCE_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
