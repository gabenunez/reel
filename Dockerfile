# syntax=docker/dockerfile:1

###############################################################################
# Builder — install all workspace deps and produce production builds.
###############################################################################
FROM node:20-bookworm AS builder

# Native modules (better-sqlite3) need a toolchain during install/build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Install with the lockfile first for better layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Build shared → server → web (web prerender needs the server built first).
COPY . .
RUN pnpm --filter @media-app/shared build \
  && pnpm --filter @media-app/server build \
  && (cd packages/web && node scripts/with-api-for-build.mjs)

# Produce a pruned production dependency tree for the runtime image.
# CI=true lets pnpm prune the modules dir non-interactively (no TTY in build).
RUN CI=true pnpm install --prod --frozen-lockfile

###############################################################################
# Runtime — slim image with ffmpeg; no build toolchain.
###############################################################################
FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

ENV NODE_ENV=production \
    MEDIA_CONFIG_DIR=/config \
    MEDIA_DATA_DIR=/data \
    MEDIA_PORT=8096

WORKDIR /app

# Workspace metadata + scripts.
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/turbo.json ./
COPY --from=builder /app/scripts ./scripts

# API server: built dist + drizzle migrations + production node_modules.
# (pnpm package node_modules symlink into the root .pnpm store, so both are needed.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules

# Web: self-contained Next standalone server (bundles its own node_modules,
# static assets, and public via copy-standalone-assets.mjs). The API runs
# api-only, so the static SPA export (out/) is not needed at runtime.
COPY --from=builder /app/packages/web/package.json ./packages/web/package.json
COPY --from=builder /app/packages/web/.next/standalone ./packages/web/.next/standalone

COPY docker/entrypoint.sh /usr/local/bin/media-entrypoint
RUN chmod +x /usr/local/bin/media-entrypoint

VOLUME ["/config", "/data"]
EXPOSE 8096

# tini reaps zombie ffmpeg/node children from the supervisor cleanly.
ENTRYPOINT ["/usr/bin/tini", "--", "media-entrypoint"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${MEDIA_PORT:-8096}/api/health" || exit 1
