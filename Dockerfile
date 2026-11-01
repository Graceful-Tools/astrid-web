# syntax=docker/dockerfile:1.7
#
# The self-hosted image: the web app, which is also the API every native client
# talks to, with no Vercel, Neon or Upstash account (AWTD-1286).
# Guide: docs/deployment/SELF_HOSTING.md. Compose: deploy/self-host/docker-compose.yml.
#
#   docker build --build-arg BRAND=acme --build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD) -t tasks .
#
# BRAND is a profile name in brands/ or a path to one inside the build context.
# It is a build argument because NEXT_PUBLIC_* values are compiled into the
# bundle: one image is one brand. Unset builds Astrid's defaults.
#
# Targets: `runner` (the default, last) serves the app and runs the cron
# runner; `migrator` applies Prisma migrations and exits.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
# prisma.config.ts holds the migrate connection since Prisma 7 (AWTD-1408).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN HUSKY=0 npm ci --no-audit --no-fund

# ── Migrations: `docker compose run migrate`, before each new version starts ──
FROM deps AS migrator
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Build ───────────────────────────────────────────────────────────────────
FROM deps AS builder
ARG BRAND=""
# The one NEXT_PUBLIC_* value that is a secret-adjacent key rather than brand
# identity, so it is not in a committed profile. Every other one is.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
COPY . .
# `prisma generate` refuses an undefined datasource variable, and nothing at
# build talks to a database: scripts/lib/build-migration-policy.js never
# migrates outside a Vercel production build.
ENV NEXT_OUTPUT=standalone \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    DATABASE_URL_DIRECT=postgresql://build:build@localhost:5432/build
RUN npx tsx scripts/brand-env-file.ts "$BRAND" > brand-env.json \
  && node deploy/self-host/load-env.mjs brand-env.json --exec npm run build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runner
ARG GIT_COMMIT_SHA=unknown
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_COMMIT_SHA=${GIT_COMMIT_SHA} \
    STORAGE_LOCAL_DIR=/app/data/uploads

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/brand-env.json ./brand-env.json
COPY --from=builder --chown=node:node /app/brand-env.json.public ./brand-env.json.public
COPY --chown=node:node deploy/self-host/load-env.mjs ./load-env.mjs
# The cron runner reads the job list from vercel.json, the one place it is written.
COPY --chown=node:node vercel.json ./vercel.json
COPY --chown=node:node scripts/cron-runner.mjs ./scripts/cron-runner.mjs
COPY --chown=node:node scripts/job-worker.mjs ./scripts/job-worker.mjs
COPY --chown=node:node scripts/lib/cron-schedule.mjs ./scripts/lib/cron-schedule.mjs
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "load-env.mjs", "brand-env.json", "--import", "./server.js"]
