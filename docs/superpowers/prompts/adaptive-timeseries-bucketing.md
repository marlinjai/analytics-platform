# Adaptive Timeseries Bucketing for Pageviews Chart

## Task

The pageviews timeseries chart on the analytics dashboard overview page currently shows one data point per day regardless of the selected date range. This makes short ranges (12h, 24h) useless — you see a single dot instead of an hourly traffic curve.

Implement adaptive time bucketing:

| Date range | Bucket size | X-axis label format |
|------------|-------------|-------------------|
| 12h | 5 minutes | "14:05", "14:10" |
| 24h | 1 hour | "00:00", "01:00", ... "23:00" |
| 3d | 1 hour | "Mon 14:00", "Mon 15:00" |
| 7d | 1 day | "Mon 17", "Tue 18" |
| 30d | 1 day | "Mar 1", "Mar 2" |
| 90d | 1 week | "Week of Mar 3" |

## Files to modify

### 1. Backend: Timeseries API query
**File:** `packages/dashboard/src/lib/queries/stats.ts`

Find the `getTimeseries` function (or similar). It currently groups by `toDate(timestamp)` (daily). Change it to use a dynamic ClickHouse time function based on the date range:
- 12h: `toStartOfFiveMinutes(timestamp)`
- 24h: `toStartOfHour(timestamp)`
- 3d: `toStartOfHour(timestamp)`
- 7d/30d: `toDate(timestamp)` (keep as-is)
- 90d: `toStartOfWeek(timestamp)`

The API route that calls this is likely at `packages/dashboard/src/app/api/stats/route.ts` or `packages/dashboard/src/app/api/stats/timeseries/route.ts`. The `from` and `to` query params already exist — calculate the range duration and pick the bucket size.

### 2. Backend: Fill empty buckets
Generate a complete series of time buckets between `from` and `to` (even if no events exist) so the chart shows zeros instead of gaps. ClickHouse won't return rows for empty buckets.

### 3. Frontend: Chart component
**File:** `packages/dashboard/src/app/(dashboard)/page.tsx`

The Recharts `<LineChart>` (or `<AreaChart>`) needs updated:
- X-axis tick formatting based on bucket size (hour format for 24h, date for 7d, etc.)
- Tooltip format matching the bucket granularity
- Smooth curve (`type="monotone"`) looks better with more data points

### 4. Frontend: Also show unique visitors line
Consider adding a second line for unique visitors (already available in the query as `uniqExact(ip_hash)`) in a different color, with a legend.

## Best practices (from Plausible/PostHog/Umami)
- Always fill empty buckets with 0 so the chart doesn't collapse
- Use area chart (filled) instead of line chart for single metric, line chart for multiple metrics
- Show both pageviews and unique visitors as two lines
- Tooltip should show the exact bucket time range, e.g. "Mon Mar 24, 14:00–15:00"
- X-axis should not show every label — use reasonable tick intervals to avoid crowding

## Tech context
- ClickHouse 24 with `analytics.events` table
- `timestamp` column is `DateTime64(3)`
- Dashboard is Next.js 15 + React 19 + Recharts
- Current date range picker: 12h, 24h, 3d, 7d, 30d, 90d presets + custom range
- Project uses `useCurrentProjectId()` hook from `@/components/layout/ProjectSwitcher` for shared project state
