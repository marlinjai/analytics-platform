# Roadmap

## Phase 0: Scaffold (complete)
- [x] Monorepo structure + root configs
- [x] Shared contract layer (types, schemas, DDL)
- [x] Tracker SDK stub
- [x] Dashboard stub (Next.js)
- [x] Docker Compose (Postgres + ClickHouse)
- [x] Clearify docs + agent specs
- [x] ERP suite integration

## Phase 1: Foundation (complete)
- [x] Shared package tests + validation (Agent 1: shared-build)
- [x] Tracker: pageviews, clicks, scroll, batching (Agent 2: tracker-core)
- [x] Tracker: rrweb session replay integration (Agent 3: tracker-replay)
- [x] API: ingestion endpoint POST /api/collect (Agent 4: api-ingestion)

## Phase 2: Backend (complete)
- [x] API: stats, heatmap, session, replay query routes (Agent 5: api-queries)
- [x] API: project + API key CRUD (Agent 6: api-projects)
- [x] Dashboard: NextAuth authentication (Agent 7: dashboard-auth)

## Phase 3: Dashboard UI (complete)
- [x] Analytics overview page — charts, stats cards, top pages (Agent 8: dashboard-overview)
- [x] Heatmap visualization page — toolbar/bookmarklet activation page (Agent 9, refactored)
- [x] Session replay player page — rrweb-player (Agent 10: dashboard-replay)

## Phase 4: Integration & Production (complete)
- [x] Wire SDK modules end-to-end (tracker -> ingestion -> queries -> dashboard)
- [x] Dockerfile for dashboard (production build)
- [x] Docker Compose tuning (healthchecks, volumes, restart policies)
- [x] Self-hosting guide documentation
- [x] Install script (one-command setup)
- [x] Production hardening (rate limiting, CORS, CSP headers)
- [x] README finalization
- [x] Terraform deployment module (Hetzner + Cloudflare DNS)
- [x] Production deployment at analytics.lumitra.co
- [x] Tracker SDK published to npm (@marlinjai/analytics-tracker)
- [x] First client integration (Lola Stories landing page)

### Production fixes (2026-03-20/21)
- [x] TypeScript build errors (toolbar-token types, missing public dir)
- [x] bcrypt → bcryptjs for Next.js standalone compatibility
- [x] NextAuth secureCookie:true for Caddy reverse proxy
- [x] Middleware callbackUrl using forwarded host instead of container URL
- [x] Login page redirect:false for credentials provider
- [x] ClickHouse auth password sync between .env and compose
- [x] ClickHouse DateTime64 Z suffix stripping in queries
- [x] Stats overview query split (UNKNOWN_IDENTIFIER fix)
- [x] CORS headers on /api/collect + OPTIONS preflight handler
- [x] Tracker credentials:omit to prevent cookie interference
- [x] Settings page crash (API key object rendering)
- [x] Revoked keys hidden by default + copy buttons + integration snippet
- [x] Date range presets (12h, 24h, 3d, 7d, 30d, 90d)
- [x] Project ID visible + copyable in settings

## Phase 5: Polish & Reliability (complete)
- [x] Heatmap: refactor from iframe overlay to toolbar/bookmarklet approach
- [x] Heatmap query optimization (use materialized view)
- [x] Dashboard empty states (no projects, no data)
- [x] Settings page (project list, API key management)
- [x] End-to-end integration tests (17 unit tests for /api/collect, 69 total)
- [x] Tracker SDK bundle size CI check (<5KB gzip)
- [x] ClickHouse schema migration tooling (versioned SQL + migrate.sh)
- [x] Loading states and skeleton UI across all dashboard pages
- [x] API key rotation workflow
- [x] Onboarding flow (step-by-step first project + tracker setup)

## Phase 6: Analytics Depth (complete)
- [x] Web analytics: UTM tracking, referrer parsing
- [x] Geographic data (GeoIP via ip-api.com with in-memory cache; country breakdown table + flag emojis)
- [x] Device/browser/OS breakdowns (parse user agent server-side)
- [x] Traffic sources table (referrers grouped by domain)
- [x] Funnel analysis — funnels page with step builder and drop-off visualization
- [x] Scroll depth heatmap — quartile bars per page on heatmap page
- [x] Rage click detection — table on heatmap page (3+ clicks in 2s)
- [ ] Engagement zones — element-level click aggregation
- [x] Data export (CSV and JSON via /api/stats/export; export button in dashboard header)
- [x] Custom date ranges with calendar picker (two-click range selection)
- [x] Dashboard filters (browser, OS, country, page, source, device) — URL-encoded for shareable views
- [x] Click-to-filter (click any table row to filter entire dashboard)

### Q2 Features (complete)
- [x] Mobile navigation (hamburger + slide-out drawer)
- [x] Area chart with gradient fill, smooth curves, custom tooltip
- [x] Remote SDK configuration (project_settings table + toggle UI in Settings)
- [x] Skeleton loading states across all pages
- [x] 3-step onboarding flow (create project → install tracker → verify events)
- [x] API key rotation workflow

## Phase 7: Real-time & Scale
- [x] Real-time dashboard (WebSocket not needed — polling works; live visitor counter + auto-refresh toggle)
- [ ] Edge ingestion (Cloudflare Workers) for lower latency
- [ ] ClickHouse cluster / multi-region deployment
- [ ] Alerting (anomaly detection, threshold alerts)

## Phase 8: Browser Extension (in progress)
- [x] Chrome extension MVP — heatmap overlay on any page (WXT + React + Shadow DOM)
- [x] Extension auth flow (toolbar token stored in chrome.storage.local)
- [x] Extension popup (project picker, date range, device toggle)
- [x] Content script with bundled heatmap.js (no CDN, CSP-safe)
- [x] SPA navigation handling (persist overlay across client-side routing)
- [ ] Side panel for full analytics view alongside any page
- [ ] Scroll depth + rage click overlays in extension
- [ ] Chrome Web Store + Firefox Add-ons publishing
- [ ] Cross-browser support (Chrome, Firefox, Edge via webextension-polyfill)
See: docs/superpowers/plans/2026-03-22-browser-extension.md

## v2 (Deferred from MVP)
- [ ] A/B testing & experimentation
- [ ] Mouse move heatmap — cursor tracking with throttled sampling
- [ ] Retention cohorts
- [ ] Multi-tenant SaaS mode with billing
- [ ] Error tracking
- [ ] Custom dashboards / saved reports
- [ ] AI-powered insights + anomaly detection
- [ ] Team collaboration (invitations, roles, shared dashboards)
