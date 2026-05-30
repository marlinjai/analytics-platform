# Analytics Platform

Self-hosted analytics, heatmap, and session replay platform.

## Features

- **Lightweight tracker** — <6KB gzip browser SDK, zero runtime dependencies
- **Click heatmaps** — canvas-based visualization of click patterns
- **Session replay** — rrweb-powered DOM recording and playback
- **Privacy-first** — self-hosted, IP hashing (never stored raw), no third-party data sharing
- **Real-time analytics** — ClickHouse-powered event ingestion and aggregation
- **A/B testing & experimentation** — create experiments, variant assignment, Bayesian analysis
- **Feature flags** — boolean flags, percentage rollout, multi-variant support
- **Per-variant heatmaps & replay** — filter heatmaps and session replays by experiment variant
- **React hooks** — `useExperiment`, `useFlag`, and more for seamless frontend integration
- **CLI with Claude Code skills** — scaffold projects and generate AI skill definitions

## Architecture

```
Browser (Tracker SDK) → POST /api/collect → ClickHouse (events)
                                          → PostgreSQL (projects, users)
Dashboard (Next.js)   → Query APIs       → ClickHouse MVs
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Tracker SDK | TypeScript, rrweb (optional) |
| Dashboard | Next.js 15, React 19, Tailwind CSS v4 |
| Analytics DB | ClickHouse 24 |
| Config DB | PostgreSQL 16 |
| Auth | NextAuth v5 |

## Getting Started

```bash
# Install dependencies
pnpm install

# Start databases and initialize schemas
./scripts/setup.sh

# Copy and edit environment config
cp .env.example .env

# Start development
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production

```bash
docker compose up -d
```

See [Self-Hosting Guide](docs/public/self-hosting.md) for full details.

## Package Structure

| Package | Name | Description |
|---------|------|-------------|
| `packages/shared` | `@analytics-platform/shared` | Types, schemas, DDL (private) |
| `packages/tracker` | `@marlinjai/analytics-tracker` | Browser SDK (published) |
| `packages/dashboard` | `@analytics-platform/dashboard` | Next.js app (private) |
| `packages/react` | `@marlinjai/analytics-react` | React SDK with hooks for experiments and feature flags (published) |
| `packages/cli` | `@marlinjai/lumitra-cli` | CLI setup tool with Claude Code skill generator (published) |
| `packages/demo` | `@analytics-platform/demo` | Test page with traffic simulator (private) |

## License

MIT
