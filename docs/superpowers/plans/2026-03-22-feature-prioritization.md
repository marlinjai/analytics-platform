---
title: "Feature Prioritization — Q2 2026"
summary: "ICE-scored prioritization of remaining extension, dashboard, and platform features"
type: plan
status: proposed
date: 2026-03-22
tags: [roadmap, prioritization, strategy]
projects: [analytics-platform]
---

# Feature Prioritization — Q2 2026

## Context

This document evaluates and rank-orders the remaining features across the Lumitra analytics platform: browser extension, dashboard, and platform-level capabilities. Scoring uses the ICE framework (Impact, Confidence, Ease — each 1-10, averaged) combined with strategic reasoning about competitive differentiation, compounding value, and build sequencing.

### What already exists (as of 2026-03-22)

**Extension (packages/extension/):** Fully functional MVP with popup UI, auth flow, token refresh, element-based heatmap overlay (with h337.js canvas rendering), scroll depth visualization, rage click highlighting, element inspector tooltip, SPA navigation handling, canvas-only page fallback, draggable/minimizable widget. No Side Panel yet. Not published to any store.

**Dashboard:** Overview page with SWR data fetching, click-to-filter with filter pills, date range picker, project switcher, export (CSV/JSON), top pages, sources, countries, browsers/OS/devices breakdown. Heatmap page with bookmarklet, scroll depth chart, rage clicks table. Funnels page with create/view/delete. Session replay with individual replay viewer. Settings with SDK config toggles (replay/heatmap/scrollDepth), API key management (create/revoke/rotate), team members list, invitation system (create/revoke invitations with URL sharing), role-based access (owner/admin/viewer). Real-time visitors API endpoint exists. Onboarding flow and empty states exist.

**Tracker SDK:** Element-based click tracking with stable CSS selectors, scroll depth, session replay (rrweb), canvas-only page detection. Published as @marlinjai/analytics-tracker.

**Infrastructure:** Production on Hetzner (Terraform + Caddy), ClickHouse + PostgreSQL, health check endpoint, CI/CD.

---

## ICE Scoring

### Scoring Criteria

- **Impact (I):** How much does this move the needle for user acquisition, retention, or competitive positioning? (1 = negligible, 10 = transformative)
- **Confidence (C):** How certain are we that it will deliver the expected impact? (1 = speculative, 10 = proven demand)
- **Ease (E):** How quickly and cheaply can this be built given existing architecture? (1 = months of work, 10 = a few hours)

**ICE Score = (I + C + E) / 3**

---

## Extension Features

### 1. Side Panel (persistent UI replacing popup)

Replace the popup with Chrome's Side Panel API for a persistent analytics panel alongside any page.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 6 | Better UX than popup (persists when clicking elsewhere), but the current popup + floating widget already works well. The widget already provides persistent controls on the page itself. Side Panel adds value mainly for showing richer data (scroll charts, rage click tables, real-time stats) without navigating to the dashboard. |
| Confidence | 7 | Chrome Side Panel is a stable API. Clarity and similar tools use it. The UX improvement is predictable. |
| Ease | 6 | WXT supports Side Panel scaffolding. The popup React code can be largely reused. Requires adding `side_panel` permission, a new entrypoint, and migrating the popup logic. Firefox uses `sidebarAction` (different API, but WXT abstracts it). Estimated 1-2 days. |
| **ICE** | **6.3** | |

**Verdict:** Nice-to-have. The floating widget already provides persistent on-page controls. Side Panel becomes more valuable once there is richer data to display (engagement zones, real-time stats). Defer until after engagement zones are built.

---

### 2. Widget intensity/radius sliders for heatmap tuning

Add slider controls to the floating widget for adjusting h337.js `radius`, `maxOpacity`, and `blur` parameters in real time.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 4 | Niche UX improvement. The current defaults (radius: 40, maxOpacity: 0.75, blur: 0.8) work well for most pages. Power users analyzing dense click areas would benefit, but this is a minority use case. No competitor prominently features this. |
| Confidence | 5 | Users might appreciate it, but nobody has asked for it. Hotjar and Clarity do not expose these controls. |
| Ease | 8 | Trivially implementable. Add two `<input type="range">` elements to the widget, pass values to `renderElementHeatmapInMainWorld`, and re-render. The h337.js API already accepts these parameters. Under 2 hours. |
| **ICE** | **5.7** | |

**Verdict:** Low priority despite being easy. Build it as a quick win when polishing the extension before store submission, not as a standalone task.

---

### 3. Chrome Web Store / Firefox / Edge publishing

Package the extension, write privacy policy, create screenshots, submit to Chrome Web Store, Firefox Add-ons, and Edge Add-ons.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 8 | Critical for user acquisition. Currently, users must manually load an unpacked extension. Store presence enables: discoverability via search, one-click install, automatic updates, credibility signal. This is a prerequisite for any non-technical user to use the extension. |
| Confidence | 9 | The extension already works. Submission is a known process. The only uncertainty is Chrome Web Store review time for `<all_urls>` permission (typically 3-7 days, sometimes longer). |
| Ease | 5 | Requires: 128px icon (currently only 16/32), 1280x800 screenshots, privacy policy page, store listing copy, developer account setup ($5 Chrome, free Firefox/Edge). The build pipeline (`scripts/build.mjs` + `scripts/zip.mjs`) already exists. Estimated 1-2 days of non-coding work plus review wait time. |
| **ICE** | **7.3** | |

**Verdict:** High priority. This is a gating function for extension adoption. Should be done as soon as the extension feature set is "complete enough" — which it already is. The current MVP (click heatmap, scroll depth, rage clicks, element inspector) is a strong v1.0 offering.

---

### 4. Flutter semantics tree scraping for canvas pages

Parse `<flt-semantics-host>` overlay nodes to provide element-level click tracking on Flutter CanvasKit pages, rather than falling back to raw x/y coordinates.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 3 | Flutter Web is a growing but still small segment of the web. Most Lumitra users track standard HTML/React/Vue sites. The x/y coordinate fallback already works for canvas pages. This is a differentiation play (Hotjar/Clarity show black rectangles for canvas), but the addressable audience is small. |
| Confidence | 4 | The semantics tree approach depends on the Flutter developer having enabled semantics — which is not guaranteed. The research doc notes "medium confidence." The approach is unproven in production. |
| Ease | 5 | The canvas-framework-integration research doc estimates 1-2 weeks. Requires tracker-side changes (detecting `flt-glass-pane`, querying `elementsFromPoint` against semantics nodes) and extension-side rendering adjustments. |
| **ICE** | **4.0** | |

**Verdict:** Backlog. Interesting differentiation but too niche for current stage. Revisit when there is actual user demand from Flutter Web customers. The x/y fallback provides baseline coverage.

---

## Dashboard Features

### 5. Engagement zones table (element-level click aggregation on heatmap page)

Add a table to the heatmap page showing the top clicked elements with their CSS selectors, click counts, session counts, and percentage of total clicks. This is the dashboard counterpart to the extension's element inspector tooltip.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 8 | High. This gives the heatmap page its own unique value beyond "go install the extension." Users who do not want to install an extension can see element-level click data directly in the dashboard. It also enables: sorting by most/least clicked, identifying dead zones, comparing elements across date ranges. The `/api/heatmap/by-selector` endpoint and `heatmap_selectors_mv` materialized view already exist — this is purely a frontend task. |
| Confidence | 9 | The data pipeline is fully built. The element-based heatmap plan explicitly notes "could add engagement zones table later" as a follow-up. FullStory's click maps and Hotjar's element list prove this pattern works. |
| Ease | 8 | Frontend-only work. Fetch from existing `/api/heatmap/by-selector`, render a sortable table with columns: Element (truncated selector), Clicks, Sessions, % of Total. Filter by URL and device type using existing controls on the heatmap page. Estimated half a day. |
| **ICE** | **8.3** | |

**Verdict:** Highest priority dashboard item. This is the single highest-ROI task on this list — the backend is done, the data is flowing, and the frontend is a straightforward table. It makes the heatmap page independently valuable without the extension and creates a natural upsell to the extension for spatial visualization.

---

### 6. A/B testing / experimentation

Variant assignment, per-variant heatmaps, statistical significance calculations, experiment management UI.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 7 | A/B testing is a premium feature that drives upgrades in competitors (Hotjar, VWO, Optimizely). It would differentiate Lumitra significantly. However, it is a complex domain with high expectations — half-built A/B testing is worse than none. |
| Confidence | 3 | High uncertainty. Requires: variant assignment logic in the tracker, experiment configuration API, per-variant data segregation in ClickHouse queries, statistical significance engine (frequentist or Bayesian), and a complex dashboard UI. The scope is poorly defined and could easily balloon. No user has asked for this. |
| Ease | 2 | This is a multi-week project touching every layer: tracker SDK (variant assignment cookie/hash), shared types, ClickHouse schema (variant column or property), dashboard API (experiment CRUD, per-variant queries), dashboard UI (experiment builder, results comparison, significance indicators). Estimated 4-6 weeks minimum for a credible implementation. |
| **ICE** | **4.0** | |

**Verdict:** Not now. This is a Q3/Q4 feature at the earliest. The platform needs to nail core analytics, heatmaps, and funnels before adding experimentation. When the time comes, consider integrating with existing A/B tools (Growthbook, Statsig) rather than building from scratch — "show per-variant heatmaps for experiments run in Growthbook" would be a powerful integration with 10% of the effort.

---

### 7. Funnel analytics improvements

Enhance the existing funnels page with: time-between-steps analysis, funnel comparison over date ranges, conversion rate trends, user path exploration from drop-off points.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 6 | The current funnels page is functional (create, view, delete, step visualization with drop-off rates) but basic. Time-between-steps and trend analysis would make it genuinely useful for conversion optimization. However, funnels are a "nice to have" for most analytics users — they are less frequently used than the main dashboard or heatmaps. |
| Confidence | 7 | The existing funnel infrastructure (Postgres funnel definitions, ClickHouse session-based step matching, API routes) is solid. Enhancements are incremental. |
| Ease | 5 | Time-between-steps requires a new ClickHouse query (diff between step timestamps per session). Trend analysis requires running funnel queries across multiple date ranges. Path exploration is a new concept. Estimated 3-5 days for meaningful improvements. |
| **ICE** | **6.0** | |

**Verdict:** Medium priority. The current funnel implementation is "good enough" for now. Improvements should come after the higher-impact items (engagement zones, store publishing, real-time enhancements). Focus on time-between-steps first — it is the most actionable insight.

---

### 8. Real-time dashboard enhancements

Expand the existing real-time visitors endpoint into a full live analytics experience: current visitor count in KPI cards, live event feed, auto-refresh toggle, WebSocket or SSE for push updates.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 7 | Real-time data creates "stickiness" — users keep the dashboard open. The current `GET /api/stats/realtime` endpoint returns a visitor count but it is not surfaced in the dashboard UI. Showing "3 visitors right now" in the header creates immediate engagement. A live event feed ("someone from Germany just viewed /pricing") is a proven engagement driver used by Plausible, Fathom, and PostHog. |
| Confidence | 8 | The API endpoint exists. The ClickHouse query (`uniqExact(session_id) WHERE timestamp >= now() - INTERVAL 5 MINUTE`) works. The implementation is well-understood. Every competitor has this. |
| Ease | 6 | Phase 1 (counter in KPI cards + 15s polling) is trivial — fetch the existing endpoint and display it. Phase 2 (live event feed) requires a new query for recent events and a scrolling UI component. Phase 3 (WebSocket/SSE) is optional — polling works fine at this stage. Estimated 1-2 days for Phase 1+2. |
| **ICE** | **7.0** | |

**Verdict:** High priority. Phase 1 (show the counter) is extremely easy and immediately impactful. It should be bundled with the next dashboard work sprint. Phase 2 (live feed) can follow shortly after. Skip Phase 3 (WebSocket) until scale demands it — 15-second polling is fine for the current user base.

---

## Platform Features

### 9. Session replay improvements

Session search/filter (by URL, country, device, duration), session tags/notes, thumbnail previews in session list, skip-to-click in timeline, rage click detection highlighting in replay.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 7 | Session replay is Lumitra's strongest differentiator against lightweight analytics tools (Plausible, Umami, Fathom — none of which have replay). However, the current replay list is basic — users must browse sessions without filtering, which makes it hard to find interesting ones. Search/filter is the unlock that makes replay genuinely useful. |
| Confidence | 7 | Session data is already in ClickHouse with URL, device, country, and duration. Filtering is a query-level change plus frontend work. The rrweb-player is already integrated. |
| Ease | 5 | Search/filter requires: new API parameters on `/api/sessions`, ClickHouse query modifications, and a filter UI on the replay list page. Thumbnails require either server-side rendering or a screenshot-on-first-event approach. Tags/notes require a new Postgres table. Estimated 3-5 days for search/filter alone. |
| **ICE** | **6.3** | |

**Verdict:** Medium-high priority. Session replay is the feature that makes Lumitra more than "another Plausible clone." But replay without filtering is like a filing cabinet without labels. Prioritize search/filter first — it is the highest-leverage improvement. Defer thumbnails, tags, and skip-to-click to a later iteration.

---

### 10. Custom event tracking enhancements

Custom event explorer page (`/events`), event name list with counts, property breakdown per event, revenue tracking, goal/conversion definitions.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 7 | Custom events are how SaaS products track business-specific actions (signup, purchase, feature_used). Without an explorer, custom event data is invisible in the dashboard — it only appears in funnels. An events page + goals UI turns Lumitra from a "pageview counter" into a "business metrics platform." |
| Confidence | 6 | The tracker already supports `tracker.event('name', { props })` and the data lands in ClickHouse. The query patterns are straightforward. The uncertainty is in scope — goals/conversions add significant complexity (goal definitions in Postgres, conversion rate calculations in queries, KPI card integration). |
| Ease | 4 | The events explorer (list events, show counts, break down by properties) is moderate work — new page, new API endpoint, new ClickHouse queries. Goals add: Postgres table, CRUD API, conversion rate queries, dashboard integration. Estimated 3-4 days for explorer, another 3-4 for goals. |
| **ICE** | **5.7** | |

**Verdict:** Medium priority. The events explorer is more impactful than goals — start there. It is also a prerequisite for goals (you need to see what events exist before defining conversions). Goals can follow in a subsequent sprint.

---

### 11. Data export / API access

Expand the existing export endpoint into a proper public API: API key authentication, rate limiting, pagination, OpenAPI documentation, programmatic access to all data.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 5 | The dashboard already has CSV/JSON export with filter support. A public API matters for: integrations (Zapier, custom dashboards, data warehousing), power users, and eventual paid tier differentiation. But at the current stage (few users), nobody is asking for programmatic API access. |
| Confidence | 5 | API key infrastructure exists (create/revoke/rotate in settings). The queries exist. The work is mostly about adding API key auth to existing endpoints, adding pagination, and writing docs. The uncertainty is whether anyone will use it. |
| Ease | 5 | API key auth middleware needs to be created (check `Authorization: Bearer ap_live_...` header, look up key, verify not revoked, rate limit). Apply to existing stat endpoints. Pagination requires cursor-based query changes. OpenAPI docs are a separate effort. Estimated 3-4 days. |
| **ICE** | **5.0** | |

**Verdict:** Lower priority. The existing export covers the immediate need. Public API becomes important when: (a) there are paying customers who need integrations, or (b) building a Zapier/webhook integration layer. Defer to late Q2 or Q3.

---

### 12. Team collaboration features (beyond invitations)

Activity log, shared dashboard links (public read-only URLs), embeddable iframe snippets, role-based feature restrictions, transfer project ownership.

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Impact | 5 | The core team features already exist: members, roles (owner/admin/viewer), invitations with URL sharing, member removal. The remaining items are polish. Shared dashboard links would be useful for reporting to stakeholders, but it is a "nice to have." Activity log is primarily for compliance/audit. |
| Confidence | 6 | These are well-understood features. No technical risk. |
| Ease | 4 | Shared links require: a new access mode (public token-based), a stripped-down read-only dashboard view, and URL generation. Activity log requires: a new Postgres table, event emission from every mutation endpoint, and a log viewer UI. Estimated 3-5 days. |
| **ICE** | **5.0** | |

**Verdict:** Lower priority. The existing team system is functional. Shared dashboard links are the most valuable remaining piece — they enable "send this to the client" without giving dashboard access. But it can wait until the core product is stronger.

---

## Ranked Priority List

| Rank | Feature | ICE | Category | Est. Effort | Compounding Value |
|------|---------|-----|----------|-------------|-------------------|
| 1 | Engagement zones table | 8.3 | Dashboard | 0.5 days | Unlocks heatmap page value without extension |
| 2 | Chrome/Firefox/Edge publishing | 7.3 | Extension | 1-2 days | Gates all extension user acquisition |
| 3 | Real-time dashboard (Phase 1+2) | 7.0 | Dashboard | 1-2 days | Drives daily dashboard opens, stickiness |
| 4 | Session replay search/filter | 6.3 | Platform | 3-5 days | Makes replay useful, strongest differentiator |
| 5 | Side Panel | 6.3 | Extension | 1-2 days | Better after engagement zones exist |
| 6 | Funnel improvements | 6.0 | Dashboard | 3-5 days | Incremental, not urgent |
| 7 | Custom event explorer | 5.7 | Platform | 3-4 days | Prerequisite for goals/conversions |
| 8 | Heatmap sliders | 5.7 | Extension | 2 hours | Bundle with store submission polish |
| 9 | Data export / public API | 5.0 | Platform | 3-4 days | Matters when there are paying users |
| 10 | Team collaboration extras | 5.0 | Platform | 3-5 days | Core team features already work |
| 11 | A/B testing | 4.0 | Dashboard | 4-6 weeks | Too large, consider integration approach |
| 12 | Flutter semantics scraping | 4.0 | Extension | 1-2 weeks | Too niche for current stage |

---

## Recommended Build Order

The ranking above is by ICE score, but the actual build order should account for dependencies, context-switching costs, and natural groupings. Here is the recommended sequence:

### Sprint 1: Heatmap Page Completion + Store Submission (3-4 days)

**Theme:** Make the heatmap story complete, end-to-end.

1. **Engagement zones table** — Add to the existing heatmap page. The data pipeline is built; this is pure frontend. Half a day.
2. **Heatmap sliders** — Add radius/opacity controls to the extension widget while the heatmap code is fresh in mind. 2 hours.
3. **Chrome Web Store submission** — Create 128px icon, screenshots, privacy policy, submit. The extension feature set is strong enough for v1.0 now. 1-2 days of non-coding work.
4. **Firefox + Edge submissions** — Piggyback on Chrome submission assets. Half a day.

**Why this order:** The engagement zones table makes the heatmap page independently valuable (no extension required). The sliders polish the extension before it goes to the store. Submitting immediately after means the review period overlaps with Sprint 2 work.

### Sprint 2: Dashboard Stickiness (2-3 days)

**Theme:** Give users reasons to keep the dashboard open.

5. **Real-time visitor counter** — Surface the existing `/api/stats/realtime` endpoint in the overview page KPI cards. Add 15-second polling. Trivial.
6. **Live event feed** — New component on the overview page showing the last 50 events as they happen. New ClickHouse query for recent events, auto-scrolling UI.

**Why this order:** Real-time features create the "I want to check my analytics" habit. This is the cheapest way to increase daily active usage.

### Sprint 3: Replay Unlock (3-5 days)

**Theme:** Make session replay the killer feature.

7. **Session replay search/filter** — Add URL, country, device, and duration filters to the replay list page. New API parameters, ClickHouse query modifications, filter UI.

**Why this order:** Session replay is what makes Lumitra more than a Plausible/Umami alternative. But without search, users cannot find interesting sessions. This is the single change that converts replay from a demo feature to a production tool.

### Sprint 4: Conversion Intelligence (5-7 days)

**Theme:** Help users understand user journeys.

8. **Custom event explorer** — New `/events` page showing event names, counts, and property breakdowns. New API endpoint, new ClickHouse queries.
9. **Funnel improvements** — Add time-between-steps to the existing funnels page. Conversion rate trends across date ranges.

**Why this order:** The events explorer must come before funnel improvements because understanding what events exist informs funnel design. Together, these features move Lumitra from "traffic analytics" to "conversion analytics."

### Sprint 5: Platform Maturity (3-5 days)

**Theme:** Professional features for teams and integrations.

10. **Side Panel** — Now that engagement zones, real-time stats, and richer data exist, the Side Panel has more to show.
11. **Shared dashboard links** — Enable sending read-only analytics views to clients and stakeholders.

### Backlog (Q3+)

12. **Data export / public API** — When paying customers need integrations.
13. **A/B testing** — Consider integration with Growthbook/Statsig rather than building from scratch.
14. **Flutter semantics scraping** — When there is actual Flutter Web user demand.

---

## Strategic Rationale

### What differentiates Lumitra from Hotjar/Clarity/PostHog

Lumitra occupies a unique position: **privacy-first analytics + session replay + heatmaps in a single lightweight package**. No competitor offers this exact combination:

- **Plausible/Umami/Fathom:** Privacy-first but no replay, no heatmaps.
- **Hotjar/Clarity:** Replay + heatmaps but heavy, privacy-questionable, no core analytics dashboard.
- **PostHog:** Everything but heavyweight, complex, expensive at scale.

The prioritization above leans into this differentiation: replay improvements (Sprint 3) and the heatmap engagement table (Sprint 1) strengthen the features that competitors do not combine.

### Acquisition vs. Retention

- **Acquisition drivers:** Store publishing (#2), shared dashboard links (#11), real-time counter (social proof in demos).
- **Retention drivers:** Engagement zones (#1), real-time feed (#6), replay search (#7), custom events (#8).

The build order front-loads both: Sprint 1 addresses acquisition (store) and Sprint 2-3 address retention (stickiness + replay).

### Compounding value

The engagement zones table (#1) has the highest compounding value because it:
- Makes the heatmap page useful without the extension (serves dashboard-only users).
- Provides the data that the Side Panel (#5) will display later.
- Creates a natural "see the data in context" upsell to the extension.
- Requires zero backend work (the API and materialized view already exist).

### What to explicitly NOT build yet

- **A/B testing:** The scope is massive and the demand is unproven. When the time comes, integrate with existing tools rather than building a statistics engine.
- **Flutter/Unity/Three.js integrations:** Interesting differentiation but the addressable market is too small. The x/y coordinate fallback is sufficient.
- **AI insights:** Mentioned in the Q2 roadmap but premature. The platform needs more users generating data before AI summaries become meaningful.
- **Email reports:** Lower priority than making the dashboard itself better. Users who want reports can use shared dashboard links.

---

## Related Documents

- [Q2 2026 Roadmap](./2026-03-21-q2-roadmap.md)
- [Browser Extension Plan](./2026-03-22-browser-extension.md)
- [Element-Based Heatmaps (DONE)](./2026-03-22-element-based-heatmaps.md)
- [Canvas Framework Integration Research](./2026-03-22-canvas-framework-integration.md)
- [Device Detection & Touch Events (DONE)](./2026-03-22-device-detection-touch-events.md)
