# syntax=docker/dockerfile:1
#
# Synology-friendly pattern (see reference/removedoubles): node:22-alpine with
# extended npm fetch timeouts. Use `docker compose build` with network: host.

FROM node:22-alpine AS deps
WORKDIR /app

RUN npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

COPY package.json package-lock.json ./
# Default warn; for Synology npm ci failures use:
#   NPM_CI_VERBOSE=1 npm run docker:build
# or: docker compose build --build-arg NPM_CI_LOGLEVEL=verbose --progress=plain
ARG NPM_CI_LOGLEVEL=warn
RUN npm ci --prefer-offline --no-audit --no-fund --fetch-timeout=600000 --loglevel=${NPM_CI_LOGLEVEL}

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build && cp -a public .next/standalone/public

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# sharp on Alpine
RUN apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
