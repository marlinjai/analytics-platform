FROM infisical/cli:0.43.69 AS infisical

FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/dashboard/package.json ./packages/dashboard/
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/dashboard/node_modules ./packages/dashboard/node_modules
COPY . .

# Build shared first, then dashboard
RUN pnpm --filter @analytics-platform/shared build
# Dummy env vars needed at build time for Next.js page data collection
ENV DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy
ENV CLICKHOUSE_URL=http://localhost:8123
ENV NEXTAUTH_SECRET=build-time-placeholder
RUN pnpm --filter @analytics-platform/dashboard build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=infisical /bin/infisical /usr/local/bin/infisical
RUN apk add --no-cache curl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# public dir may not exist — create empty fallback
RUN mkdir -p ./packages/dashboard/public
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

# Migration SQL files (read by instrumentation hook on startup)
COPY --from=builder --chown=nextjs:nodejs /app/packages/shared/src/migrations ./packages/shared/src/migrations

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

COPY --chown=nextjs:nodejs packages/dashboard/entrypoint.sh ./entrypoint.sh
CMD ["sh", "entrypoint.sh"]
