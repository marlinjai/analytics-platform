Implement the Analytics Platform (projects/analytics-platform/) Phases 1-4.

Read CLAUDE.md, docs/internal/agent-specs.md, and agents.json for full context before starting.

## Execution Order (respect dependencies)

### Phase 1: Foundation

1. **Agent 1 (shared-build):** Add tests to packages/shared/. Create `packages/shared/src/__tests__/schemas.test.ts` and `packages/shared/src/__tests__/ddl.test.ts`. Run: `pnpm --filter @analytics-platform/shared build && pnpm --filter @analytics-platform/shared test`

2. **Agent 4 (api-ingestion):** Run in parallel with Agent 1. Create `POST /api/collect` route + `clickhouse.ts` + `enrich.ts` + `api-key.ts` + `db.ts` in `packages/dashboard/src/`. Add `@clickhouse/client` and `postgres` deps.

3. **Agent 2 (tracker-core):** After Agent 1 completes. Implement full tracker SDK — `tracker.ts`, `session.ts`, `batch.ts`, `listeners.ts`, `device.ts`, update `index.ts`. Must be <5KB gzip.

4. **Agent 3 (tracker-replay):** After Agent 2 completes. Add `replay.ts` with lazy rrweb import + chunking. Build must stay <5KB gzip.

After each agent: run `pnpm build && pnpm typecheck` to verify. Fix any errors before moving on.

### Phase 2: Backend (agents can run in parallel)

5. **Agent 5 (api-queries):** Stats, heatmap, sessions, replay query routes + ClickHouse query builders in `packages/dashboard/src/lib/queries/`.

6. **Agent 6 (api-projects):** Project + API key CRUD routes + `crypto.ts` in `packages/dashboard/src/lib/`.

7. **Agent 7 (dashboard-auth):** NextAuth v5 + login page + middleware. Add `next-auth`, `@auth/pg-adapter`, `bcrypt`.

After each agent: run `pnpm build && pnpm typecheck`. Fix errors before proceeding.

### Phase 3: Dashboard UI (agents can run in parallel)

8. **Agent 8 (dashboard-overview):** Dashboard layout + sidebar + overview page with recharts. Add `recharts` dep.

9. **Agent 9 (dashboard-heatmap):** Heatmap page + canvas overlay with heatmap.js. Add `heatmap.js` dep.

10. **Agent 10 (dashboard-replay):** Session list + replay player with rrweb-player. Add `rrweb-player` dep.

After each agent: run `pnpm build && pnpm typecheck`. Fix errors before proceeding.

### Phase 4: Integration & Production Hardening

- Wire end-to-end: tracker -> ingestion -> queries -> dashboard
- Create `packages/dashboard/Dockerfile` (multi-stage, Node 20 Alpine, standalone output)
- Tune `docker-compose.yml` — verify healthchecks, volumes, restart policies
- Create `scripts/setup.sh` for one-command DB initialization
- Write self-hosting guide in `docs/public/self-hosting.md`
- Production hardening: CORS, CSP headers, rate limiting review
- Finalize README with complete setup instructions

## Rules

- Read each agent's spec in `agents.json` before starting its work.
- After each agent's work: run `pnpm build` and `pnpm typecheck` to verify. Fix any errors before moving on.
- Commit after each completed agent with conventional commit message (`feat:` or `fix:`).
- If a build or typecheck fails, diagnose and fix before proceeding.
- Do NOT skip phases or agents.

## Completion

When all 4 phases are done, all builds pass, and docker compose config validates, output:
<promise>PLAN_COMPLETE</promise>
