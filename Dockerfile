# Compile static assets and the Node server with the pinned toolchain.
FROM node:24.22.1-bookworm-slim AS base
WORKDIR /app
RUN corepack enable pnpm && corepack install --global pnpm@11.25.0

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS production-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node docker ./docker
COPY --chown=node:node drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production SHIQU_DATA_DIR=/data SHIQU_BIND_IP=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node docker/healthcheck.mjs
CMD ["node", "dist/server/index.js"]
