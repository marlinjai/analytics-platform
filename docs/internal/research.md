---
title: Research Findings
---

# Research Findings

Architectural research conducted before Phase 0. Covers PostHog, Hotjar, rrweb, Plausible, and OpenReplay.

## Platform Comparison

| Aspect | PostHog | Hotjar | rrweb | Plausible | OpenReplay |
|---|---|---|---|---|---|
| **Recording** | rrweb fork (DOM snapshots + mutations) | WebSocket stream of DOM + mutations | DOM snapshots + MutationObserver | N/A (pageviews only) | Custom tracker (DOM snapshots + mutations) |
| **Script size** | Lazy-loaded modules (~50KB+) | Single script | ~50KB library | <1KB | ~26KB (Brotli) |
| **Event DB** | ClickHouse | Proprietary | N/A (client-only) | ClickHouse | ClickHouse |
| **Metadata DB** | PostgreSQL | Proprietary | N/A | PostgreSQL | PostgreSQL |
| **Message queue** | Kafka | WebSocket (real-time) | N/A | None (direct write) | Kafka |
| **Replay storage** | Blob storage (S3) | Server-side reconstruction | In-memory/custom | N/A | MinIO/S3 |
| **SPA support** | MutationObserver + pushState | MutationObserver + WebSocket | MutationObserver (native) | pushState listener | MutationObserver |
| **Heatmaps** | Yes (coordinate + CSS selector) | Yes (click, scroll, move) | No (recording only) | No | No (analytics only) |
| **Self-hostable** | Yes | No | N/A (library) | Yes | Yes |
| **Backend** | Rust + Node.js + Python | Unknown | N/A | Elixir | Python |

## Key Architectural Patterns

1. **ClickHouse is the consensus choice** for analytics event storage across all open-source platforms. Its columnar storage excels at aggregating millions of events.

2. **MutationObserver is the universal DOM tracking mechanism**. Every session recording tool relies on it. The pattern: full DOM snapshot as keyframe, then incremental mutation deltas (like video compression).

3. **Kafka is the standard ingestion buffer** for high-throughput platforms (PostHog, OpenReplay). Plausible skips it due to simpler requirements. **We skip it too** — in-process buffer with periodic ClickHouse flush is sufficient for self-hosted.

4. **PostgreSQL + ClickHouse is the common dual-database pattern**: PostgreSQL for ACID-compliant metadata, ClickHouse for high-volume analytical queries.

5. **Blob storage for replay data**: Both PostHog and OpenReplay store raw session recording blobs in S3/MinIO rather than in the database, keeping ClickHouse focused on queryable metadata.

## Technical Challenges & Solutions

### 1. DOM Serialization for SPAs (Hard)

**Problem:** Capturing DOM state across SPA route changes.

**Solution (rrweb approach):**
- Full snapshot at init: traverse entire DOM, serialize to JSON tree, assign unique IDs to every node
- Incremental snapshots via MutationObserver: only deltas after initial snapshot
- Convert `<script>` to `<noscript>` to prevent execution during replay
- Convert relative paths to absolute for cross-origin replay
- rrweb handles React re-renders, Vue reactivity, pushState navigations transparently

### 2. Click Position Normalization (Hard)

**Problem:** Absolute pixel coordinates are meaningless across different screen sizes and responsive breakpoints.

**Solution (dual approach):**
- **Coordinate-based:** Record `(clickX / pageWidth, clickY / pageHeight)` ratios, scale on display
- **Element-based:** Record CSS selector chain of clicked element, highlight bounding box in replay
- **Device segmentation:** Separate heatmaps for desktop/tablet/mobile (Hotjar pattern)
- We use coordinate-based with device segmentation + 10px grid bucketing in ClickHouse MV

### 3. SPA Route Detection (Medium)

**Problem:** SPAs don't fire `load` events on navigation.

**Solution:**
- Monkey-patch `history.pushState` and `history.replaceState` to dispatch custom events
- Listen for native `popstate` (back/forward)
- Fire `pageview` event on each URL change
- Hash-based routing: listen to `hashchange` event

### 4. Iframe Security for Page Preview (Medium-Hard)

**Problem:** Most sites set `X-Frame-Options: DENY` or `frame-ancestors 'self'`.

**Three approaches:**
1. **Live iframe with CSP modification** (PostHog) — requires user to allowlist our domain
2. **Server-side screenshots** (Contentsquare) — Puppeteer/Playwright, goes stale
3. **DOM reconstruction from replay** (Hotjar/Mixpanel) — uses rrweb snapshots, no CSP issues

**Our approach:** Start with live iframe (simplest), fall back to DOM reconstruction from replay data if CSP blocks it.

### 5. A/B Testing Variant Persistence (Medium-Hard) — v2

**Problem:** Same user must always see same variant.

**Solution:** Deterministic hashing (`salt + userId -> MD5 -> bucket`). Industry standard used by LinkedIn, Google, Statsig, GrowthBook. Deferred to v2.

## Tech Stack Decisions

### Why ClickHouse over alternatives

| Criteria | ClickHouse | DuckDB | TimescaleDB |
|---|---|---|---|
| Deployment | Separate container | Embedded, single file | Postgres extension |
| Write throughput | Millions/sec | Good for moderate loads | Good, row-based overhead |
| Query speed | Exceptional (columnar + vectorized) | Excellent single-node | Good, slower at scale |
| Multi-tenant scale | Excellent (horizontal) | Poor (single-process) | Moderate |
| Compression | 10-40x typical | Good | Moderate |

Plausible proves ClickHouse runs fine in a single Docker container with 2GB RAM.

### Client SDK Bundle Strategy

```
analytics-core     (~3-5KB gzip)  — pageviews, custom events, identify
analytics-heatmap  (~5-8KB gzip)  — click/move/scroll tracking
analytics-replay   (~30-40KB gzip) — session recording (wraps rrweb)
analytics-ab       (~2-3KB gzip)  — A/B test variant assignment (v2)
```

Core loads immediately. Heatmap/replay/AB modules load lazily via dynamic `import()`.

### Ingestion Pipeline

- **Self-hosted:** In-process buffer (array in memory), flush to ClickHouse every 1-5s or every 1000 events
- **SaaS mode (future):** Redis + BullMQ for reliable batched inserts
- **Skip Kafka entirely** — only justified at PostHog/Cloudflare scale (millions/sec)

### Client-Side Batching

- Buffer events for 5s, then send as batch
- `navigator.sendBeacon()` for page-unload (guaranteed delivery, async, non-blocking)
- `fetch()` with `keepalive: true` for regular batches
- Typical batch: 10-50 events, 2-10KB compressed

### Deployment Target

**3 containers** (Plausible-level simplicity):
```
app:        Next.js (API + dashboard + ingestion)
clickhouse: Analytics events
postgres:   Metadata, users, tenants
```

Minimum: 2GB RAM. Same codebase can scale to SaaS by swapping storage/queue adapters.

## Sources

### Platform Architecture
- [PostHog Architecture Docs](https://posthog.com/docs/how-posthog-works)
- [PostHog ClickHouse Integration](https://posthog.com/docs/how-posthog-works/clickhouse)
- [PostHog Ingestion Pipeline](https://posthog.com/docs/how-posthog-works/ingestion-pipeline)
- [PostHog Session Replay Architecture](https://posthog.com/handbook/engineering/session-replay/session-replay-architecture)
- [PostHog Heatmaps Docs](https://posthog.com/docs/toolbar/heatmaps)
- [Hotjar Recordings - Advanced Explanation](https://help.hotjar.com/hc/en-us/articles/36820006445585)
- [Plausible GitHub Repository](https://github.com/plausible/analytics)
- [OpenReplay Structure Documentation](https://docs.openreplay.com/en/structure/)

### DOM Recording
- [rrweb GitHub Repository](https://github.com/rrweb-io/rrweb)
- [rrweb Observer Documentation](https://github.com/rrweb-io/rrweb/blob/master/docs/observer.md)
- [rrweb Serialization Documentation](https://github.com/rrweb-io/rrweb/blob/master/docs/serialization.md)

### Heatmaps
- [Building Heatmaps at Scale - Mixpanel Engineering](https://mixpanel.substack.com/p/building-heatmaps-at-scale)
- [Microsoft Clarity Click Maps](https://learn.microsoft.com/en-us/clarity/heatmaps/click-maps)
- [Full Page Screenshots on Server Side - Contentsquare](https://engineering.contentsquare.com/2021/serverside-webpage-screenshot/)

### A/B Testing
- [Deterministic A/B Tests via the Hashing Trick](https://medium.com/simpl-under-the-hood/deterministic-a-b-tests-via-the-hashing-trick-d1ea49483202)
- [A/B Testing at LinkedIn: Assigning Variants at Scale](https://www.linkedin.com/blog/engineering/ab-testing-experimentation/a-b-testing-variant-assignment)
- [GrowthBook Sticky Bucketing](https://docs.growthbook.io/app/sticky-bucketing)
