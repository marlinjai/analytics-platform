# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.0] - 2026-03-22

### Added
- **GeoIP integration** — enrichment pipeline calls ip-api.com with in-memory 24-hour cache; country stored on every event
- **Country breakdown** — new `GET /api/stats/countries` route + `CountriesTable` component with flag emojis and bar charts
- **Data export** — `GET /api/stats/export?format=csv|json` downloads all stats (pages, sources, browsers, OS, devices, countries) as a single file; export button with dropdown added to Overview header
- **Dashboard filters** — filter state (page, country, browser, OS, device, source) encoded in URL search params for shareable views
- **Click-to-filter** — clicking any row in TopPages, Sources, Countries, Browsers, OS, or Devices tables sets a filter and re-fetches all stats
- **Filter pill bar** — active filters shown as dismissible pills with per-filter X buttons and "Clear all"; disappears when no filters are active
- `CountryRow` and `DashboardFilters` types exported from `@analytics-platform/shared`

### Changed
- All `/api/stats/*` routes accept optional `page`, `country`, `browser`, `os`, `device`, `source` query params (backward compatible)
- All stats query functions in `lib/queries/stats.ts` accept an optional `DashboardFilters` argument
- Overview page grid now includes Countries table alongside Sources, Browsers, OS, and Devices

## [0.4.0] - 2026-03-22

### Added
- Browser extension MVP (Chrome MV3) — heatmap overlay on any page regardless of CSP
- Real-time visitor counter with green pulsing dot (15s polling)
- Auto-refresh toggle for dashboard (30s interval)
- SWR migration for data fetching (replaces raw fetch/useState)
- Team collaboration: invite members, manage roles, accept invitation flow
- Health check endpoint (GET /api/health — Postgres + ClickHouse status)
- CORS OPTIONS preflight handler on /api/heatmap
- Accept-invite page for team invitations

### Changed
- Phase 6 marked complete in roadmap (funnels, scroll depth, rage clicks, calendar, filters)
- Q2 features marked complete (mobile nav, area chart, remote SDK config, skeleton UI, onboarding)

## [0.3.0] - 2026-03-22

### Added
- Production deployment via Terraform (Hetzner + Cloudflare DNS) at analytics.lumitra.co
- Tracker SDK published to npm as @marlinjai/analytics-tracker
- First client integration (Lola Stories landing page)
- Skeleton loading states across all dashboard pages
- 3-step onboarding flow (create project → install tracker → verify events)
- API key rotation workflow
- Traffic sources table with favicons
- Browser, OS, device breakdown tables
- UTM parameter tracking in tracker SDK
- User agent parsing (browser + OS detection)
- 4 new API routes: /stats/sources, /stats/browsers, /stats/os, /stats/devices
- ClickHouse migration tooling (versioned SQL + migrate.sh)
- Tracker bundle size CI check (<5KB gzip)
- 17 new unit tests for /api/collect endpoint (69 total)
- Date range presets: 12h, 24h, 3d added alongside 7d, 30d, 90d
- Copy buttons for project ID and API keys
- Integration snippet shown after API key creation

### Fixed
- bcrypt → bcryptjs for Next.js standalone build compatibility
- NextAuth secureCookie for Caddy reverse proxy authentication
- Middleware callbackUrl using forwarded host instead of container URL
- Login redirect with credentials provider (redirect:false)
- ClickHouse DateTime64 Z suffix in query parameters
- Stats overview query split to fix UNKNOWN_IDENTIFIER error
- CORS headers + OPTIONS preflight on /api/collect
- Tracker credentials:omit to prevent cookie interference
- Settings page crash from API key object rendering
- Missing public directory in Dockerfile build

### Changed
- Revoked API keys hidden by default with "Show revoked" toggle
- Tracker SDK decoupled from @analytics-platform/shared (zero runtime deps)

### Fixed
- Monorepo env loading — single `.env.local` at project root, loaded via `scripts/dev.mjs`
- NextAuth middleware secret handling for Edge runtime
- Root page redirect — authenticated users now land on the dashboard overview

### Changed
- Dashboard dev script uses wrapper (`scripts/dev.mjs`) for centralized env loading
- Seed script falls back to monorepo root `.env` when run standalone
- Heatmap: replaced iframe overlay with toolbar/bookmarklet approach for accurate on-site click visualization
- Heatmap query optimized to use ClickHouse materialized view instead of raw events table

### Added
- Demo page (`packages/demo`) — self-contained HTML landing page with simulated traffic for testing the full analytics pipeline (tracker -> /api/collect -> ClickHouse -> dashboard)
- Toolbar activation page with bookmarklet generator for viewing heatmaps on tracked sites
- Toolbar auth token endpoint (`POST /api/toolbar/token`) for secure cross-origin data access
- Toolbar script injection endpoint (`GET /api/toolbar/script`) with shadow DOM UI
- Toolbar renders heatmap.js overlay directly on the tracked page (no iframe)

### Removed
- `heatmap.js` dependency from dashboard package (loaded via CDN in toolbar script)
- `HeatmapOverlay.tsx` iframe-based component

## [0.1.0] — 2026-03-15

### Added

#### Phase 0: Scaffold
- Monorepo scaffold with pnpm workspaces (`shared`, `tracker`, `dashboard`)
- Shared contract layer: TypeScript types, Zod schemas, ClickHouse + Postgres DDL
- Docker Compose for PostgreSQL 16 + ClickHouse 24
- Commitlint + Husky for conventional commits
- Agent implementation specs (10 agents, 3 phases)

#### Phase 1: Foundation
- Tracker SDK (`@marlinjai/analytics-tracker`) — pageviews, clicks, scroll depth, batching
- Tracker session management with configurable timeout
- Optional rrweb session replay integration (lazy-loaded, zero runtime deps)
- Ingestion API (`POST /api/collect`) with validation, rate limiting, IP hashing
- Shared package Zod schema validation and type exports

#### Phase 2: Backend
- NextAuth v5 authentication (GitHub OAuth + credentials)
- Project CRUD API (`/api/projects`) with membership management
- API key generation and management (`ap_live_` / `ap_test_` prefix format)
- Query APIs: stats overview, timeseries, top pages, heatmap data, session list, replay chunks
- ClickHouse query builders with parameterized queries
- PostgreSQL config tables (users, projects, API keys, memberships)
- Dev user seeding script

#### Phase 3: Dashboard UI
- Analytics overview page — stats cards, timeseries chart (recharts), top pages table
- Heatmap visualization page — canvas overlay with URL selector and device toggle
- Session replay player — rrweb-player with timeline scrubbing
- Session list with cursor pagination and filtering
- Sidebar navigation, project switcher, date range picker
- Responsive dark-themed UI with Tailwind CSS v4

#### Phase 4: Integration & Production
- Dockerfile for standalone Next.js production build
- Production Docker Compose with healthchecks, volumes, restart policies
- Self-hosting documentation (`docs/public/self-hosting.md`)
- Setup script for one-command local development
- Getting started guide (`docs/public/getting-started.md`)
