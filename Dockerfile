# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.13.1
ARG BUN_VERSION=1.3.11

FROM oven/bun:${BUN_VERSION} AS bun-toolchain

FROM node:${NODE_VERSION}-bookworm-slim AS build-base

COPY --from=bun-toolchain /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV CI=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      python3 \
    && rm -rf /var/lib/apt/lists/*

COPY . .

FROM build-base AS build

ARG VITE_APP_MODE=redxtrm-remote
ARG VITE_APP_BRAND_NAME="RedXTRM Builder"
ARG VITE_APP_STAGE_LABEL=Production
ARG VITE_REMOTE_BUILDER_CAPABILITIES=conversations,diffs,usage

ENV VITE_APP_MODE=${VITE_APP_MODE} \
    VITE_APP_BRAND_NAME=${VITE_APP_BRAND_NAME} \
    VITE_APP_STAGE_LABEL=${VITE_APP_STAGE_LABEL} \
    VITE_REMOTE_BUILDER_CAPABILITIES=${VITE_REMOTE_BUILDER_CAPABILITIES} \
    T3CODE_WEB_SOURCEMAP=false

RUN bun install --frozen-lockfile \
    && bun run --cwd apps/web build \
    && bun run --cwd apps/server build \
    && test -f /app/apps/server/dist/bin.mjs \
    && test -f /app/apps/server/dist/client/index.html

FROM build-base AS production-dependencies

RUN bun install --frozen-lockfile --production --filter=t3 --ignore-scripts \
    && npm run install --prefix /app/apps/server/node_modules/node-pty \
    && cd /app/apps/server \
    && node --input-type=module -e "import('@effect/platform-node/NodeRuntime').then(()=>import('node-pty'))"

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="RedXTRM Builder" \
      org.opencontainers.image.description="Tenant-scoped RedXTRM coding builder" \
      org.opencontainers.image.source="https://github.com/absrasel-cell/t3code"

COPY --from=bun-toolchain /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/apps/server /workspace /var/lib/t3code \
    && chown -R node:node /app /workspace /var/lib/t3code

WORKDIR /workspace

COPY --from=production-dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=build --chown=node:node /app/apps/server/package.json /app/apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist /app/apps/server/dist
COPY --chown=node:node --chmod=0555 deploy/redxtrm-builder/entrypoint.sh /usr/local/bin/redxtrm-builder
COPY --chown=node:node --chmod=0444 deploy/redxtrm-builder/healthcheck.mjs /usr/local/lib/redxtrm-builder-healthcheck.mjs

ENV NODE_ENV=production \
    T3_RUNTIME=node \
    T3_APP_MODE=redxtrm-remote \
    T3CODE_MODE=web \
    T3CODE_HOST=0.0.0.0 \
    T3CODE_PORT=3000 \
    T3CODE_HOME=/var/lib/t3code \
    T3CODE_NO_BROWSER=true \
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=false \
    T3CODE_LOG_WS_EVENTS=false \
    T3CODE_LOG_LEVEL=Warn \
    T3CODE_TELEMETRY_ENABLED=false

VOLUME ["/var/lib/t3code"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/usr/local/lib/redxtrm-builder-healthcheck.mjs"]

USER node

ENTRYPOINT ["dumb-init", "--", "redxtrm-builder"]
