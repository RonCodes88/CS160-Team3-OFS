# syntax=docker/dockerfile:1

FROM node:24-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install node_modules from the lockfile ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci && sha256sum package.json package-lock.json > node_modules/.ofs-dependencies.sha256

# ---- dev: hot-reloading dev server (used by docker compose) ----
FROM deps AS dev
COPY . .
COPY scripts/docker-dev-entrypoint.sh /usr/local/bin/ofs-dev-entrypoint
ENTRYPOINT ["sh", "/usr/local/bin/ofs-dev-entrypoint"]
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

# ---- worker: supervised delivery and recovery jobs ----
FROM deps AS worker
ENV NODE_ENV=production
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tsconfig.json ./
USER node
CMD ["npm", "run", "delivery:worker"]

# ---- builder: production build ----
FROM deps AS builder
COPY . .
RUN npm run build

# ---- runner: minimal production image ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
