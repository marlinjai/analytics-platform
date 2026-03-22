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

## Phase 5: Polish & Reliability (in progress)
- [x] Heatmap: refactor from iframe overlay to toolbar/bookmarklet approach
- [x] Heatmap query optimization (use materialized view)
- [x] Dashboard empty states (no projects, no data)
- [x] Settings page (project list, API key management)
- [ ] End-to-end integration tests
- [ ] Tracker SDK bundle size CI check (<5KB gzip)
- [ ] ClickHouse schema migration tooling (replace manual setup.sh)
- [ ] Loading states and skeleton UI across all dashboard pages
- [ ] API key rotation workflow
- [ ] Onboarding flow (step-by-step first project + tracker setup)

## Phase 6: Analytics Depth
- [ ] Web analytics: UTM tracking, referrer parsing
- [ ] Geographic data (GeoIP integration — MaxMind GeoLite2)
- [ ] Device/browser/OS breakdowns (parse user agent server-side)
- [ ] Traffic sources table (referrers grouped by domain)
- [ ] Funnel analysis — define step sequences, measure conversion
- [ ] Scroll depth heatmap — gradient overlay showing drop-off
- [ ] Rage click detection — highlight frustration points
- [ ] Engagement zones — element-level click aggregation
- [ ] Data export (CSV, JSON API)
- [ ] Custom date ranges with calendar picker
- [ ] Dashboard filters (browser, OS, country, page)
- [ ] Click-to-filter (click any table row to filter entire dashboard)

## Phase 7: Real-time & Scale
- [ ] Real-time dashboard (WebSocket / SSE live counters)
- [ ] Edge ingestion (Cloudflare Workers) for lower latency
- [ ] ClickHouse cluster / multi-region deployment
- [ ] Alerting (anomaly detection, threshold alerts)

## v2 (Deferred from MVP)
- [ ] A/B testing & experimentation
- [ ] Mouse move heatmap — cursor tracking with throttled sampling
- [ ] Retention cohorts
- [ ] Multi-tenant SaaS mode with billing
- [ ] Error tracking
- [ ] Custom dashboards / saved reports
- [ ] Browser extension for heatmap overlay (replaces bookmarklet)
- [ ] AI-powered insights + anomaly detection
- [ ] Team collaboration (invitations, roles, shared dashboards)
