# Roadmap

## Phase 0: Scaffold (complete)
- [x] Monorepo structure + root configs
- [x] Shared contract layer (types, schemas, DDL)
- [x] Tracker SDK stub
- [x] Dashboard stub (Next.js)
- [x] Docker Compose (Postgres + ClickHouse)
- [x] Clearify docs + agent specs
- [x] ERP suite integration

## Phase 1: Foundation
- [ ] Shared package tests + validation (Agent 1: shared-build)
- [ ] Tracker: pageviews, clicks, scroll, batching (Agent 2: tracker-core)
- [ ] Tracker: rrweb session replay integration (Agent 3: tracker-replay)
- [ ] API: ingestion endpoint POST /api/collect (Agent 4: api-ingestion)

## Phase 2: Backend
- [ ] API: stats, heatmap, session, replay query routes (Agent 5: api-queries)
- [ ] API: project + API key CRUD (Agent 6: api-projects)
- [ ] Dashboard: NextAuth authentication (Agent 7: dashboard-auth)

## Phase 3: Dashboard UI
- [ ] Analytics overview page — charts, stats cards, top pages (Agent 8: dashboard-overview)
- [ ] Heatmap visualization page — canvas overlay (Agent 9: dashboard-heatmap)
- [ ] Session replay player page — rrweb-player (Agent 10: dashboard-replay)

## Phase 4: Integration & Production Hardening
- [ ] Wire SDK modules end-to-end (tracker -> ingestion -> queries -> dashboard)
- [ ] End-to-end integration tests
- [ ] Dockerfile for dashboard (production build)
- [ ] Docker Compose tuning (healthchecks, volumes, restart policies)
- [ ] Self-hosting guide documentation
- [ ] Install script (one-command setup)
- [ ] Production hardening (rate limiting, CORS, CSP headers)
- [ ] README finalization

## v2 (Deferred from MVP)
- [ ] A/B testing & experimentation (deterministic hashing, variant assignment)
- [ ] Scroll heatmaps & attention maps
- [ ] Mouse movement heatmaps
- [ ] Funnel analysis
- [ ] Retention cohorts
- [ ] Multi-tenant SaaS mode with billing
- [ ] Edge ingestion (Cloudflare Workers)
- [ ] Web analytics (UTM tracking, geographic data, device breakdowns)
- [ ] Error tracking
- [ ] Custom dashboards / saved reports
- [ ] Real-time dashboard (WebSocket / SSE)
- [ ] Alerting (anomaly detection)
- [ ] Data export (CSV, API)
- [ ] Multi-region ClickHouse deployment

## Effort Estimate
- **Phases 1–3:** ~17.5h wall-clock / ~33.5 agent-hours (2–3 days with agent team)
- **Phase 4:** ~2h (lead agent)
