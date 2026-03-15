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
- [x] Heatmap visualization page — ~~canvas overlay~~ toolbar/bookmarklet activation page (Agent 9, refactored)
- [x] Session replay player page — rrweb-player (Agent 10: dashboard-replay)

## Phase 4: Integration & Production (complete)
- [x] Wire SDK modules end-to-end (tracker -> ingestion -> queries -> dashboard)
- [x] Dockerfile for dashboard (production build)
- [x] Docker Compose tuning (healthchecks, volumes, restart policies)
- [x] Self-hosting guide documentation
- [x] Install script (one-command setup)
- [x] Production hardening (rate limiting, CORS, CSP headers)
- [x] README finalization
- [ ] End-to-end integration tests

## Phase 5: Polish & Reliability (next)
- [x] Heatmap: refactor from iframe overlay to toolbar/bookmarklet approach
- [x] Heatmap query optimization (use materialized view)
- [ ] End-to-end integration tests (deferred from Phase 4)
- [ ] Tracker SDK unit tests + bundle size CI check (<5KB gzip)
- [ ] ClickHouse materialized view verification + migration tooling
- [ ] Error boundary pages (proper 404, 500 pages instead of useInsertionEffect crashes)
- [ ] Loading states and skeleton UI across all dashboard pages
- [ ] Settings page (user profile, project settings, team management)
- [ ] API key rotation workflow in dashboard
- [ ] Dashboard empty states (no projects, no data, first-time onboarding)

## Phase 6: Analytics Depth
- [ ] Web analytics: UTM tracking, referrer parsing, geographic data, device breakdowns
- [ ] Funnel analysis — define step sequences, measure conversion
- [ ] Scroll heatmaps & attention maps (toolbar infrastructure now in place)
- [ ] Data export (CSV, JSON API)
- [ ] Custom date ranges with calendar picker
- [ ] Dashboard filters (browser, OS, country, page)

## Phase 7: Real-time & Scale
- [ ] Real-time dashboard (WebSocket / SSE live counters)
- [ ] Edge ingestion (Cloudflare Workers) for lower latency
- [ ] ClickHouse cluster / multi-region deployment
- [ ] Alerting (anomaly detection, threshold alerts)

## v2 (Deferred from MVP)
- [ ] A/B testing & experimentation (deterministic hashing, variant assignment)
- [ ] Mouse movement heatmaps
- [ ] Retention cohorts
- [ ] Multi-tenant SaaS mode with billing
- [ ] Error tracking
- [ ] Custom dashboards / saved reports
