# Analytics Platform — Claude Context

## Project Overview
Self-hosted analytics, heatmap, and session replay platform. Monorepo with pnpm workspaces.

## Package Structure
- `packages/shared` — Contract layer: types, Zod schemas, ClickHouse + Postgres DDL
- `packages/tracker` — Browser SDK (<5KB gzip, zero runtime deps, optional rrweb)
- `packages/dashboard` — Next.js 15 app (API routes + dashboard UI)

## Key Decisions
- **No brain-core dependency** — standalone auth (NextAuth), own Postgres, own API key format (`ap_live_`/`ap_test_`)
- **Combined dashboard + API** — Next.js API routes in dashboard package
- **Wide ClickHouse table** — all event types in one `events` table + 3 materialized views
- **Zero runtime deps in tracker** — rrweb is optional peer dep, lazy-loaded
- **TrackerEvent excludes server fields** — `ipHash` and `country` are server-enriched

## Common Commands
```bash
pnpm install                                    # Install all deps
pnpm dev                                        # Start dashboard dev server
pnpm build                                      # Build all packages
pnpm --filter @analytics-platform/shared build  # Build shared only
pnpm --filter @marlinjai/analytics-tracker build # Build tracker only
docker compose up -d postgres clickhouse         # Start databases
```

## Tech Stack
- TypeScript 5.7, Node.js 20+
- Next.js 15, React 19, Tailwind CSS v4
- ClickHouse 24 (events), PostgreSQL 16 (config)
- NextAuth v5, Zod, rrweb (optional)
- pnpm workspaces, tsup, vitest

## Agent Specs
- `agents.json` — machine-readable agent definitions (10 agents, use with agent tooling)
- `docs/internal/agent-specs.md` — detailed specs with dependency graph, files, contracts, acceptance criteria
- `docs/internal/research.md` — architecture research (PostHog, Hotjar, rrweb, Plausible, OpenReplay)
- `docs/internal/architecture.md` — system design, data flow, technology choices

## Phases
- Phase 0: Scaffold (complete)
- Phase 1: Foundation — shared tests, tracker SDK, ingestion API (Agents 1-4, parallelizable)
- Phase 2: Backend — query APIs, project CRUD, auth (Agents 5-7)
- Phase 3: Dashboard UI — overview, heatmap, replay pages (Agents 8-10)
- Phase 4: Integration & production hardening (lead agent)
