# Build with the same Node/pnpm versions used for local development.
FROM node:24.22.1-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable pnpm && corepack install --global pnpm@11.25.0
WORKDIR /app
ENV WRANGLER_SEND_METRICS=false \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    SITES_PNPM_SHARED_STORE=/pnpm/store

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Wrangler/workerd provides the local D1 and R2 runtime, so it is a production dependency.
FROM base AS production-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24.22.1-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node docker ./docker
COPY --chown=node:node drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    SHIQU_DATA_DIR=/data \
    PORT=3000 \
    WRANGLER_SEND_METRICS=false \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD node docker/healthcheck.mjs
CMD ["node", "docker/start.mjs"]
