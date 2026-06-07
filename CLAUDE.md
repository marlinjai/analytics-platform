# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Self-hosted analytics, heatmap, and session replay platform. Monorepo with pnpm workspaces. The tracker is a published npm package; the dashboard is private and self-hosted.

## Package Structure
- `packages/shared` — Contract layer: TypeScript types, Zod schemas, ClickHouse + Postgres DDL, exported as `@analytics-platform/shared`
- `packages/tracker` — Browser SDK (`@marlinjai/analytics-tracker`, <6KB gzip, zero runtime deps, rrweb optional peer dep)
- `packages/dashboard` — Next.js 15 app: both API routes and UI, `@analytics-platform/dashboard`
- `packages/react` — React hooks for A/B testing and feature flags (`@marlinjai/analytics-react`, published)
- `packages/cli` — CLI tool for project setup (`@marlinjai/analytics-cli`, published as `lumitra` bin)
- `packages/extension` — Chrome extension with heatmap overlay (content script + background script)
- `packages/demo` — Static demo site

## Common Commands
```bash
pnpm install                                     # Install all deps
pnpm dev                                         # Dashboard dev server (Infisical secrets if token set)
pnpm dev:local                                   # Dashboard dev (no secrets, uses .env)
pnpm dev:demo                                    # Dashboard + demo site in parallel
pnpm build                                       # Build all packages
pnpm test                                        # Run vitest (shared + dashboard)
pnpm test -- --run                               # Single-pass (CI mode)
pnpm typecheck                                   # tsc --noEmit all packages
pnpm lint                                        # Lint all
docker compose up -d postgres clickhouse         # Start databases
bash scripts/setup.sh                            # First-time setup (docker, migrations)
bash scripts/migrate.sh                          # Run pending DB migrations
PW_WEB_SERVER=1 pnpm exec playwright test        # E2E tests (starts dev server)
pnpm --filter @analytics-platform/shared build   # Build a single package
pnpm --filter @marlinjai/analytics-tracker build
```

**Single test file:**
```bash
pnpm test -- packages/shared/src/__tests__/schemas.test.ts
pnpm test -- packages/dashboard/src/__tests__/collect.test.ts
```

Dashboard runs on **port 3100** by default (set in `packages/dashboard/scripts/dev.mjs`).

## Architecture

### Event Flow
1. **Tracker SDK** batches events (max 50, flush every 5s). Uses `sendBeacon` for small payloads on page hide; falls back to gzip-compressed fetch with 3-retry exponential backoff.
2. **POST /api/collect** validates the `ap_live_`/`ap_test_` API key, decompresses gzip if needed, validates with Zod (`eventBatchSchema`), then server-enriches: IP hash (SHA256 + daily salt), GeoIP, browser/OS/device detection.
3. **ClickHouse** stores all events in `analytics.events` (wide sparse table, 12-month TTL, partitioned by month, ordered by `(project_id, type, timestamp)`).
4. **Materialized views** pre-aggregate for fast queries: `pageviews_hourly_mv`, `sessions_summary_mv`, `heatmap_selectors_mv`, `heatmap_selectors_by_variant_mv`, `heatmap_selectors_by_version_mv`.
5. **PostgreSQL** stores config only: projects, users, memberships, API keys, page snapshots.

### Tracker Consent Model
- **No consent required**: pageviews and session tracking fire immediately on `init()`.
- **Consent required**: `enableTracking()` attaches click/scroll listeners. `enableReplay()` lazy-loads rrweb and starts recording.

### Heatmap and Page Versioning
- Each click event includes a `pageHash` (8-char murmurhash3 of the DOM structure). `computePageHash()` hashes tag names, child counts, and stable attributes; ignores analytics-injected nodes (`/^(__analytics|lumitra|rrweb)/`).
- On ingestion, `maybeStoreSnapshot()` saves the full serialized DOM to `page_snapshots` in Postgres (unique per `project_id + url + page_hash`).
- Historical heatmap replay: `HistoricalHeatmapViewer` fetches page versions, `SnapshotHeatmap` renders the stored DOM + overlays the heatmap using h337.

### Session Replay
- rrweb is dynamically imported in `enableReplay()`. Privacy defaults: `maskAllInputs: true`, password/email/tel fields blocked.
- Chunks flush every 10s or when the buffer exceeds 512KB. Chunks are sent as `replay_chunk` events with gzip compression.
- Playback: `/api/sessions/[sessionId]/replay` reassembles rrweb events from ClickHouse; `rrweb-player` renders them.

### API Key Format
- `ap_live_` / `ap_test_` — project-scoped, used by the tracker SDK for event ingestion.
- `ap_account_` — user-scoped, used by the CLI and for project management via API.
- `/api/collect` rejects account keys. Keys are hashed (SHA256) before storage in Postgres.

### Allowed Origins (Ingestion Gate)
Each project carries an `allowed_origins TEXT[]` column (`packages/shared/src/postgres-ddl.ts`). When non-empty, `/api/collect` matches the request `Origin` (or `Referer` fallback) against the list using `originIsAllowed()` (`packages/dashboard/src/lib/origin-match.ts`). Mismatches return HTTP 204 with no body, so dev/staging environments can call `init()` for flag and experiment evaluation without polluting prod analytics. Empty list = legacy "allow all" behavior. The `/api/projects/{id}/config` endpoint is intentionally NOT gated: tracker config must load everywhere for variants to render correctly. Entries support exact hosts (`app.example.com`), wildcard subdomains (`*.example.com`), and host:port pairs (`localhost:3000`); browsers strip default ports (443/80), so store the bare host instead.

### Query Layer
All ClickHouse and Postgres queries live in `packages/dashboard/src/lib/queries/`. Stats queries use the materialized views. The advanced queries file covers rage clicks, scroll depth, funnels.

## Key Decisions
- **No brain-core dependency** — standalone auth (NextAuth v5 with GitHub OAuth + email/bcrypt), own Postgres, own API key format.
- **Combined dashboard + API** — Next.js API routes handle all backend logic; no separate API service.
- **Wide ClickHouse table** — all event types in one `events` table, sparse columns, materialized views for common queries.
- **Zero runtime deps in tracker** — rrweb is an optional peer dep, lazy-loaded only after consent.
- **Server-enriched fields** — `ipHash`, `country`, `browser`, `os`, `deviceModel` are added at ingestion, not in the tracker.
- **Page versioning** — DOM hash on every event enables time-travel heatmaps without separate crawling.

## Testing
- **Vitest**: `packages/shared/src/__tests__/` and `packages/dashboard/src/__tests__/`. Global imports (`vi`, `describe`, `it`, `expect`) available without imports.
- `e2e-pipeline.test.ts` is excluded from the default run (requires live DBs). Run it manually against real ClickHouse/Postgres.
- **Playwright**: `tests/` directory, three viewport projects (mobile 390x844, tablet 768x1024, desktop 1440x900). Enable web server with `PW_WEB_SERVER=1`.

## Migrations
SQL migrations live in `scripts/migrations/`. Files named `YYYYMMDD-description-postgres.sql` and `YYYYMMDD-description-clickhouse.sql`. `scripts/migrate.sh` tracks applied migrations in a `_migrations` table and is idempotent.

## Agent Specs
- `agents.json` — machine-readable agent definitions (10 agents)
- `docs/internal/agent-specs.md` — detailed specs with dependency graph, acceptance criteria
- `docs/internal/architecture.md` — system design, data flow, technology choices
- `docs/internal/research.md` — architecture research (PostHog, Hotjar, rrweb, Plausible)

## Phases
- Phase 0: Scaffold (complete)
- Phase 1: Foundation — shared tests, tracker SDK, ingestion API (Agents 1-4, parallelizable)
- Phase 2: Backend — query APIs, project CRUD, auth (Agents 5-7)
- Phase 3: Dashboard UI — overview, heatmap, replay pages (Agents 8-10)
- Phase 4: Integration and production hardening (lead agent)
