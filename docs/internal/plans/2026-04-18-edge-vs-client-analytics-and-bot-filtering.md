---
title: Edge vs Client-Side Analytics and Bot Filtering Strategy
summary: >
  How Lumitra positions against edge-vs-client confusion, ships credible bot
  filtering, and turns bot transparency into a selling point. Covers research
  synthesis, competitor gap analysis, feature roadmap, and implementation plan.
type: plan
status: draft
tags: [bot-filtering, analytics, positioning, roadmap, privacy]
projects: [analytics-platform]
date: 2026-04-18
---

# Edge vs Client-Side Analytics and Bot Filtering Strategy

## 1. Problem

Two related failures hurt Lumitra's credibility as a privacy-friendly analytics product:

1. **Users confuse edge and client-side analytics numbers.** They see Cloudflare showing "3.4k requests" and Lumitra showing "200 visits" and assume Lumitra is broken. It isn't: those are measuring different things. We don't educate users anywhere on the product or docs.
2. **We have no bot filtering.** Zero. No UA filter, no IP/ASN list, no behavioral signals, no rate limits beyond a 100-req/min API key cap. Every headless Chrome, every data-center scraper, every `curl` hit goes straight into ClickHouse, inflates pageview counts, and (on cloud tiers) would inflate bills.

The conceptual background (what each counts, why they diverge, IAB standards, reconciliation patterns) lives in `knowledge-base/docs/analytics/edge-vs-client-analytics.md`. That doc is the "what and why." This plan is the "what Lumitra does about it."

## 2. Why This Matters Now

- **Credibility gap vs Plausible.** They publicly document a 32k data-center IP list, referrer-spam filter, and "unnatural patterns" detection. We have nothing comparable. Every evaluation compares on this axis.
- **Cost risk on cloud tier.** When we launch billed tiers, every bot event is a paid event. PostHog, Amplitude, Mixpanel all bill bots. Plausible doesn't. That's a real selling point we're leaving on the table.
- **Ingest cost today.** ClickHouse disk fills with junk. Materialized views (`pageviews_hourly_mv`, `sessions_summary_mv`) aggregate bot noise into user-visible charts.
- **Session replay cost is amplified.** Bot sessions with `replay_chunk` events blow up MinIO/S3 storage for replays nobody will watch.

## 3. Current State (from codebase audit)

Mapped at `packages/tracker/`, `packages/dashboard/src/app/api/collect/`, `packages/shared/`.

### What exists
- **Tracker** (`packages/tracker/src/index.ts:44-51`): pure client-side JS, ~5KB gzipped, zero runtime deps. Collects UA string at `tracker.ts:213`. No bot-awareness whatsoever.
- **Ingestion** (`packages/dashboard/src/app/api/collect/route.ts`): API-key auth, Zod validation, IP hashing via SHA-256 daily salt at `lib/enrich.ts:13-15`, rate limit of 100 req/min per API key at `lib/rate-limit.ts:1-29` (in-memory, resets on restart). `dropped: 0` is always returned at `route.ts:106-110`, we literally never drop anything.
- **Schema** (`packages/shared/src/clickhouse-ddl.ts`): single wide `events` table with `user_agent`, `ip_hash`, `type`, `device_type`, `timestamp`. Three materialized views aggregate without any bot-exclusion `WHERE` clause.
- **Privacy**: IPs hashed (not stored raw). Two-phase consent (core pageviews always on, behavioral behind `enableTracking()` at `tracker.ts:66-69`). DNT header ignored. Cookieless (uses sessionStorage).

### Gaps
1. No UA filter. `isbot` (~2KB, MIT) or Matomo's `device-detector` patterns: not installed.
2. No schema columns for bot marking (`is_bot`, `bot_score`, `bot_reason`, `asn`, `asn_name`).
3. No IP/ASN reputation. No data-center block list. No verified-bot reverse-DNS.
4. No client-side headless fingerprinting (`navigator.webdriver`, plugin count, `chrome.runtime`).
5. No referrer-spam filter.
6. No per-IP rate limit (only per-API-key).
7. Materialized views ingest everything. No bot-exclusion logic.
8. Zero documentation on the distinction or on filtering posture.
9. No dashboard UI for bot inspection, bot percentage breakdown, or "exclude bots" toggle.
10. No "bots never billed" SLA or marketing message.

## 4. Competitive Landscape

Full audit in the research output. Condensed matrix:

| Product | UA filter | Datacenter IP | Headless detection | Referrer spam | Edge-vs-client docs | Bot % in UI | Bots-never-billed |
|---|---|---|---|---|---|---|---|
| **Plausible cloud** | yes | ~32k ranges | partial | yes | yes (best in class) | no | implicit |
| **Plausible CE** | yes | light/none | no | yes | yes | no | n/a |
| **Fathom** | yes | yes (undisclosed) | undisclosed | yes | no | no | implicit |
| **Umami** | `isbot` only | env var only | no | no | no | no | n/a |
| **Matomo** | `device-detector` | plugin only | no | plugin | yes | no | n/a |
| **PostHog** | yes + CDP | dynamic CIDR | partial | no | partial | no | reactive refunds |
| **Cloudflare WA** | ML + JSD | Core bot mgmt | yes | yes | yes | no | free |
| **GA4** | IAB/ABC | no | no | no | no | no | free |
| **Mixpanel / Amplitude** | IAB/ABC | manual | no | no | no | no | no (billed) |
| **Lumitra (today)** | **no** | **no** | **no** | **no** | **no** | **no** | **not declared** |
| **Lumitra (this plan)** | yes | yes, versioned | yes | yes | yes | yes | yes, published SLA |

### Where we can actually win (5 exploitable gaps)

1. **Versioned, inspectable data-center IP blocklist.** Only Plausible does this, only on cloud. Ship it as `blocklists/datacenter-ips.txt` in the repo, GitHub Actions auto-refresh from AWS/GCP/Azure/Hetzner/DO/OVH published ranges. Open-source, PR-welcome.
2. **Signed beacons against direct-endpoint forgery.** Casey Primozic documented forged POSTs to Plausible's `/api/event`. HMAC over `site_id + timestamp`, short-lived token issued by the tracker script, rotated daily. Nobody advertises this.
3. **Headless-browser fingerprinting out of the box.** `navigator.webdriver`, plugin count, `chrome.runtime`, UA build-number sanity check (4-digit minor = fake, per [PostHog #2921](https://github.com/PostHog/posthog-js/issues/2921)). Free, deterministic, client-side.
4. **Edge and client numbers shown side-by-side in the dashboard.** Nobody does this. "You received 14,302 total requests this month; we filtered 9,104 bots; 5,198 real users." Turns the bot problem into trust.
5. **"Zero bot events billed, ever" as a published SLA.** PostHog refunds reactively. Amplitude/Mixpanel charge. Plausible filters silently. A loud, published guarantee differentiates on billing transparency.

### Where we need parity (not to lose deals)

- UA-based bot filter (table stakes, use Matomo `device-detector` list)
- Referrer-spam blocklist (port `plausible/referrer-blocklist` upstream)
- Internal-IP exclusion in dashboard UI
- Exclude-my-own-visits (localStorage flag)
- Custom UA / IP regex rules per site
- Hostname allowlist
- Country-level exclusion
- Server-side events API with same bot filtering applied

## 5. Positioning

**Draft one-liner:**

> "Privacy-friendly analytics that filter bots like Cloudflare, bill like nobody (zero bot events, guaranteed), and show you exactly how many we killed."

**Expanded positioning:**

> "The only self-hosted analytics stack that ships a versioned datacenter-IP blocklist, signed beacons to kill direct-endpoint forgery, and headless-browser fingerprinting out of the box. No bots ever reach your ClickHouse. No bots ever hit your bill. And we show you the delta in the dashboard so you know exactly how many were filtered."

Both need real testing against users before commitment, but the anchor is: **transparency + billing guarantee + ship the list publicly**.

## 6. Feature Roadmap

### Phase 1: MVP filtering (Sprint 1, ~1 engineer-week)

Goal: catch 70-80% of noise with minimal client weight and no paid dependencies.

1. **Schema migration**: add `is_bot BOOL`, `bot_score FLOAT`, `bot_reason LowCardinality(String) ENUM('ua','headless','datacenter','referrer_spam','velocity','forged_beacon')`, `asn UInt32`, `asn_name LowCardinality(String)`.
2. **Server-side UA filter**: integrate `isbot` (or vendor Matomo `bots.yml` as a build-time compiled regex). Apply in `enrich.ts` before insert. Mark, don't drop, by default.
3. **Server-side referrer-spam filter**: port `plausible/referrer-blocklist`, auto-sync monthly via GitHub Actions.
4. **Materialized-view filter**: add `WHERE is_bot = 0` to `pageviews_hourly_mv`, `sessions_summary_mv`, `heatmap_selectors_mv`. Add a parallel `_raw_mv` without the filter for audit views.
5. **Client-side webdriver flag**: send `{ webdriver: navigator.webdriver === true }` as a session property. ~3 lines in tracker, ~20 bytes overhead.
6. **Per-IP rate limit**: sliding window in Redis (or SQLite for CE), 60 req/min/IP hard cap.
7. **Dashboard toggle**: "Exclude bots" on/off per view. Default on.

### Phase 2: Credible defense (Sprint 2, ~1 engineer-week)

Goal: match Plausible cloud, beat everyone else on transparency.

8. **Datacenter IP blocklist**: vendor `ipverse/asn-ip` CIDRs for AWS, GCP, Azure, Hetzner, DO, OVH, Linode, Vultr. Compile into a longest-prefix-match trie (`cidranger` or similar). Ship as `blocklists/datacenter-ips.txt` in the repo, refreshed monthly by CI.
9. **Verified good-bot path**: reverse-DNS + forward-DNS check for Googlebot, Bingbot, AppleBot, DuckDuckBot, FacebookExternalHit. Route into a separate `bot_events` table. Don't pollute `events`. Let dashboards surface "Googlebot crawled 142 pages" as a positive signal.
10. **Signed beacons**: tracker requests a short-lived HMAC token from `/api/tracker-init`, attaches to every beacon. Server rejects unsigned/expired requests to `/api/collect`. Token rotates daily. Defeats the Casey Primozic forgery vector.
11. **Headless fingerprinting bundle**: `BotD`-style client check (`navigator.webdriver`, missing `chrome.runtime`, suspicious `userAgentData.brands`, plugin count, UA build-number sanity). Ship as optional `trackerBotDetection: true` config. ~2KB addition.
12. **Dashboard bot-transparency panel**: pie chart of filtered reasons, timeseries of bot volume, top bot UAs, top bot ASNs, "x bots filtered this month" counter.
13. **"Edge vs client" explainer**: in-product education, one modal on first dashboard visit, permanent link in help.

### Phase 3: Advanced (later, ~1 engineer-week)

14. **Anomaly detection batch job**: nightly ClickHouse batch, IsolationForest over session features (pageviews/session, avg dwell, unique paths, scroll events). Flag anomalies into `suspicious_sessions` for manual review.
15. **Per-ASN + per-UA-hash velocity anomalies** in Redis. Catches distributed scrapers rotating IPs.
16. **"Bots never billed" SLA**: publish, enforce, show in dashboard how much was saved.
17. **Per-site custom UA/IP rules** in the dashboard (match Amplitude/PostHog parity).

### Skip entirely (tracked for future explicit reconsideration only)

- Fingerprinting (FingerprintJS open-source is BSL-licensed; privacy-law baggage via GDPR identifier; breaks the "privacy-friendly" value prop).
- CAPTCHAs / Turnstile on pageview beacons (breaks "lightweight, invisible").
- Proof-of-work tokens per pageview (too expensive).
- Paid bot-detection APIs (DataDome, Arkose): not compatible with self-hosted positioning.

## 7. Implementation Plan

Files and rough effort per Phase 1 + 2. All estimates are a single-engineer evening-block unit (~3-4h).

| # | Task | File(s) | Effort |
|---|---|---|---|
| 1 | Schema columns + migration | `packages/shared/src/clickhouse-ddl.ts`, new migration script | 0.5 block |
| 2 | MV updates | `packages/shared/src/clickhouse-ddl.ts` (views section) | 0.5 block |
| 3 | `isbot` integration + enrich | `packages/dashboard/src/lib/enrich.ts` (+30 lines) | 1 block |
| 4 | Referrer-spam filter | `packages/dashboard/src/lib/enrich.ts`, new `lib/referrer-spam.ts` | 0.5 block |
| 5 | Per-IP rate limit | `packages/dashboard/src/lib/rate-limit.ts` (extend) | 1 block |
| 6 | Tracker webdriver flag | `packages/tracker/src/tracker.ts` (+5 lines) | 0.25 block |
| 7 | Dashboard "Exclude bots" toggle | Dashboard filters UI | 1 block |
| 8 | Datacenter IP trie + loader | `packages/dashboard/src/lib/asn/`, blocklists/ dir | 2 blocks |
| 9 | Datacenter IP GitHub Actions refresher | `.github/workflows/refresh-blocklists.yml` | 0.5 block |
| 10 | Reverse-DNS verified bots | `packages/dashboard/src/lib/bot-verify.ts` | 1.5 blocks |
| 11 | `bot_events` table + dashboard view | DDL + new dashboard page | 1 block |
| 12 | Signed beacons (HMAC) | `packages/tracker/src/tracker.ts`, new `/api/tracker-init`, verify in `/api/collect` | 2 blocks |
| 13 | Headless fingerprint bundle | `packages/tracker/src/bot-detect.ts` (new, ~2KB) | 1.5 blocks |
| 14 | Dashboard transparency panel | New page + ClickHouse queries | 2 blocks |
| 15 | Edge-vs-client first-run modal + help article | Dashboard + `docs/public/` | 1 block |
| 16 | Public blocklists README + contrib docs | `blocklists/README.md` | 0.25 block |

**Total**: ~16.5 evening blocks = 3-4 weeks of evening work at sustainable pace, or 1.5 weeks of focused day work.

### Suggested order (optimize for perceived progress + user value)
1. Schema + MV filter (foundation, unblocks everything).
2. `isbot` + webdriver flag + rate limit (immediate noise reduction).
3. Dashboard "Exclude bots" toggle (visible user value).
4. Datacenter IP blocklist + GH Actions (first unique differentiator).
5. Signed beacons (second unique differentiator).
6. Transparency panel (the selling point made visible).
7. Headless bundle + referrer spam (parity polish).
8. Docs/education (public launch-ready).

## 8. Documentation and Education Asks

- `docs/public/bot-filtering.md`: what we filter, how to verify, how to contribute a rule.
- `docs/public/accuracy.md`: edge vs client explainer, with screenshots comparing Cloudflare edge to Lumitra.
- `docs/internal/architecture.md`: update to describe the bot-filter pipeline.
- `README.md`: add "Bot filtering" to the features section.
- First-run modal in dashboard: "Your numbers might look lower than Cloudflare. Here's why." Link to accuracy page.
- Tooltip on every pageview/visitor count: "Bots excluded (X filtered)."
- Public blocklists in the repo, with a CONTRIBUTING note on how to propose additions.

## 9. Open Questions

1. **Where do tokens for signed beacons live?** Redis (another service dep) vs in-memory (breaks on multi-node) vs signed JWT with short TTL (no state). Likely JWT, but needs design.
2. **Do we expose raw UA + IP (hashed) in the dashboard, or only derived fields?** Privacy posture vs debuggability tradeoff.
3. **Ingestion-time drop vs mark-only?** Default to mark (keep for audit), configurable per project to drop. Drop saves ClickHouse disk; mark keeps forensic trail.
4. **Should bot events count toward free-tier pageview caps?** Answer: no, but requires billing integration awareness from day one. Depends on when we ship billing.
5. **Do we support DNT header?** Not bot-filter-related, but should be decided in the same sprint. Recommend: respect DNT by default, toggleable per project.
6. **How do we verify the datacenter IP list stays current?** GitHub Actions CI refresh. What's the alert if a run fails? Needs to not silently decay.
7. **What's our story for AI crawlers** (GPTBot, ClaudeBot, PerplexityBot, CCBot)? Block? Allow but flag? Expose a per-site toggle? Recommended: flag into `bot_events` as verified, expose a per-site toggle "block AI crawlers at beacon level" (doesn't actually block them from the server, but excludes from analytics).

## 10. Success Metrics

- **Quantitative**:
  - % of incoming events marked `is_bot = true` (target: match Imperva baseline of ~40-50% on a seed-traffic test site)
  - Reduction in `sessions_summary_mv` pageview counts after filter (target: 30-50% drop on test sites)
  - Dashboard p95 query latency unchanged or improved (less data scanned)
  - ClickHouse disk usage growth rate cut by ~40% on bot-heavy sites
- **Qualitative**:
  - Self-hosting users stop opening issues about "why is Lumitra showing so many bots"
  - Mentions in comparison posts (Loopwerk, Reddit, HN) flip from "weak bot filtering" to "strong"
  - At least one "we chose Lumitra because of the transparency panel" quote from a user

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| False positives dropping real users | High | Default to mark, not drop. Always let users audit. |
| IAB/ABC list costs ($5-15k/yr) if we need MRC compliance | Medium | Skip for now, use Matomo free list. Revisit if enterprise deals demand MRC. |
| Datacenter IP list stale and blocks new cloud providers | Medium | Monthly CI refresh with alerting on failure. |
| Signed beacons break if token endpoint is adblocked | Medium | Same domain as beacon, reverse-proxied. If blocked, event still accepted without signature (with lower `bot_score` confidence). |
| Tracker weight balloons past 5KB | High | Budget strict: webdriver check + honeypot = ~0.5KB. Full headless bundle gated behind `trackerBotDetection: true`. |
| Bot-transparency panel scares users ("we got 60% bot traffic?!") | Low | Framing: "we filtered X bots for you, X real users remain." Position as value. |

## 12. Appendix: Key Reference Material

- Context / theory: `knowledge-base/docs/analytics/edge-vs-client-analytics.md`
- Current architecture: `docs/internal/architecture.md`
- Phase history: `ROADMAP.md`
- Matomo bot patterns source: [`matomo-org/device-detector/regexes/bots.yml`](https://github.com/matomo-org/device-detector/blob/master/regexes/bots.yml)
- Referrer-spam source: [`plausible/referrer-blocklist`](https://github.com/plausible/referrer-blocklist)
- ASN data source: [`ipverse/asn-ip`](https://github.com/ipverse/asn-ip), [iptoasn.com](https://iptoasn.com/)
- `isbot` library: [omrilotan/isbot](https://github.com/omrilotan/isbot)
- `BotD` (MIT headless detection): [fingerprintjs/BotD](https://github.com/fingerprintjs/BotD)
- Verified-bot DNS lists: [Google crawlers verification](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests), [Bing verification](https://blogs.bing.com/webmaster/August-2012/How-to-Verify-that-Bingbot-is-Bingbot)
- Plausible's data-center IP list disclosure: [plausible/analytics #137](https://github.com/plausible/analytics/discussions/137)
- Fake Chrome UA issue reference: [PostHog/posthog-js #2921](https://github.com/PostHog/posthog-js/issues/2921)
- Casey Primozic forged beacon investigation: [cprimozic.net](https://cprimozic.net/notes/posts/investigating-strange-artificial-plausible-analytics-events/)

## 13. Next Step

Decision needed from Marlin before moving to `status: decided`:

1. Approve the Phase 1 scope (or trim).
2. Approve the two differentiators (datacenter list + signed beacons) as Phase 2 priorities, or pick different ones.
3. Decide on positioning line (the draft here, or a tighter one).
4. Confirm no billed-tier timeline pressure that would push signed beacons or bot-transparency panel earlier.

When decided, move this file to `status: decided`, create ROADMAP entries for Phase 1 tasks, and begin implementation.
