#!/usr/bin/env bash
# Seed ClickHouse with realistic test events to validate dashboard metrics.
# Usage: ./scripts/seed-test-events.sh
#
# Expected results:
#   Pageviews: 15
#   Visitors:  5  (unique ip_hash values)
#   Sessions:  7  (unique session_ids)
#   Median Duration: ~180s (3 minutes) — sessions: 0, 60, 120, 180, 240, 300, 7200
#     sorted durations: [0, 60, 120, 180, 240, 300, 7200] → median = 180
#   Bounce Rate: 2/7 ≈ 29%  (sessions D & G have only 1 pageview)

set -euo pipefail

CH_URL="http://localhost:8123/?user=default&password=clickhouse_dev"
PROJECT_ID="00000000-0000-0000-0000-000000000001"

echo "Clearing existing test data..."
curl -s "$CH_URL" --data "DELETE FROM analytics.events WHERE project_id = '$PROJECT_ID'" >/dev/null

echo "Inserting test events..."

# Helper: insert one event
insert() {
  local session_id="$1" type="$2" ts="$3" url="$4" ip_hash="$5"
  local referrer="${6:-}" browser="${7:-Chrome}" os="${8:-macOS}" device_type="${9:-desktop}"
  local replay_chunk="${10:-}"

  curl -s "$CH_URL" --data "
    INSERT INTO analytics.events
      (project_id, session_id, type, timestamp, received_at, url, referrer, ip_hash, browser, os, device_type, replay_chunk)
    VALUES
      ('$PROJECT_ID', '$session_id', '$type', '$ts', '$ts', '$url', '$referrer', '$ip_hash', '$browser', '$os', '$device_type', '$replay_chunk')
  " >/dev/null
}

BASE="https://www.example.com"

# ── Session A: visitor-1, normal browsing, 3 pages, duration=300s ──
insert "sess-a" "session_start" "2026-03-20 10:00:00" "$BASE/"         "ip_hash_1"
insert "sess-a" "pageview"      "2026-03-20 10:00:01" "$BASE/"         "ip_hash_1" "" "Chrome" "macOS"
insert "sess-a" "click"         "2026-03-20 10:01:00" "$BASE/"         "ip_hash_1"
insert "sess-a" "pageview"      "2026-03-20 10:02:00" "$BASE/about"    "ip_hash_1"
insert "sess-a" "pageview"      "2026-03-20 10:05:01" "$BASE/pricing"  "ip_hash_1"

# ── Session B: visitor-2, from Instagram, 2 pages, duration=120s ──
insert "sess-b" "session_start" "2026-03-20 11:00:00" "$BASE/"         "ip_hash_2"
insert "sess-b" "pageview"      "2026-03-20 11:00:01" "$BASE/"         "ip_hash_2" "https://l.instagram.com/something" "Safari" "iOS" "mobile"
insert "sess-b" "scroll"        "2026-03-20 11:01:00" "$BASE/"         "ip_hash_2"
insert "sess-b" "pageview"      "2026-03-20 11:02:01" "$BASE/features" "ip_hash_2" "" "Safari" "iOS" "mobile"

# ── Session C: visitor-3, 3 pages, duration=240s, with replay ──
insert "sess-c" "session_start" "2026-03-20 12:00:00" "$BASE/"         "ip_hash_3"
insert "sess-c" "pageview"      "2026-03-20 12:00:01" "$BASE/"         "ip_hash_3" "" "Firefox" "Windows"
insert "sess-c" "pageview"      "2026-03-20 12:02:00" "$BASE/docs"     "ip_hash_3" "" "Firefox" "Windows"
insert "sess-c" "pageview"      "2026-03-20 12:04:01" "$BASE/pricing"  "ip_hash_3" "" "Firefox" "Windows"
# replay event
insert "sess-c" "replay"        "2026-03-20 12:01:00" "$BASE/"         "ip_hash_3" "" "Firefox" "Windows" "desktop" '[{"type":2,"data":{"node":{"type":0}}}]'

# ── Session D: visitor-4, bounce (1 pageview), duration=0s ──
insert "sess-d" "session_start" "2026-03-20 13:00:00" "$BASE/"         "ip_hash_4"
insert "sess-d" "pageview"      "2026-03-20 13:00:01" "$BASE/"         "ip_hash_4" "https://www.google.com/" "Chrome" "Android" "mobile"

# ── Session E: visitor-1 returns (new session), 2 pages, duration=60s ──
insert "sess-e" "session_start" "2026-03-20 15:00:00" "$BASE/"         "ip_hash_1"
insert "sess-e" "pageview"      "2026-03-20 15:00:01" "$BASE/"         "ip_hash_1"
insert "sess-e" "pageview"      "2026-03-20 15:01:01" "$BASE/pricing"  "ip_hash_1"

# ── Session F: visitor-5, 2 pages, duration=180s ──
insert "sess-f" "session_start" "2026-03-20 16:00:00" "$BASE/"         "ip_hash_5"
insert "sess-f" "pageview"      "2026-03-20 16:00:01" "$BASE/"         "ip_hash_5" "" "Chrome" "macOS"
insert "sess-f" "pageview"      "2026-03-20 16:03:01" "$BASE/about"    "ip_hash_5"

# ── Session G: visitor-3, bounce + outlier tab left open 2hrs, duration=7200s ──
insert "sess-g" "session_start" "2026-03-20 18:00:00" "$BASE/"         "ip_hash_3"
insert "sess-g" "pageview"      "2026-03-20 18:00:01" "$BASE/"         "ip_hash_3" "" "Firefox" "Windows"
insert "sess-g" "scroll"        "2026-03-20 20:00:01" "$BASE/"         "ip_hash_3" "" "Firefox" "Windows"

echo ""
echo "=== Test data inserted ==="
echo ""
echo "Expected dashboard values (date range including 2026-03-20):"
echo "  Pageviews:        15"
echo "  Visitors:          5  (ip_hash_1..5)"
echo "  Sessions:          7  (sess-a..g)"
echo "  Median Duration: 180s (3m 0s)"
echo "    Sorted durations: [0, 60, 120, 180, 240, 300, 7200]"
echo "    With avg() this would be: 1157s (19m 17s) -- misleading!"
echo "  Bounce Rate:      29% (2/7 sessions with 1 pageview: D, G)"
echo ""
echo "Sessions with replay data: sess-c (1 replay chunk)"
echo "Referrer sources: l.instagram.com (1 visitor), www.google.com (1 visitor)"
echo ""

echo "Verifying with queries..."
echo ""

echo "--- Pageviews & Visitors ---"
curl -s "$CH_URL" --data "
  SELECT
    countIf(type = 'pageview') AS pageviews,
    uniqExactIf(ip_hash, type = 'pageview') AS visitors
  FROM analytics.events
  WHERE project_id = '$PROJECT_ID'
  FORMAT Pretty
"

echo ""
echo "--- Sessions, Median Duration, Bounce Rate ---"
curl -s "$CH_URL" --data "
  SELECT
    uniqExact(session_id) AS sessions,
    median(session_duration) AS median_duration,
    avg(session_duration) AS avg_duration_for_comparison,
    countIf(session_pageviews = 1) / greatest(count(), 1) AS bounce_rate
  FROM (
    SELECT
      session_id,
      dateDiff('second', min(timestamp), max(timestamp)) AS session_duration,
      countIf(type = 'pageview') AS session_pageviews
    FROM analytics.events
    WHERE project_id = '$PROJECT_ID'
    GROUP BY session_id
  )
  FORMAT Pretty
"

echo ""
echo "--- Per-session breakdown ---"
curl -s "$CH_URL" --data "
  SELECT
    session_id,
    countIf(type = 'pageview') AS pageviews,
    count() AS total_events,
    dateDiff('second', min(timestamp), max(timestamp)) AS duration_sec,
    any(ip_hash) AS ip_hash,
    replay_chunk != '' AS has_replay
  FROM analytics.events
  WHERE project_id = '$PROJECT_ID'
  GROUP BY session_id, replay_chunk
  ORDER BY session_id
  FORMAT Pretty
"

echo ""
echo "--- Top Sources ---"
curl -s "$CH_URL" --data "
  SELECT
    domain(referrer) AS source,
    uniqExact(ip_hash) AS visitors
  FROM analytics.events
  WHERE project_id = '$PROJECT_ID'
    AND type = 'pageview'
    AND referrer != ''
  GROUP BY source
  ORDER BY visitors DESC
  FORMAT Pretty
"
