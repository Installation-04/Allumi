# syntax=docker/dockerfile:1.7
# Allumi — image de production (Next.js standalone, non-root)

ARG NODE_VERSION=22

# ---------- deps ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---------- build ----------
FROM deps AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npx prisma generate && npm run build

# ---------- migrate (utilisé par le service "migrate") ----------
# Applique les migrations puis (re)configure le rôle restreint de l'application (prisma/app-role.mjs).
FROM deps AS migrate
# No network call at startup: neither Prisma's version check nor npm's update notifier.
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 npm_config_update_notifier=false
WORKDIR /app
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
CMD ["npm", "run", "db:migrate"]

# ---------- runner ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ARG APP_VERSION=dev
WORKDIR /app
ENV APP_VERSION=${APP_VERSION} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/storage/attachments /app/.next/cache \
    && chown -R node:node /app

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
