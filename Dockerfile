# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install node_modules from the lockfile ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: hot-reloading dev server (used by docker compose) ----
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

# ---- builder: production build ----
FROM deps AS builder
COPY . .
RUN npm run build

# ---- runner: minimal production image ----
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
