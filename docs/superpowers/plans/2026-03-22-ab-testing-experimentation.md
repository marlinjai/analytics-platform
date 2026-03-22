---
title: "A/B Testing & Experimentation Platform"
summary: "Plan for integrating experiment management, feature flags, and per-variant analytics into Lumitra"
type: plan
status: proposed
date: 2026-03-22
tags: [ab-testing, experimentation, feature-flags, analytics]
projects: [analytics-platform]
---

# A/B Testing & Experimentation Platform

## Executive Summary

This plan describes how to add A/B testing and experimentation capabilities to the Lumitra analytics platform. The core insight driving this plan: **most analytics tools (Hotjar, Clarity, Plausible, Umami) do not have A/B testing, and most A/B testing tools (Optimizely, VWO, LaunchDarkly) do not have element-level heatmaps or session replay**. Lumitra is uniquely positioned to combine both — letting users not only measure which variant wins, but *see why* through per-variant heatmaps and replays.

The implementation is designed to be incremental, building on existing infrastructure: the tracker SDK already sends events to `/api/collect`, ClickHouse already stores events with session and property data, the remote config endpoint (`/api/projects/{id}/config`) already serves feature toggles, and the browser extension already renders heatmap overlays. Each of these becomes a building block for experimentation.

---

## 1. Competitor Landscape

### Analytics + Experimentation Combined

| Platform | Analytics | Heatmaps | Session Replay | A/B Testing | Feature Flags | Pricing Model |
|---|---|---|---|---|---|---|
| **PostHog** | Full | Yes (coordinate) | Yes | Yes (built-in) | Yes (built-in) | Usage-based, generous free tier |
| **Hotjar** | Limited (behavior) | Yes (click, scroll, move) | Yes | No | No | Per-session |
| **Microsoft Clarity** | Limited (behavior) | Yes (click, scroll) | Yes | No | No | Free |
| **Plausible** | Full (privacy-first) | No | No | No | No | Flat-rate |
| **Umami** | Full (privacy-first) | No | No | No | No | Free / self-hosted |
| **Mixpanel** | Full (product) | Yes (recent) | No | Yes (limited) | No | Usage-based |
| **Amplitude** | Full (product) | No | No | Yes (Amplitude Experiment) | Yes | Usage-based |

### A/B Testing / Experimentation Specialists

| Platform | Analytics | Heatmaps | Session Replay | A/B Testing | Feature Flags | Pricing |
|---|---|---|---|---|---|---|
| **Optimizely** | Limited | No | No | Yes (market leader) | Yes | Enterprise ($50K+/yr) |
| **VWO** | Limited | Yes (basic) | Yes (basic) | Yes | No | $199+/mo |
| **LaunchDarkly** | No | No | No | Yes | Yes (market leader) | Per-seat + MAU |
| **Statsig** | Basic | No | No | Yes | Yes | Usage-based, generous free |
| **Eppo** | No (warehouse-native) | No | No | Yes | Yes | Enterprise |
| **GrowthBook** | No | No | No | Yes | Yes | Free / self-hosted |
| **Google Optimize** | Via GA4 | No | No | Sunset (Sept 2023) | No | Was free |
| **Split.io** | No | No | No | Yes | Yes | Enterprise |

### Industry Trends

1. **Convergence is the trend.** PostHog proved that combining analytics, session replay, feature flags, and A/B testing in one platform eliminates context-switching and reduces tooling costs. They grew from $0 to $100M+ ARR on this thesis.

2. **Google Optimize's sunset** (September 2023) left a gap. Many small-to-mid-size teams moved to PostHog, Statsig, or GrowthBook — not back to Optimizely (too expensive).

3. **Feature flags are the foundation.** Every modern experimentation platform (LaunchDarkly, Statsig, Eppo, GrowthBook) treats feature flags as the primitive on which experiments are built. An experiment is a feature flag with traffic allocation + metric tracking.

4. **Bayesian statistics are winning.** Optimizely, Statsig, and GrowthBook all default to Bayesian analysis (faster decisions, more intuitive output). VWO and older tools use frequentist (fixed sample size, p-values).

5. **Warehouse-native experimentation** is emerging (Eppo, Statsig Warehouse Native). This won't be relevant for Lumitra's initial target market (SMBs, indie devs) but is worth noting for enterprise positioning later.

### Where Lumitra Can Differentiate

**No existing platform combines all three:**
- Per-variant heatmaps (see *where* users click in variant A vs variant B)
- Per-variant session replay (watch *how* users behave in each variant)
- Statistical experiment results (know *which* variant wins)

This is a genuine gap. VWO has basic heatmaps but they are not linked to experiment variants. PostHog has everything but their heatmaps are coordinate-based (not element-based). Lumitra's element-based heatmaps + CSS selector tracking in the extension create a richer visual story per variant.

---

## 2. Architecture Patterns

### 2.1 Client-Side vs Server-Side vs Edge Experimentation

| Approach | How It Works | Pros | Cons | Used By |
|---|---|---|---|---|
| **Client-side** | SDK assigns variant in browser, modifies DOM | Simple, no backend changes | Flicker (FOUC), limited to visual changes | Optimizely, VWO, Google Optimize |
| **Server-side** | App server requests variant before rendering | No flicker, full-stack changes | Requires code changes, more integration | LaunchDarkly, Statsig, GrowthBook |
| **Edge** | CDN/edge worker assigns variant, rewrites response | No flicker, no origin changes | Complex infrastructure, limited logic | Vercel Edge Config, CloudFlare |

**Recommendation for Lumitra:** Start with **client-side** assignment via the tracker SDK. This aligns with how Lumitra already works (lightweight script tag, no server integration required). Add server-side SDK support later as a separate package.

### 2.2 Feature Flags as the Foundation

The architecture treats **feature flags** as the core primitive:

```
Feature Flag (always-on or percentage rollout)
    └── Experiment (flag with variants + metric tracking + statistical analysis)
```

A feature flag is: a key (string), a set of variants (control + treatments), and targeting rules (percentage, user attributes). An experiment adds: a hypothesis, conversion metrics, a start/end date, and statistical analysis.

This means feature flags ship first (useful on their own for gradual rollouts, kill switches, beta features) and experiments are built on top.

### 2.3 Deterministic Variant Assignment

The industry-standard approach (LinkedIn, Google, Statsig, GrowthBook) for assigning users to variants:

```
variant = hash(experiment_key + user_id) % 100
```

Specifically:
1. Concatenate `experiment_key + ":" + user_id` (or `session_id` for anonymous users)
2. Hash with a fast algorithm (MurmurHash3, FNV-1a, or MD5 truncated)
3. Take the result modulo the total traffic allocation (e.g., `% 10000` for 0.01% granularity)
4. Map the bucket to a variant based on the experiment's traffic split

**Why hashing, not random assignment:**
- **Deterministic**: same user always sees the same variant (no database lookup, no cookie)
- **Stateless**: no server-side state required for assignment
- **Cross-device consistent** (if user is identified): `hash(exp + userId)` produces the same result everywhere
- **Experiment isolation**: different experiment keys produce different bucket assignments, avoiding correlation

**For anonymous users (Lumitra's default):** Use the existing `session_id` (stored in `sessionStorage`) as the user identifier. This means variant assignment is consistent within a session but not across sessions. This is acceptable for most client-side experiments and avoids requiring user identification. When `identify()` is called, switch to the stable user ID.

### 2.4 Statistical Significance

Two main approaches:

**Frequentist (traditional):**
- Fixed sample size calculated upfront (power analysis)
- Run experiment until sample size reached
- Calculate z-score or chi-squared test
- Report p-value (typically p < 0.05 threshold)
- Prone to "peeking" problem (checking results early inflates false positive rate)

**Bayesian (modern):**
- No fixed sample size — can check results at any time
- Calculates "probability that B is better than A" (more intuitive)
- Uses Beta distribution for conversion rates
- Reports: probability to be best, expected lift, credible interval
- More natural for product teams ("92% chance variant B is better")

**Recommendation for Lumitra:** Implement **Bayesian** analysis. It matches the product's philosophy (simple, intuitive, actionable). The math is straightforward for binary conversion metrics:

```
Prior: Beta(1, 1)  // uniform prior (no assumptions)
Posterior: Beta(1 + conversions, 1 + non_conversions)

P(B > A) = Monte Carlo simulation with 10,000 samples
  → Draw from posterior_A, draw from posterior_B
  → Count how often B > A
```

For continuous metrics (revenue, session duration), use a normal approximation with the same Monte Carlo approach.

### 2.5 Per-Variant Heatmaps (Differentiator)

This is the key differentiator. The existing heatmap infrastructure tracks clicks with `(x, y, selector, url, device_type)`. By adding `experiment_id` and `variant` to the event properties, all existing heatmap queries can be filtered by variant:

```sql
-- Existing heatmap query (simplified)
SELECT x_bucket, y_bucket, sum(click_count)
FROM analytics.heatmap_clicks_mv
WHERE project_id = ? AND url = ?
GROUP BY x_bucket, y_bucket

-- Per-variant heatmap query
SELECT x_bucket, y_bucket, sum(click_count)
FROM analytics.heatmap_clicks_mv
WHERE project_id = ? AND url = ? AND experiment_id = ? AND variant = ?
GROUP BY x_bucket, y_bucket
```

The browser extension could render two heatmaps side-by-side or as a toggle: "Variant A" / "Variant B", showing how click patterns differ between variants.

---

## 3. Integration with Lumitra's Existing Architecture

### 3.1 Tracker SDK Changes

The tracker SDK (`@marlinjai/analytics-tracker`) currently has this initialization flow:

```
init(config) → getOrCreateSession() → attach listeners → start batching
```

For experimentation, the flow becomes:

```
init(config) → getOrCreateSession() → fetchRemoteConfig() → assignVariants() → attach listeners → start batching
```

The remote config endpoint (`GET /api/projects/{id}/config`) already exists and returns feature toggles. It can be extended to include experiment definitions:

```json
{
  "config": {
    "replay": false,
    "heatmap": true,
    "scrollDepth": true,
    "experiments": [
      {
        "id": "exp_pricing_cta",
        "key": "pricing-cta-test",
        "variants": [
          { "key": "control", "weight": 50 },
          { "key": "green-button", "weight": 50 }
        ],
        "status": "running"
      }
    ]
  }
}
```

The tracker assigns variants locally using deterministic hashing and exposes them via API:

```typescript
// New tracker API
import { init, getVariant } from '@marlinjai/analytics-tracker';

const tracker = init({ projectId, endpoint, apiKey });

// Async — waits for remote config fetch
const variant = await tracker.getVariant('pricing-cta-test');
// → 'control' | 'green-button'

if (variant === 'green-button') {
  document.querySelector('.cta').style.backgroundColor = 'green';
}
```

**Bundle impact:** The hashing function (MurmurHash3 or FNV-1a) is ~200 bytes minified. Variant assignment logic is ~500 bytes. The `analytics-ab` module stays well under the planned ~2-3KB budget. It can be included in core or lazy-loaded.

### 3.2 Event Schema Changes (ClickHouse)

The existing `events` table uses sparse columns. Add two new columns:

```sql
-- Migration: 006-clickhouse.sql
ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS experiment_id String DEFAULT '';

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS variant String DEFAULT '';
```

These columns are `String DEFAULT ''` (not Nullable) — consistent with the existing schema pattern. They remain empty for non-experiment events, taking zero storage due to ClickHouse's columnar compression.

**Every event** emitted while a user is in an experiment carries the `experiment_id` and `variant` fields. This means pageviews, clicks, scroll events, and custom events all automatically get variant attribution — enabling per-variant analysis of any metric without schema changes.

The existing materialized views need to be recreated to include the new columns (or new experiment-specific MVs can be created alongside them):

```sql
-- New MV: per-variant heatmap aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_clicks_by_variant_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, experiment_id, variant, device_type, x_bucket, y_bucket, day)
AS SELECT
    project_id, url, experiment_id, variant, device_type,
    toDate(timestamp) AS day,
    intDiv(toUInt32(assumeNotNull(x)), 10) * 10 AS x_bucket,
    intDiv(toUInt32(assumeNotNull(y)), 10) * 10 AS y_bucket,
    count() AS click_count
FROM analytics.events
WHERE type = 'click' AND x IS NOT NULL AND y IS NOT NULL AND experiment_id != ''
GROUP BY project_id, url, experiment_id, variant, device_type, day, x_bucket, y_bucket;

-- New MV: per-variant conversion aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.experiment_conversions_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, experiment_id, variant, day)
AS SELECT
    project_id,
    experiment_id,
    variant,
    toDate(timestamp) AS day,
    uniqExact(session_id) AS unique_sessions,
    count() AS total_events,
    countIf(type = 'pageview') AS pageviews,
    countIf(type = 'click') AS clicks
FROM analytics.events
WHERE experiment_id != ''
GROUP BY project_id, experiment_id, variant, day;
```

### 3.3 PostgreSQL Schema Additions

Experiment configuration and goal definitions live in PostgreSQL (consistent with how funnels, API keys, and project settings are stored):

```sql
-- Migration: 006-postgres.sql

-- Experiments table
CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,               -- unique within project, used for hashing
    name TEXT NOT NULL,              -- human-readable name
    description TEXT DEFAULT '',
    hypothesis TEXT DEFAULT '',       -- "Changing CTA to green will increase signups"
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'paused', 'completed')),
    variants JSONB NOT NULL,          -- [{ key, weight, description }]
    targeting JSONB DEFAULT '{}',     -- { percentage: 100, url_match: "/pricing*" }
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    winner_variant TEXT,              -- set when experiment is completed
    UNIQUE (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);

-- Experiment goals (conversion metrics)
CREATE TABLE IF NOT EXISTS experiment_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal_type TEXT NOT NULL CHECK (goal_type IN ('pageview', 'custom_event', 'click')),
    target TEXT NOT NULL,             -- URL pattern, event name, or CSS selector
    is_primary BOOLEAN DEFAULT false, -- primary metric for significance calculation
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_goals_experiment ON experiment_goals(experiment_id);

-- Feature flags table (flags without experiment tracking)
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    rollout_percentage INTEGER DEFAULT 100
        CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    variants JSONB,                   -- null for simple on/off, or [{ key, weight }]
    targeting JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_project ON feature_flags(project_id);
```

### 3.4 API Endpoints

New API routes following the existing pattern (`/api/projects/[projectId]/...`):

```
# Experiments CRUD
GET    /api/projects/{id}/experiments              — List experiments
POST   /api/projects/{id}/experiments              — Create experiment
GET    /api/projects/{id}/experiments/{expId}       — Get experiment details
PATCH  /api/projects/{id}/experiments/{expId}       — Update experiment
DELETE /api/projects/{id}/experiments/{expId}       — Delete experiment

# Experiment lifecycle
POST   /api/projects/{id}/experiments/{expId}/start — Start experiment
POST   /api/projects/{id}/experiments/{expId}/stop  — Stop & declare winner

# Experiment results
GET    /api/projects/{id}/experiments/{expId}/results — Statistical results

# Experiment goals
GET    /api/projects/{id}/experiments/{expId}/goals  — List goals
POST   /api/projects/{id}/experiments/{expId}/goals  — Add goal

# Feature flags CRUD
GET    /api/projects/{id}/flags                     — List flags
POST   /api/projects/{id}/flags                     — Create flag
PATCH  /api/projects/{id}/flags/{flagId}             — Update flag
DELETE /api/projects/{id}/flags/{flagId}              — Delete flag

# Remote config (existing, extended)
GET    /api/projects/{id}/config                    — Now includes experiments + flags
```

### 3.5 Remote Config Extension

The existing `/api/projects/{id}/config` endpoint returns `{ config: { replay, heatmap, scrollDepth } }`. Extend it to include active experiments and feature flags:

```json
{
  "config": {
    "replay": false,
    "heatmap": true,
    "scrollDepth": true
  },
  "experiments": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "key": "pricing-cta-test",
      "variants": [
        { "key": "control", "weight": 50 },
        { "key": "green-button", "weight": 50 }
      ]
    }
  ],
  "flags": [
    {
      "key": "new-checkout-flow",
      "enabled": true,
      "rolloutPercentage": 30,
      "variants": null
    }
  ]
}
```

This endpoint is already public (no auth required) and cached for 60 seconds — both properties that work well for SDK consumption. The cache TTL means experiment changes propagate within 60 seconds, which is acceptable.

### 3.6 Browser Extension Integration

The browser extension already renders heatmap overlays on any page. For A/B testing, add:

1. **Variant filter in popup** — Dropdown in the extension popup: "All traffic" / "Variant A" / "Variant B"
2. **Split-view mode** — Side-by-side heatmap comparison (variant A left, variant B right, rendered as two overlapping semi-transparent canvases)
3. **Variant badge** — Small badge on the extension icon showing which variant the current user sees
4. **API extension** — Pass `experiment_id` and `variant` query parameters to existing `/api/heatmap` endpoint

### 3.7 Conversion Tracking

The tracker SDK already supports custom events (`tracker.track({ type: 'custom', eventName: 'signup' })`). Conversion tracking does not require new SDK code — it works by matching events against experiment goals on the server side.

When the results API is called, the server:
1. Queries ClickHouse for all events in the experiment's date range with the experiment's `experiment_id`
2. Groups by `variant`
3. For each variant, counts sessions and checks which sessions triggered the goal event
4. Calculates conversion rate = (sessions with goal) / (total sessions in variant)
5. Runs Bayesian analysis to determine significance

---

## 4. MVP Scope

### Phase 1: Feature Flags (1 week)

**Goal:** Ship feature flags as a standalone feature. This is useful on its own and establishes the foundation for experiments.

**Postgres:**
- Migration 006: `feature_flags` table

**API:**
- `GET/POST /api/projects/{id}/flags` — CRUD
- `PATCH/DELETE /api/projects/{id}/flags/{flagId}` — Update/delete
- Extend `GET /api/projects/{id}/config` to include flags

**Dashboard UI:**
- New "Feature Flags" page (under Settings or as a top-level nav item)
- Create flag form (key, name, enabled, rollout percentage)
- Flag list with toggle switches
- Integration snippet (code example for checking flags)

**Tracker SDK:**
- Fetch config on init (already done for heatmap/replay toggles)
- `tracker.getFlag(key)` method — returns boolean (or variant string for multivariate flags)
- Deterministic assignment for percentage rollouts: `hash(flag_key + session_id) % 100 < rolloutPercentage`

**Deliverables:**
- Feature flags work end-to-end
- Dashboard users can create, enable, and disable flags
- Client-side code can check flag values via the tracker SDK
- No ClickHouse changes needed (flags don't track events)

### Phase 2: Experiment Creation & Assignment (1 week)

**Goal:** Users can create experiments and the tracker assigns variants.

**Postgres:**
- Migration 006 (continued): `experiments` and `experiment_goals` tables

**API:**
- `GET/POST /api/projects/{id}/experiments` — CRUD
- `PATCH/DELETE /api/projects/{id}/experiments/{expId}` — Update/delete
- `POST /api/projects/{id}/experiments/{expId}/start` — Start experiment
- `POST /api/projects/{id}/experiments/{expId}/stop` — Stop experiment
- Extend `GET /api/projects/{id}/config` to include running experiments

**Dashboard UI:**
- New "Experiments" page
- Experiment creation wizard:
  1. Name, key, hypothesis
  2. Define variants (control + 1-3 treatments) with traffic split
  3. Select conversion goal (pageview URL, custom event name, or click selector)
  4. Review & launch
- Experiment list showing status (draft, running, paused, completed)
- Start/pause/stop controls

**Tracker SDK:**
- `tracker.getVariant(experimentKey)` — returns variant key string
- Deterministic assignment: `murmurhash3(experiment_key + ":" + session_id) % 10000`
- Attach `experiment_id` and `variant` to all subsequent events in the session
- Support multiple concurrent experiments (each gets independent assignment)
- Store assigned variants in `sessionStorage` for consistency within session

**ClickHouse:**
- Migration 006: Add `experiment_id` and `variant` columns to `events` table

**Deliverables:**
- Users can create experiments in the dashboard
- Tracker assigns variants deterministically
- All events carry variant metadata
- Experiments can be started and stopped

### Phase 3: Results & Statistical Analysis (1 week)

**Goal:** Users can see which variant is winning with statistical confidence.

**API:**
- `GET /api/projects/{id}/experiments/{expId}/results` — Returns per-variant metrics and Bayesian analysis

**Statistical Engine (new module: `lib/experiment-stats.ts`):**
- Query ClickHouse for per-variant session counts and goal completions
- Calculate per-variant conversion rate
- Bayesian analysis:
  - Beta posterior per variant: `Beta(1 + conversions, 1 + non_conversions)`
  - Monte Carlo sampling (10,000 draws) to compute P(B > A)
  - Expected lift with credible interval (95%)
  - "Probability to be best" for each variant
- Minimum sample size warning (< 100 sessions per variant)

**Dashboard UI:**
- Experiment results page:
  - Summary card: "Variant B has a 94% probability of being better than Control"
  - Per-variant metrics table: sessions, conversions, conversion rate, lift vs control
  - Conversion rate timeline chart (daily conversion rate per variant over time)
  - Cumulative probability chart (P(B > A) over time as data accumulates)
  - Sample size indicator with adequacy warning
- "Declare Winner" button when confidence is high enough
- Status transitions: running -> completed (with winner)

**ClickHouse:**
- Materialized view for experiment conversions (aggregated daily)

**Deliverables:**
- Users see real-time experiment results with Bayesian statistics
- Clear visualization of which variant is winning
- Ability to declare winner and stop experiment

### Phase 4: Per-Variant Heatmaps (1 week)

**Goal:** The killer differentiator — see how click patterns differ between variants.

**ClickHouse:**
- Materialized view for per-variant heatmap aggregation

**API:**
- Extend `GET /api/heatmap` to accept optional `experiment_id` and `variant` query params
- Extend `GET /api/heatmap/by-selector` similarly

**Dashboard UI:**
- On experiment results page: "View Heatmaps" button
- Heatmap comparison view:
  - Side-by-side iframe previews with heatmap overlays
  - Toggle between variants
  - Difference mode (subtract variant A from variant B to highlight divergence)

**Browser Extension:**
- Variant filter dropdown in popup
- Load heatmap data filtered by variant
- Toggle between "All traffic" / specific variant

**Deliverables:**
- Per-variant heatmaps visible in dashboard and extension
- Visual comparison of click behavior between variants
- This feature does not exist in any competitor at this level of integration

---

## 5. Detailed Technical Design

### 5.1 Variant Assignment Algorithm

```typescript
// lib/experiment-assignment.ts (tracker SDK)

/**
 * MurmurHash3 (32-bit) — fast, well-distributed, tiny implementation.
 * Used by GrowthBook, Statsig, and most experimentation platforms.
 */
function murmurhash3(key: string, seed: number = 0): number {
  let h = seed;
  for (let i = 0; i < key.length; i++) {
    const k = Math.imul(key.charCodeAt(i), 0xcc9e2d51);
    h ^= Math.imul(k << 15 | k >>> 17, 0x1b873593);
    h = Math.imul(h << 13 | h >>> 19, 5) + 0xe6546b64;
  }
  h ^= key.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

interface Variant {
  key: string;
  weight: number; // 0-100 (or 0-10000 for finer granularity)
}

/**
 * Assign a user to a variant deterministically.
 * Same (experimentKey, userId) always produces the same result.
 */
function assignVariant(
  experimentKey: string,
  userId: string,
  variants: Variant[]
): string {
  const hash = murmurhash3(`${experimentKey}:${userId}`);
  const bucket = hash % 10000; // 0.01% granularity

  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight * 100; // weight 50 → 5000 out of 10000
    if (bucket < cumulative) {
      return variant.key;
    }
  }

  // Fallback (should not happen if weights sum to 100)
  return variants[0].key;
}
```

### 5.2 Bayesian Statistics Engine

```typescript
// lib/experiment-stats.ts (server-side)

interface VariantResult {
  key: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  liftVsControl: number | null;       // percentage lift
  probabilityToBeBest: number;        // 0-1
  credibleInterval: [number, number]; // 95% CI for conversion rate
}

interface ExperimentResults {
  experimentId: string;
  status: 'needs_data' | 'not_significant' | 'significant';
  variants: VariantResult[];
  totalSessions: number;
  minimumSampleReached: boolean;      // > 100 sessions per variant
  recommendation: string;             // human-readable recommendation
}

/**
 * Sample from Beta distribution using the Joehnk method.
 * No external dependencies needed.
 */
function sampleBeta(alpha: number, beta: number): number {
  // Use the gamma distribution method
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  // Marsaglia and Tsang's method
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn(): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const NUM_SAMPLES = 10_000;
const SIGNIFICANCE_THRESHOLD = 0.95;
const MIN_SESSIONS_PER_VARIANT = 100;

function analyzeExperiment(
  variants: { key: string; sessions: number; conversions: number }[]
): ExperimentResults {
  // Generate samples for each variant
  const samples: Record<string, number[]> = {};
  for (const v of variants) {
    const alpha = 1 + v.conversions;              // Beta prior: uniform
    const beta = 1 + (v.sessions - v.conversions);
    samples[v.key] = Array.from({ length: NUM_SAMPLES }, () =>
      sampleBeta(alpha, beta)
    );
  }

  // Count how often each variant is best
  const winCounts: Record<string, number> = {};
  for (const v of variants) winCounts[v.key] = 0;

  for (let i = 0; i < NUM_SAMPLES; i++) {
    let bestKey = variants[0].key;
    let bestVal = samples[variants[0].key][i];
    for (let j = 1; j < variants.length; j++) {
      if (samples[variants[j].key][i] > bestVal) {
        bestKey = variants[j].key;
        bestVal = samples[variants[j].key][i];
      }
    }
    winCounts[bestKey]++;
  }

  const controlVariant = variants[0]; // first variant is always control
  const controlRate = controlVariant.sessions > 0
    ? controlVariant.conversions / controlVariant.sessions
    : 0;

  const minimumSampleReached = variants.every(
    (v) => v.sessions >= MIN_SESSIONS_PER_VARIANT
  );

  const results: VariantResult[] = variants.map((v) => {
    const rate = v.sessions > 0 ? v.conversions / v.sessions : 0;
    const sortedSamples = [...samples[v.key]].sort((a, b) => a - b);
    return {
      key: v.key,
      sessions: v.sessions,
      conversions: v.conversions,
      conversionRate: rate,
      liftVsControl: v.key === controlVariant.key
        ? null
        : controlRate > 0
          ? ((rate - controlRate) / controlRate) * 100
          : 0,
      probabilityToBeBest: winCounts[v.key] / NUM_SAMPLES,
      credibleInterval: [
        sortedSamples[Math.floor(NUM_SAMPLES * 0.025)],
        sortedSamples[Math.floor(NUM_SAMPLES * 0.975)],
      ],
    };
  });

  const bestVariant = results.reduce((a, b) =>
    a.probabilityToBeBest > b.probabilityToBeBest ? a : b
  );

  let status: ExperimentResults['status'];
  let recommendation: string;

  if (!minimumSampleReached) {
    status = 'needs_data';
    recommendation = `Need at least ${MIN_SESSIONS_PER_VARIANT} sessions per variant. Continue running.`;
  } else if (bestVariant.probabilityToBeBest >= SIGNIFICANCE_THRESHOLD) {
    status = 'significant';
    recommendation = `"${bestVariant.key}" is the winner with ${(bestVariant.probabilityToBeBest * 100).toFixed(1)}% probability. Consider stopping the experiment.`;
  } else {
    status = 'not_significant';
    recommendation = `No clear winner yet. Highest probability: "${bestVariant.key}" at ${(bestVariant.probabilityToBeBest * 100).toFixed(1)}%. Continue running.`;
  }

  return {
    experimentId: '',
    status,
    variants: results,
    totalSessions: variants.reduce((sum, v) => sum + v.sessions, 0),
    minimumSampleReached,
    recommendation,
  };
}
```

### 5.3 Tracker SDK Module Structure

Following the existing lazy-loading pattern (replay module loads on demand):

```
packages/tracker/src/
├── index.ts             # init(), getTracker(), destroy() — existing
├── tracker.ts           # AnalyticsTracker class — existing, extended
├── session.ts           # Session management — existing
├── batch.ts             # Event batching — existing
├── device.ts            # Device detection — existing
├── listeners.ts         # DOM event listeners — existing
├── replay.ts            # Session replay — existing
├── experiment.ts        # NEW: variant assignment + getVariant() + getFlag()
└── constants.ts         # Event types — existing, extended
```

The `experiment.ts` module:
- Fetches experiment definitions from remote config (piggybacking on the existing config fetch)
- Assigns variants using MurmurHash3
- Stores assignments in `sessionStorage` (consistent with session ID storage)
- Injects `experiment_id` and `variant` into all events via the `track()` method
- Exposes `getVariant(key)` and `getFlag(key)` methods

**Bundle size estimate:**
- MurmurHash3: ~200 bytes
- Assignment logic: ~400 bytes
- Storage + API: ~300 bytes
- Total: ~900 bytes gzip (well under the 2-3KB budget)

This can be included in the core bundle (no lazy loading needed) since it's under 1KB.

### 5.4 Event Flow

```
                              ┌──────────────────┐
User visits page              │ /api/projects/    │
     │                        │  {id}/config      │
     ▼                        │                   │
┌─────────────┐  fetch config │ Returns:          │
│ Tracker SDK │──────────────>│  - feature toggles│
│             │               │  - experiments    │
│ - init()    │<──────────────│  - feature flags  │
│ - session   │               └──────────────────┘
│ - assign    │
│   variants  │  All events include experiment_id + variant
│             │
│ - pageview  │               ┌──────────────────┐
│ - click     │──────────────>│ POST /api/collect │
│ - scroll    │  batch events │                   │
│ - custom    │               │ enrichEvents()    │
│             │               │ insertEvents()    │
└─────────────┘               └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │    ClickHouse     │
                              │ analytics.events  │
                              │                   │
                              │ experiment_id: X  │
                              │ variant: "B"      │
                              │ type: "click"     │
                              │ x: 450, y: 300    │
                              │ selector: ".cta"  │
                              └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │ Materialized Views│
                              │                   │
                              │ - conversions MV  │
                              │ - heatmap by      │
                              │   variant MV      │
                              └──────────────────┘
```

### 5.5 Dashboard Pages

**Experiments List** (`/experiments`)
```
┌────────────────────────────────────────────────────────────────┐
│ Experiments                                    [+ New Experiment] │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ ● Pricing CTA Color Test          RUNNING  ▸ Results    │   │
│ │   Key: pricing-cta-test                                  │   │
│ │   Started: Mar 15  │  Sessions: 2,341  │  2 variants    │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ ○ Homepage Hero Copy               COMPLETED  Winner: B │   │
│ │   Key: hero-copy-v2                                      │   │
│ │   Mar 1 - Mar 10  │  Sessions: 8,450  │  3 variants     │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ ○ Checkout Flow Simplification      DRAFT                │   │
│ │   Key: checkout-v2                                       │   │
│ │   Not started  │  0 sessions  │  2 variants              │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Experiment Results** (`/experiments/{id}`)
```
┌────────────────────────────────────────────────────────────────┐
│ ← Experiments    Pricing CTA Color Test              [Pause ▾]│
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  🏆 "green-button" has a 94.2% probability of being     │   │
│  │  better than "control"                                   │   │
│  │                                                         │   │
│  │  Recommendation: Consider stopping — significance       │   │
│  │  threshold (95%) nearly reached.                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  ┌─────────────┬──────────┬────────────┬──────────┬────────┐   │
│  │ Variant     │ Sessions │ Conversions│ Conv Rate│ Lift   │   │
│  ├─────────────┼──────────┼────────────┼──────────┼────────┤   │
│  │ control     │  1,170   │    82      │  7.01%   │  --    │   │
│  │ green-button│  1,171   │    112     │  9.56%   │ +36.4% │   │
│  └─────────────┴──────────┴────────────┴──────────┴────────┘   │
│                                                                │
│  [Conversion Rate Over Time - line chart, one line per variant]│
│  [Probability Over Time - area chart showing P(B>A) growth]   │
│                                                                │
│  ┌─ Per-Variant Heatmaps ──────────────────────────────────┐   │
│  │  [Control]              │  [Green Button]               │   │
│  │  ┌──────────────────┐   │  ┌──────────────────┐         │   │
│  │  │  (heatmap iframe) │   │  │  (heatmap iframe) │        │   │
│  │  │  click density    │   │  │  click density    │        │   │
│  │  └──────────────────┘   │  └──────────────────┘         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  [View Per-Variant Session Replays →]                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Experiment Creation Wizard** (`/experiments/new`)
```
Step 1: Basics
  - Name: [Pricing CTA Color Test]
  - Key: [pricing-cta-test] (auto-generated from name, editable)
  - Hypothesis: [Changing the CTA button from blue to green will increase...]

Step 2: Variants
  - Control (50%) — "No change"
  - Variant B (50%) — "Green CTA button"
  [+ Add Variant]
  Traffic allocation: [100]% of visitors

Step 3: Conversion Goal
  - Goal type: [Custom Event ▾]
  - Event name: [signup_completed]
  (or: Pageview → URL pattern, Click → CSS selector)

Step 4: Review & Launch
  - Summary of all settings
  - [Save as Draft] [Start Experiment]
```

---

## 6. Implementation Phases with Effort Estimates

### Phase 1: Feature Flags (3-4 days)

| Task | Effort | Details |
|---|---|---|
| Postgres migration (feature_flags table) | 0.5d | DDL + migration script |
| Feature flags API routes | 1d | CRUD endpoints |
| Extend /config endpoint | 0.5d | Include flags in remote config response |
| Tracker SDK: getFlag() | 0.5d | MurmurHash3 + rollout logic |
| Dashboard: flags page | 1d | List, create, toggle UI |

### Phase 2: Experiment Creation & Assignment (4-5 days)

| Task | Effort | Details |
|---|---|---|
| Postgres migration (experiments, goals tables) | 0.5d | DDL + migration script |
| ClickHouse migration (experiment_id, variant columns) | 0.5d | ALTER TABLE |
| Experiments API routes | 1.5d | CRUD + lifecycle endpoints |
| Extend /config endpoint for experiments | 0.5d | Include running experiments |
| Tracker SDK: experiment module | 1d | Assignment, storage, event decoration |
| Dashboard: experiments list page | 0.5d | List with status badges |
| Dashboard: experiment creation wizard | 1d | 4-step form |

### Phase 3: Results & Statistics (3-4 days)

| Task | Effort | Details |
|---|---|---|
| ClickHouse MVs (experiment_conversions) | 0.5d | DDL + migration |
| Statistical analysis engine | 1d | Bayesian Beta model + Monte Carlo |
| Results API endpoint | 0.5d | Query ClickHouse + run analysis |
| Dashboard: results page | 1.5d | Summary, table, charts, actions |
| Winner declaration flow | 0.5d | Stop experiment + save winner |

### Phase 4: Per-Variant Heatmaps (2-3 days)

| Task | Effort | Details |
|---|---|---|
| ClickHouse MV (heatmap by variant) | 0.5d | DDL + migration |
| Extend heatmap API for variant filter | 0.5d | Add query params |
| Dashboard: side-by-side heatmaps | 1d | Iframe comparison view |
| Extension: variant filter in popup | 0.5d | Dropdown + filtered data fetch |

### Total: 12-16 days of engineering work

This can be split across 3-4 weeks alongside other work, or done as a focused 2-week sprint.

---

## 7. Data Model Summary

### Postgres (configuration & metadata)

```
feature_flags
├── id (UUID)
├── project_id → projects
├── key (unique per project)
├── name
├── enabled (boolean)
├── rollout_percentage (0-100)
├── variants (JSONB, nullable)
├── targeting (JSONB)
├── created_at
└── updated_at

experiments
├── id (UUID)
├── project_id → projects
├── key (unique per project)
├── name
├── description
├── hypothesis
├── status (draft|running|paused|completed)
├── variants (JSONB: [{ key, weight, description }])
├── targeting (JSONB: { percentage, url_match })
├── created_at
├── started_at
├── ended_at
└── winner_variant

experiment_goals
├── id (UUID)
├── experiment_id → experiments
├── name
├── goal_type (pageview|custom_event|click)
├── target (URL pattern | event name | CSS selector)
├── is_primary (boolean)
└── created_at
```

### ClickHouse (event data)

Two new columns on `analytics.events`:
```
experiment_id  String DEFAULT ''
variant        String DEFAULT ''
```

Two new materialized views:
```
analytics.experiment_conversions_mv     — daily per-variant session/event counts
analytics.heatmap_clicks_by_variant_mv  — per-variant click heatmap buckets
```

---

## 8. Future Enhancements (Beyond MVP)

### Server-Side SDK

```typescript
// @marlinjai/analytics-server
import { LumitraServer } from '@marlinjai/analytics-server';

const lumitra = new LumitraServer({
  apiKey: process.env.LUMITRA_API_KEY,
  endpoint: 'https://analytics.lumitra.co',
});

// Server-side variant assignment (same hash, consistent with client)
const variant = lumitra.getVariant('checkout-flow', userId);

if (variant === 'simplified') {
  return renderSimplifiedCheckout();
} else {
  return renderOriginalCheckout();
}
```

### Multi-Armed Bandit (Auto-Optimization)

Instead of fixed 50/50 splits, automatically shift traffic toward the winning variant using Thompson Sampling. This maximizes conversions during the experiment while still gathering data.

### Mutual Exclusion Groups

Prevent users from being in multiple experiments that affect the same page. Define exclusion groups: experiments in the same group share a traffic allocation layer.

### Sticky Bucketing

For identified users who clear cookies / switch devices, persist variant assignment server-side. GrowthBook's approach: store `{ experimentKey: variant }` map in a cookie or server-side table, check before hashing.

### Targeting Rules

Beyond percentage rollout, support rules like:
- URL pattern matching (only run on `/pricing` pages)
- Country targeting (only show to US visitors)
- Device targeting (mobile only)
- Custom user attributes (plan = "pro")

### Visual Editor

Client-side DOM manipulation (like Optimizely's visual editor):
- Point-and-click changes: text, colors, images, visibility
- Generates CSS/JS that's injected by the tracker
- No code changes required for simple visual experiments

This is high effort and deferred — the code-based approach covers most use cases.

### Per-Variant Session Replay

Filter the session replay list by experiment variant. Watch how users in Variant A navigate compared to Variant B. The data is already there (events carry `experiment_id` and `variant`), it just needs a UI filter.

---

## 9. Competitive Positioning

### Lumitra vs PostHog (closest competitor)

| Capability | PostHog | Lumitra (with this plan) |
|---|---|---|
| A/B testing | Yes | Yes |
| Feature flags | Yes | Yes |
| Bayesian statistics | Yes | Yes |
| Heatmaps | Coordinate-based | Element-based + coordinate |
| Per-variant heatmaps | No (separate tools) | Yes (integrated) |
| Session replay | Yes | Yes |
| Per-variant replay | Basic filter | Integrated in results |
| Browser extension | Toolbar (limited) | Full extension with variant toggle |
| Tracker size | ~50KB+ | <5KB (core) |
| Privacy-first | Optional | Default (cookie-free) |
| Self-hostable | Yes | Yes |

### Lumitra vs Optimizely/VWO

| Capability | Optimizely/VWO | Lumitra (with this plan) |
|---|---|---|
| A/B testing | Yes (mature) | Yes (lean) |
| Visual editor | Yes | No (future) |
| Multi-page experiments | Yes | No (future) |
| Heatmaps | No / Basic | Yes (element-based) |
| Session replay | No / Basic | Yes (rrweb-based) |
| Full analytics | No | Yes |
| Price | $50K+/yr / $199+/mo | Free (self-hosted) |

### The Unique Value Proposition

**"See which variant wins and understand why."**

No other platform lets you:
1. Create an experiment
2. See statistical results (which variant has higher conversion)
3. View per-variant heatmaps (where users click in each variant)
4. Watch per-variant session replays (how users behave in each variant)
5. All in one tool, with a <5KB tracker, privacy-first, self-hostable

---

## 10. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Flicker on client-side experiments | Users see original then variant | Medium | Document anti-flicker snippet (hide body until variant applied) |
| Config endpoint latency blocks page render | Slow initial page load | Low | Async assignment (don't block render); cache in sessionStorage |
| Statistical misuse (peeking at results) | Wrong decisions from early data | Medium | Bayesian approach is peek-resistant; show warnings at low sample sizes |
| Variant assignment inconsistency across sessions | Same user sees different variants | Medium | Expected for anonymous users; mitigated by identify() for logged-in users |
| ClickHouse query performance with new columns | Slow heatmap queries | Low | New MVs handle aggregation; experiment_id column has high compression (mostly empty) |
| Complexity creep in tracker SDK | Bundle size exceeds 5KB | Low | Experiment module is ~900 bytes; well within budget |

---

## 11. Open Questions

1. **Should feature flags be a separate page or integrated into Settings?** Feature flags have a different audience (developers) than experiments (product managers). A separate top-level nav item might make sense.

2. **Should we support server-side experiments in MVP?** The current plan is client-side only. Server-side requires a separate SDK package and documentation for each framework. Defer to post-MVP.

3. **How should experiments interact with the existing funnel builder?** An experiment could use a funnel as its conversion goal (user completes all funnel steps). This is a natural integration but adds complexity. Consider for Phase 5.

4. **Should the anti-flicker snippet be built into the tracker?** Optimizely includes a "page-hiding" snippet that hides the body until variants are applied. This prevents FOUC but adds complexity and risk (page stays hidden if SDK fails to load). Document it as an optional pattern rather than building it in.

5. **Multi-variant (A/B/C/D) or just A/B?** The architecture supports N variants (the hashing algorithm and Bayesian analysis both generalize). The UI should support 2-4 variants in MVP.

---

## Related Documents

- [Q2 2026 Roadmap](./2026-03-21-q2-roadmap.md) — Overall platform roadmap (experimentation listed as v2)
- [Browser Extension Plan](./2026-03-22-browser-extension.md) — Extension architecture (variant filter extends this)
- [Element-Based Heatmaps](./2026-03-22-element-based-heatmaps.md) — Selector-based click tracking (per-variant filtering extends this)
- [Research Findings](../../internal/research.md) — Original A/B testing research (hashing trick, LinkedIn variant assignment, GrowthBook sticky bucketing)
- [ROADMAP.md](../../../ROADMAP.md) — Top-level roadmap (A/B testing under v2 deferred items)
