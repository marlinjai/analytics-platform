# Heatmap Map Types Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Add Scroll, Rage Clicks, Engagement Zones, and Move heatmap types to the toolbar, building on the existing click heatmap infrastructure.

**Architecture:** Each map type is a combination of: (1) tracker event collection, (2) ClickHouse storage/aggregation, (3) query API endpoint, (4) toolbar visualization mode. The toolbar gets a map type switcher.

**Tech Stack:** TypeScript, ClickHouse materialized views, heatmap.js, Shadow DOM toolbar

---

## Current State

- **All Clicks**: Fully implemented — tracker captures pageX/pageY/selector, stored in ClickHouse events table, aggregated by heatmap_clicks_mv, queried via /api/heatmap, visualized in toolbar via heatmap.js overlay.
- **Scroll depth**: Tracker already captures scrollDepth (0-100%) as scroll events. Data is in ClickHouse but NOT queried or visualized.
- **Mouse move**: Not tracked at all.
- **Rage clicks**: Data exists (click events with timestamps + selectors) but no detection logic.
- **Engagement zones**: No element-level aggregation exists.

## Implementation Phases

### Phase A: Scroll Heatmap (Low effort — data already collected)

**Why first:** scrollDepth events are already being tracked and stored. This is purely a query + visualization task.

#### Tracker Changes
None — scroll events with scrollDepth (0-100%) are already sent.

#### ClickHouse
Create a new materialized view `scroll_depth_mv`:
```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.scroll_depth_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, device_type, day)
AS SELECT
    project_id,
    url,
    device_type,
    toDate(timestamp) AS day,
    maxState(scroll_depth) AS max_scroll_depth,
    avgState(scroll_depth) AS avg_scroll_depth,
    countState() AS session_count
FROM analytics.events
WHERE type = 'scroll' AND scroll_depth IS NOT NULL
GROUP BY project_id, url, device_type, day
```

Alternatively, a simpler approach — query raw events and bucket by scroll depth percentile:
```sql
SELECT
    intDiv(toUInt32(scroll_depth), 10) * 10 AS depth_bucket,
    uniqExact(session_id) AS sessions
FROM analytics.events
WHERE type = 'scroll' AND project_id = {projectId} AND url = {url}
    AND timestamp >= {from} AND timestamp <= {to}
GROUP BY depth_bucket
ORDER BY depth_bucket
```

This gives us: "X sessions reached 0-10%, Y reached 10-20%, etc." — classic scroll depth visualization.

#### API
Create `GET /api/heatmap/scroll` endpoint:
- Query params: projectId, url, from, to, deviceType (optional)
- Returns: `{ buckets: Array<{ depth: number, sessions: number, percentage: number }> }`
- The percentage is relative to total sessions that viewed the page

#### Toolbar Visualization
- Horizontal gradient overlay: full-width bands at each 10% depth interval
- Green (top, 100% of users) -> Yellow (middle) -> Red (bottom, where users drop off)
- Opacity proportional to drop-off rate
- Show percentage labels on the side: "90% of visitors reached here"

### Phase B: Rage Clicks (Low effort — query-level feature)

**Why second:** No tracker or schema changes needed. Pure query logic on existing click data.

#### Detection Logic
Rage click = same session + same selector + 3+ clicks within 1000ms window.

Query approach:
```sql
SELECT
    selector,
    url,
    count() AS rage_count,
    uniqExact(session_id) AS affected_sessions
FROM (
    SELECT
        session_id, selector, url, timestamp,
        timestamp - lagInFrame(timestamp) OVER (
            PARTITION BY session_id, selector ORDER BY timestamp
        ) AS gap_ms
    FROM analytics.events
    WHERE type = 'click' AND project_id = {projectId}
        AND timestamp >= {from} AND timestamp <= {to}
        AND selector != ''
)
WHERE gap_ms < 1000
GROUP BY selector, url
HAVING count() >= 3
ORDER BY rage_count DESC
```

#### API
Create `GET /api/heatmap/rage` endpoint:
- Returns: `{ rageClicks: Array<{ selector: string, url: string, count: number, sessions: number }> }`

#### Toolbar Visualization
- Find elements matching rage click selectors on the current page
- Highlight them with a red pulsing border/overlay
- Show badge with rage click count on each element
- Different from heatmap — this is element-level highlighting, not a canvas overlay

### Phase C: Engagement Zones (Medium effort)

**Why third:** Requires a different visualization approach (element bounding boxes, not point heatmap) but can reuse existing click data.

#### Concept
Group clicks by CSS selector (already captured), count unique sessions per element, then highlight elements proportionally on the page.

#### Query
```sql
SELECT
    selector,
    count() AS total_clicks,
    uniqExact(session_id) AS unique_sessions,
    avg(x) AS avg_x,
    avg(y) AS avg_y
FROM analytics.events
WHERE type = 'click' AND project_id = {projectId} AND url = {url}
    AND timestamp >= {from} AND timestamp <= {to}
    AND selector != ''
GROUP BY selector
ORDER BY total_clicks DESC
LIMIT 50
```

#### API
Create `GET /api/heatmap/engagement` endpoint:
- Returns: `{ zones: Array<{ selector: string, clicks: number, sessions: number }> }`

#### Toolbar Visualization
- Walk the DOM, find elements matching each selector
- Draw semi-transparent colored rectangles over their bounding boxes
- Color intensity proportional to click count (blue = low, red = high)
- Show tooltip on hover: "Button CTA — 234 clicks, 89 sessions"
- Grid-like appearance (matches the Hotjar engagement zones look)

### Phase D: Move Heatmap (High effort — deferred to v2)

**Why last:** Generates massive data volume, needs careful throttling, separate storage, and is the least actionable of all map types.

#### Tracker Changes
Add `attachMoveListener(cb)` in `listeners.ts`:
- Listen to `mousemove` on document
- Throttle aggressively: sample at most once per 100ms
- Only record if mouse has moved >5px from last recorded position
- Event: `{ type: 'move', x: pageX, y: pageY, url, ... }`

WARNING: This can generate 10x the data volume of clicks. Needs:
- Separate ClickHouse table with shorter TTL (30 days vs 12 months)
- Batch more aggressively (100 events per batch)
- Config flag to opt-in: `TrackerConfig.mouseMove: boolean` (default false)

#### ClickHouse
New table `analytics.mouse_moves` with aggressive TTL:
```sql
CREATE TABLE IF NOT EXISTS analytics.mouse_moves (
    project_id UUID,
    session_id String,
    timestamp DateTime64(3, 'UTC'),
    url String,
    x Float32,
    y Float32,
    device_type LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, url, timestamp)
TTL timestamp + INTERVAL 30 DAY
```

Materialized view for aggregation (same 10x10 bucketing as clicks).

#### Visualization
Same as click heatmap but with move data — shows where users hover/move their cursor. Useful for understanding attention patterns.

## Toolbar UI Changes (applies to all phases)

Update the toolbar script (`/api/toolbar/script`) to add a map type switcher:

Current toolbar has: [Load Heatmap] [7d] [30d] [90d] [x]

New toolbar: [Map Type v] [Load] [7d] [30d] [90d] [x]

Map Type dropdown options:
- All Clicks (existing, default)
- Scroll Depth (Phase A)
- Rage Clicks (Phase B)
- Engagement Zones (Phase C)
- Mouse Move (Phase D, disabled until implemented)

Each map type calls its own API endpoint and uses its own visualization renderer.

## Shared Types to Add

In `packages/shared/src/types.ts`:
```typescript
export type HeatmapType = 'clicks' | 'scroll' | 'rage' | 'engagement' | 'move';

export interface ScrollDepthBucket {
  depth: number;      // 0, 10, 20, ..., 100
  sessions: number;
  percentage: number;  // 0-100, relative to total
}

export interface RageClick {
  selector: string;
  url: string;
  count: number;
  sessions: number;
}

export interface EngagementZone {
  selector: string;
  clicks: number;
  sessions: number;
}
```

## Effort Estimates

| Phase | Effort | Tracker | ClickHouse | API | Toolbar |
|-------|--------|---------|------------|-----|---------|
| A: Scroll | Small | None | Optional MV | New endpoint | Gradient overlay |
| B: Rage Clicks | Small | None | None | New endpoint + query | Element highlight |
| C: Engagement | Medium | None | None | New endpoint + query | DOM element overlay |
| D: Move | Large | New listener | New table + MV | New endpoint | Heatmap overlay |

## Dependencies

- Phase A, B, C are independent and can be built in parallel
- Phase D depends on tracker changes and is deferred to v2
- All phases depend on the toolbar map type switcher (can be added incrementally)
