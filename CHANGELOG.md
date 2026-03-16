# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
