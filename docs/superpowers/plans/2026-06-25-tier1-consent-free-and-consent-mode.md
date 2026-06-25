---
type: plan
status: draft
date: 2026-06-25
title: Tier-1 Consent-Free + Consent-Mode Architecture (make the central claim true)
summary: A code audit found that Tier 1 is not actually consent-free: the tracker writes to sessionStorage on init() before any consent, which legally triggers a cookie banner under German law and destroys the consent-free wedge. This plan specifies the fix: client stores nothing pre-consent, sessionization moves server-side with a secret salt, a default-deny consent signal gates all Tier-2 features, plus Global Privacy Control, retention controls, and the processor docs.
tags: [gdpr, eprivacy, consent, privacy, analytics-platform, session-replay]
projects: [analytics-platform]
---

# Tier-1 Consent-Free + Consent-Mode Architecture

## Goal

Make the product's central claim TRUE in code.

Lumitra Analytics (`@marlinjai/analytics-tracker`) positions itself as:

- **Tier 1 = consent-free**: cookieless, no device storage, compliant up to the strict German ceiling, runs with no cookie banner.
- **Tier 2 = consent-gated**: session replay, heatmaps, persistent or identified IDs, only after an explicit opt-in.

A code audit found **Tier 1 is not actually consent-free**. The tracker touches the user's device (sessionStorage) on `init()`, before anyone has consented to anything. Under European Union (EU) ePrivacy law, and especially under the strict German ceiling, that single fact legally requires a consent banner. The wedge the whole product is sold on is currently false in code.

This plan fixes that. It is the strategic core: every workstream below exists to move the line so that the Tier-1 path genuinely never reads or writes the device.

> [!warning] NEEDS LEGAL SIGN-OFF
> The "consent-free" claim must be reviewed by a qualified EU / German data-protection lawyer or a Data Protection Officer (DPO) before we rely on it in production. The salted-hash anonymity question (does a daily salted IP hash count as anonymous or merely pseudonymous?) is genuinely unsettled in case law and supervisory-authority guidance. Engineering can make the device-access claim airtight; only a lawyer can sign off on the "consent-free" marketing claim. Do not put "no banner needed" in customer-facing copy until that sign-off exists. The companion Obsidian note stresses this explicitly.

Legal companion in the Obsidian vault: `Computer Science & Software Development/GDPR and ePrivacy for Web Analytics`. The European Data Protection Board (EDPB) Guidelines 2/2023 on the technical scope of ePrivacy Directive Article 5(3) are the controlling interpretation referenced throughout.

---

## 0. Review corrections (adversarial review, 2026-06-25)

An independent review verified every code claim in this plan against `origin/main` (all confirmed) and found gaps that change the scope. **Read these before implementing: P1 as originally written below would NOT fully make Tier 1 consent-free.**

### 0.1 The A/B middleware writes a 1-year cookie with no consent gate (the biggest gap)

Workstream (a) and the Section 4 "Experiment stickiness" row propose leaning on the existing `lumitra_variants_pub` server path "without any device write." **That is false.** `packages/react/src/middleware.ts` sets three cookies on the response with no consent input: `lumitra_uid` (HttpOnly, **maxAge = 1 year**, a `crypto.randomUUID` stable per-visitor identifier), `lumitra_variants` (signed, 1yr), and `lumitra_variants_pub` (client-readable, 1yr). A server `Set-Cookie` is "storing information on terminal equipment" under Article 5(3) / Section 25 exactly as much as `sessionStorage.setItem`, and `lumitra_uid` is the worst case: a 1-year stable cross-session unique identifier, which is both ePrivacy device storage AND personal data under GDPR. So after P1 removes `sessionStorage`, Tier 1 STILL writes to the device the moment a customer uses the A/B middleware. The Tier table currently (wrongly) lists experiments as consent-free Tier 1.

**Decision required (see 6.D1):** either make A/B assignment genuinely cookieless (deterministic on the daily visitor key, no persistent `lumitra_uid`) and keep it Tier 1, OR reclassify the whole middleware-cookie A/B path as consent-gated Tier 2. A 1-year `lumitra_uid` cannot coexist with a consent-free claim under any reading. **This belongs in P1**, not a later phase.

### 0.2 Raw IP is sent to a US third party over plaintext HTTP at ingestion

The plan says the raw IP is "discarded at ingestion (good)" and "never log raw IP anywhere," and workstream (f) promises EU residency. But `packages/dashboard/src/lib/enrich.ts` calls `lookupCountry(ip)` = `fetch('http://ip-api.com/json/{ip}...')` on every cache-miss IP, on both the `/api/collect` and `/api/ingest` paths. That is a transfer of the raw IP (personal data) to a US-based processor, over unencrypted HTTP, with no Data Processing Agreement / Standard Contractual Clauses. The IP is not stored locally, but it leaves the EU before it is discarded, so the EU-residency and "no raw IP" framing is untrue as implemented. **Add to P1: replace the third-party geo call with a self-hosted local geo database (MaxMind GeoLite2 / DB-IP) bundled in the dashboard container.** (See 6.D5.)

### 0.3 Server-side sessionization is an MV + ingestion rework, not a one-line hash change

Workstream (a) frames the change as "fold the user-agent + project into the key." But `sessions_summary_mv` and the heatmap session counts aggregate on a STORED `session_id` (`uniqExact(session_id)`) computed at insert time. To stitch pageviews into one session within a 30-minute window, ingestion must resolve a real `session_id` at write time (a stateful per-visitorKey last-seen lookup on the hot path), OR sessionization moves to query time (window functions over `ip_hash` + timestamp gaps, reworking the session-based materialized views). Either is materially more than a hash tweak, and the plan must pick one and budget for it. **Recommended (6.D6): query-time gap sessionization, which keeps ingestion a stateless pure hash.**

### 0.4 Smaller items folded in

- **Historical cutover:** existing `ip_hash` values used the date-string salt; after the secret salt the same visitor will not match across the cut, so pre/post-cutover visitor and session metrics are not comparable, and the events table will mix client-minted and server-derived `session_id` schemes. Treat as a hard cutover with a dated dashboard annotation (do not try to re-derive old hashes; that is impossible by design and is the point). Consider a short shadow/dual-compute period to quantify the delta (6.D2).
- **Consent Management Platform (CMP) integration:** specify a thin `setConsent({analytics, replay})` adapter the customer fires from their CMP's consent-changed callback (Usercentrics / Cookiebot / IAB Transparency and Consent Framework, the German-market default), plus explicit default-deny on the first consent-unknown request and at least one worked TCF/Usercentrics example.
- **Bot filtering:** with no client id, JavaScript-capable bots collapse by IP+UA and inflate visitor/session counts. Add a server-side user-agent blocklist (the standard known-bots list) at ingestion. Non-JS bots already self-filter by never loading the tracker.
- **`auto_consent` test links:** `test_links.auto_consent` (default true) would silently bypass the new default-deny gate. Restrict it to internal QA on owned properties; never let a test link grant Tier-2 consent for real visitor traffic (6.D10).
- **B2B NAT note:** the German Mittelstand target sits behind corporate NAT gateways running standardized browser builds, so IP+UA collisions merge distinct users into one visitor far more than the generic Plausible case. Set customer expectations and consider an inactivity-window tuning knob.

---

## 1. The Problem (with code evidence)

### 1.1 The tracker writes to the device before any consent

On `init()`, before the app has any chance to ask the user, the tracker creates a session and persists it to `sessionStorage`:

`packages/tracker/src/session.ts:8-20`

```ts
const stored = sessionStorage.getItem(SESSION_KEY);          // read on init
...
sessionStorage.setItem(SESSION_KEY, sessionId);              // write on init
sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));      // write on init
```

`getOrCreateSession()` is called straight from the `AnalyticsTracker` constructor (`packages/tracker/src/tracker.ts:36`), and `touchSession()` writes the last-activity timestamp on **every single** `track()` call (`packages/tracker/src/tracker.ts:231` calling `session.ts:24-26`). So even the "always on, no consent needed" pageview path writes to the device on every event.

The experiment layer does the same. Variant assignments are cached to `sessionStorage`:

`packages/tracker/src/experiment.ts` (around lines 50 and 58)

```ts
function readStoredAssignment(key: string) {
  return sessionStorage.getItem(`${EXP_STORAGE_PREFIX}${key}`);   // read
}
function storeAssignment(key: string, variant: string) {
  sessionStorage.setItem(`${EXP_STORAGE_PREFIX}${key}`, variant); // write
}
```

`resolveAssignment()` reads and writes these on assignment (`experiment.ts:288-298`), and `setVariant()` persists too (`experiment.ts:257-261`). All of this runs on the Tier-1 (pre-consent) path.

### 1.2 Why that legally requires a banner

The cookie-banner obligation is **not** a General Data Protection Regulation (GDPR) obligation about personal data. It is an **ePrivacy** obligation, and it has a different, broader trigger.

| Source | What it says | Consequence for us |
|--------|-------------|--------------------|
| ePrivacy Directive (Directive 2002/58/EC) Article 5(3) | Storing information on, or gaining access to information already stored in, a user's terminal equipment requires prior consent (narrow exemptions only). | Any read or write to the device needs consent unless strictly necessary. |
| EDPB Guidelines 2/2023 | "Storage" and "access" cover **any** technical means, explicitly including `localStorage` and `sessionStorage`, not just HTTP cookies. The trigger is the storage/access itself, **personal data or not**. | `sessionStorage.setItem` on `init()` is a regulated storage operation. |
| German Section 25 TDDDG (Telekommunikation-Digitale-Dienste-Datenschutz-Gesetz, the German transposition) | Same trigger as Article 5(3), and crucially **no legitimate-interest balancing test**. Storage/access is either strictly necessary or it needs consent. | Germany is the strict ceiling. There is no "we have a legitimate interest" escape hatch for the device write. |

The "strictly necessary" exemption is read narrowly by supervisory authorities. Analytics sessionization is **not** considered strictly necessary for a service the user explicitly requested. Therefore, writing `ap_session_id` to `sessionStorage` on `init()` means **Tier 1 legally requires a consent banner**.

That is the whole problem. A consent-free tier that needs a consent banner is not consent-free.

### 1.3 The strict ceiling: Germany

We target Germany, so we build to the German ceiling, not the EU average. Concretely:

- **Only genuinely server-side, no-device-access measurement is exempt.** If nothing is read from or written to the browser, Article 5(3) / Section 25 is simply not triggered: no banner.
- There is **no legitimate-interest balancing** under Section 25 to lean on. We cannot argue our way to "no consent needed" while still touching the device.
- This is exactly the model Plausible, Fathom, Matomo (cookieless mode), and PostHog (cookieless mode) run: measurement happens server-side, the client stores nothing.

### 1.4 Net

The product's core marketing and positioning claim ("Tier 1 = consent-free, no banner") is **currently false in code**. Every workstream below removes a device-access path until the claim is true.

---

## 2. Target Architecture (the fix)

Five engineering workstreams plus one docs workstream. Numbered so phases can reference them.

### (a) Client stores nothing pre-consent: move sessionization server-side

**Remove** the entire client session mechanism from the Tier-1 path:

- Delete the `sessionStorage` reads/writes in `session.ts` (`getOrCreateSession`, `touchSession`, `getSessionId`, `SESSION_KEY`, `LAST_ACTIVITY_KEY`).
- Delete the experiment-variant cache (`readStoredAssignment` / `storeAssignment` and the `EXP_STORAGE_PREFIX` `sessionStorage` calls in `experiment.ts`). Pre-consent, experiment assignment becomes a pure function of the server decision or a stateless per-request murmur, with nothing persisted on the device. **CORRECTION (see 0.1): the existing `lumitra_variants_pub` server path is NOT a "no device write" replacement: the A/B middleware sets a 1-year `lumitra_uid` cookie (plus two more) with no consent gate. That cookie path must be made cookieless, or moved to Tier 2, before it can serve the consent-free Tier-1 path. Decision 6.D1.**

**Move sessionization to the server.** Instead of a client-minted `sessionId`, the server stitches pageviews into sessions using a **per-day visitor key**:

```
visitorKey = sha256( secretSalt : ip : userAgent : projectId )
```

Pageviews from the same `visitorKey` within an inactivity window (reuse `SESSION_TIMEOUT_MS = 30 min`) are stitched into one session, server-side. This is the Plausible / Fathom / Matomo-cookieless / PostHog-cookieless model: the daily key rotates, so it is not a stable cross-day identifier, and nothing lands on the device.

**Good news: the server-side primitive half-exists.** `packages/dashboard/src/lib/enrich.ts` already computes an `ipHash` server-side at ingestion (`enrich.ts:149`) and stores it as `ip_hash` in ClickHouse. The `pageviews_hourly_mv` already counts visitors via `uniqExact(ip_hash)` (`clickhouse-ddl.ts:76`). So the visitor primitive is there. What is missing is (1) a real secret salt (see (b)) and (2) folding the user-agent + project into the key and using it as the sessionization key, not just a visitor counter.

### (b) Fix the salt: make it secret, random, and rotated

The daily salt is currently the **literal date string**:

`packages/dashboard/src/lib/enrich.ts:13-15`

```ts
function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD -> PUBLIC AND PREDICTABLE
}
```

So `ipHash = sha256("203.0.113.7:2026-06-25")`. The salt is public and predictable, which means it is **effectively no salt**. The IPv4 (Internet Protocol version 4) address space is only about 4.3 billion addresses, so anyone can brute-force the entire space against a known daily salt and reverse any `ip_hash` back to a raw IP in seconds. That defeats the entire point of hashing.

**Fix:**

| Aspect | Current | Target |
|--------|---------|--------|
| Salt value | Public date string | Secret, cryptographically random (for example 32 bytes) |
| Rotation | New string each day (predictable) | Rotated daily, then **discarded** (so old hashes can never be re-derived even by us) |
| Boundary handling | n/a | Keep **current + previous** day's salt in memory (or Redis / Postgres) so sessionization that spans the midnight rotation still stitches correctly |
| Raw IP | Discarded at ingestion (good) | Keep discarding it; **never log raw IP** anywhere |

A secret, random, daily-rotated-then-discarded salt makes the daily visitor key genuinely pseudonymous-within-the-day, which is the reasoning the Article 29 Working Party Opinion 05/2014 on Anonymisation Techniques (WP216) applies to salted-hash schemes. Discarding the salt at end of day is what stops yesterday's hashes from being reversible at all, which strengthens the anonymity argument.

The raw IP is already discarded at ingestion today, which is the correct behavior. Keep it.

### (c) Consent-signal API + default-deny

Today consent is **purely method-call-driven and has no default-deny**:

- The tracker takes **no consent input**. `init(config)` has no `consent` field (`packages/tracker/src/index.ts:15-32`).
- The app is expected to call `enableTracking()` / `enableReplay()` from its own cookie-consent callback (`tracker.ts:115`, `tracker.ts:186`; doc comments literally say "Call this from your cookie consent callback").
- There is **no propagated consent state** inside the tracker and **no default-deny gate**. If the app forgets to wire its consent callback correctly, or wires it wrong, behavioral tracking can silently run without consent. That is exactly the unhappy path that turns into a fine.

**Fix: add a first-class consent signal with default-deny.**

```ts
init({
  projectId, endpoint, apiKey,
  consent: { analytics: false, replay: false }, // default-deny
});

// later, from the consent UI:
setConsent({ analytics: true, replay: true });
```

Rules:

- **Default-deny**: if `consent` is omitted or a category is unset, that category is treated as **denied**. Tier-2 features stay off.
- A single `setConsent()` (and a `lumitra:consent-changed` event) gates **all** Tier-2 features in one place: `enableTracking()` (clicks, scroll, heatmaps), `enableReplay()`, and any persistent/identified ID (`identify()`).
- Tier-1 (server-side pageviews/sessions) runs regardless because, after workstreams (a) and (b), it touches no device and needs no consent. Tier-2 never runs without an explicit `true`.
- Revocation: `setConsent({ replay: false })` must call `disableReplay()` and detach behavioral listeners, not just stop new ones.

This makes consent a state the tracker owns and enforces, not a convention the integrator has to remember.

### (d) Honor Global Privacy Control (GPC), honor Do-Not-Track (DNT) as courtesy

- **Global Privacy Control (GPC)**: read `navigator.globalPrivacyControl` on the client and the `Sec-GPC: 1` request header on the server. When set, treat it as a **hard opt-out**: force all Tier-2 categories to denied, and ignore any later `setConsent({...: true})` for that visitor while GPC is on.
- **Do-Not-Track (DNT)**: honor `navigator.doNotTrack === '1'` as a **courtesy** opt-out (it is deprecated and inconsistently sent, so treat it as best-effort, not authoritative).

> [!important] GPC/DNT are NOT an EU consent substitute
> GPC and DNT are **opt-out** signals. EU/German law requires **opt-in** for Tier 2. So GPC absent does **not** mean consent is given. The model is: Tier 2 needs an explicit `setConsent(true)` AND the absence of a GPC/DNT opt-out. GPC is an **additional hard opt-out layer on top of** the opt-in requirement, never a replacement for it. (In some United States state-privacy regimes GPC *is* a valid opt-out mechanism, which is why we honor it as a hard signal, but that is a bonus, not the EU basis.)

### (e) Retention controls

Three retention problems today:

| Data | Where | Current retention | Problem |
|------|-------|-------------------|---------|
| Events (pageviews, clicks, scroll) | ClickHouse `events` table | Hard-coded `TTL ... + INTERVAL 12 MONTH` (`packages/shared/src/clickhouse-ddl.ts:59`) | Not per-tenant configurable; 12 months may be too long for some tenants. |
| Replay chunks | **Same** ClickHouse `events` table (`replay_chunk` column, `clickhouse-ddl.ts:34`), so **same 12-month TTL** | 12 months | Way too long for replay. The legal note cites 30 to 90 days as defensible for session replay. Replay is the highest-PII (Personally Identifiable Information) data we hold and it is sitting in the events table inheriting a 12-month TTL. |
| Page snapshots | Postgres `page_snapshots` table (`packages/shared/src/postgres-ddl.ts:79-91`) | **No TTL at all** | Unbounded growth of full rrweb DOM snapshots (which can contain PII rendered into the page). `maybeStoreSnapshot()` (`packages/dashboard/src/lib/snapshot-store.ts`) only ever inserts, never garbage-collects. |

**Fix:**

1. **Per-tenant configurable retention** for events (a setting persisted per project, applied to ClickHouse via TTL or scheduled deletes).
2. **A short, replay-specific TTL** (default in the 30 to 90 day range). This needs replay chunks to be separable from ordinary events for TTL purposes: either a dedicated `replay_chunks` table/partition, or a column-level TTL on `replay_chunk` so the heavy replay payload expires fast while aggregate event rows can live longer.
3. **A `page_snapshots` TTL + garbage collection**: add a `created_at`-based retention job (it already has `created_at`, `postgres-ddl.ts:86`) that deletes snapshots past the configured window.

### (f) Processor docs (flag for Marlin / legal sign-off, not code)

Not engineering, but part of making the claim real and sellable. Flagged for Marlin and legal, not to be drafted as final by engineering:

- **GDPR Article 28 Data Processing Agreement** (Auftragsverarbeitungsvertrag, AVV) template that customers sign. We are the **processor**; the customer is the **controller**.
- **Data Protection Impact Assessment (DPIA) template** specifically for session replay (replay is the high-risk processing that most often legally requires a DPIA).
- **EU residency documentation**: state plainly that data is processed and stored in the EU (Hetzner, EU region).
- Position the product as a processor in all docs; the customer remains the controller and is responsible for collecting consent on their site.

---

## 3. Tier Mapping Table

Every tracked thing, what tier it belongs to, whether it touches the device, and what changes under this plan. **For Tier 1, "Touches device?" must become NO.**

| Tracked thing | Tier today | Tier target | Touches device today? | Touches device after plan? | What changes |
|---------------|-----------|-------------|----------------------|---------------------------|--------------|
| Pageview | Tier 1 (always on) | Tier 1 | **YES** (`touchSession()` writes on every `track()`) | **NO** | Remove client session writes; pageview carries no client session id; server stitches via daily visitor key. |
| `session_start` | Tier 1 (fired on new client session, `tracker.ts:79`) | Tier 1 (derived) | **YES** (depends on `sessionStorage` session) | **NO** | No longer a client-minted event. Session boundaries are computed server-side from the visitor key + inactivity window. |
| Session id | Tier 1 | Tier 1 (server-derived) | **YES** (`ap_session_id` in `sessionStorage`) | **NO** | Client `sessionId` removed. Server assigns a session id from `sha256(secretSalt:ip:ua:project)` + time window. |
| Clicks | Tier 1-ish (gated only by `enableTracking()`, no default-deny) | Tier 2 | **YES** (writes session on `track()`) | **NO** client storage; gated by consent | Behind explicit `setConsent({analytics:true})`, default-deny. No device write either way. |
| Scroll depth | same as clicks | Tier 2 | **YES** | **NO** client storage; gated by consent | Same gate as clicks. |
| Heatmap (click/scroll aggregation) | Tier 2 (server MV over clicks) | Tier 2 | Inherits click device-write today | **NO** | Driven by consented clicks only; aggregation stays server-side. |
| Session replay (rrweb) | Tier 2 (`enableReplay()`) | Tier 2 | **YES** (rides the same `track()` session write) | **NO** client storage; gated by consent | Explicit `setConsent({replay:true})`, default-deny; short replay-specific TTL (workstream e). |
| Experiment / variant assignment | Tier 1 (pre-consent, cached to `sessionStorage`, `experiment.ts:50/58`) | Tier 1 (stateless) | **YES** (`ap_exp_*` in `sessionStorage`) | **NO** | Drop the `sessionStorage` cache. Use the server `lumitra_variants_pub` decision or a stateless per-request murmur; nothing persisted on device. |
| Persistent / identified id (`identify()`) | Tier 1 method, no consent gate | Tier 2 | No storage today, but creates a stable cross-session identifier | Gated by consent | A persistent ID is the textbook Tier-2 case. Behind explicit consent, default-deny. |
| GPC / DNT signal | not honored | cross-cutting | Read-only (no write) | Read-only | New: hard opt-out (GPC) / courtesy opt-out (DNT) layered on top of consent. |

Reading `navigator.globalPrivacyControl` / `navigator.doNotTrack` is a property read, not device storage, so it does not trigger Article 5(3). Safe on the Tier-1 path.

---

## 4. Trade-offs (honest)

| Trade-off | Impact | Mitigation |
|-----------|--------|------------|
| **Server-side sessionization changes how session counts and duration are computed** (server, from IP+UA+window, not a client UUID). | Numbers may **shift** vs today. Two people behind one corporate NAT (Network Address Translation) gateway with the same browser can merge into one session; one person on two networks can split. Session duration is now bounded by server-seen events, not client liveness. | Document the methodology change as a known, one-time discontinuity. Annotate the dashboard at the cutover date. This is the same trade-off Plausible/Fathom already ship and customers accept. Tune the inactivity window if merges/splits are bad in practice. |
| **The secret-salt daily rotation resets visitor dedupe at the rotation boundary.** | A visitor active across midnight could be counted twice (once per day's salt), and cross-day "unique visitor" is intentionally not possible (that is the point: no stable cross-day id without consent). | Keep **current + previous** day's salt in memory to bridge sessions that straddle midnight (workstream b). Accept that cross-day uniqueness is a Tier-2 (consented) feature, by design, not a bug. |
| **Removing the client session id may break features that read it.** | Any code calling `getSessionId()` / `getOrCreateSession()` / reading `SESSION_KEY` breaks. | **Audit before removal.** Grep already shows the only non-test callers are `tracker.ts:6,36,231` and `session.ts` itself (the `ExperimentManager` takes the session id as its identity seed, `experiment.ts:93`). Replace the identity seed with the server-decided id or a stateless per-request value. Update the `session.test.ts` suite. Confirm no consumer in `packages/react`, `packages/node`, or the dashboard reads a client session id before deleting. |
| **Experiment stickiness changes** (no `sessionStorage` cache pre-consent). | Without the cache, a reload could re-roll a client-self-assigned variant if the server decision is absent. | A deterministic murmur on the daily visitor key is stable within the day with no device write. **CORRECTION (0.1): the `lumitra_variants_pub` middleware path is NOT "without any device write": it sets a 1-year `lumitra_uid` cookie pre-consent. Make assignment cookieless or reclassify it to Tier 2 (6.D1). Cross-day sticky assignment via a persistent uid is a consented Tier-2 upgrade, by design.** |

---

## 5. Phased Breakdown

| Phase | Scope | Depends on | Why this order |
|-------|-------|-----------|----------------|
| **P1** | Client storage-free + server sessionization + secret salt. Remove `sessionStorage` from `session.ts` and `experiment.ts`; add server-side sessionization keyed on the visitor key; replace the date-string salt with a secret, random, daily-rotated-then-discarded salt (current + previous in memory). | none | This is the phase that actually makes Tier 1 consent-free. Everything else is on top of a still-leaky base until this lands. Do it first. |
| **P2** | Consent-signal API + default-deny + GPC/DNT. Add `init({consent})` and `setConsent()` / `lumitra:consent-changed`; route all Tier-2 features through one default-deny gate; honor GPC as hard opt-out and DNT as courtesy. | P1 (so the gated features sit on a storage-free base) | Turns "the integrator must remember to call enableTracking" into "the tracker enforces consent." |
| **P3** | Retention controls. Per-tenant event retention; short replay-specific TTL (separate replay chunks for TTL purposes); `page_snapshots` TTL + garbage collection. | independent of P1/P2 (can run in parallel), but replay TTL pairs naturally with P2's replay consent gate | Data-minimization is a GDPR principle in its own right; replay's 12-month TTL is the most urgent single fix here. |
| **P4** | DPA/DPIA docs + EU residency doc. Article 28 AVV template, replay DPIA template, EU residency statement, processor/controller framing. | P1+P2 should be real first (the docs describe the actual behavior) | Docs must describe shipped reality, not aspiration. Flagged for Marlin + legal sign-off, not engineering-final. |

Dependencies in one line: **P1 unblocks the truthful claim; P2 builds the consent gate on it; P3 runs in parallel; P4 documents the result and goes to legal.**

---

## 6. Decisions for Marlin

Consolidated from the plan's open questions plus the 2026-06-25 review. A recommendation is given for each; the load-bearing ones for "is Tier 1 actually consent-free" are **D1, D5, D6**.

| # | Decision | Recommendation |
|---|----------|----------------|
| **D1** | **A/B testing: cookieless Tier-1, or consent-gated Tier-2?** The middleware sets a 1-year `lumitra_uid` (+2) cookie with no consent gate (0.1). | Make assignment **cookieless** (deterministic on the daily visitor key, no persistent `lumitra_uid`) and keep it Tier-1. Offer the 1-year sticky uid only as a Tier-2 (consented) upgrade. A 1-year uid cannot stay on the consent-free path. **Fold into P1.** |
| **D2** | Session-metric discontinuity at cutover. | Run server-side sessionization in **shadow** alongside client sessions for ~2 to 4 weeks (cheap at B2B volume), compare, then hard-cut with a dated dashboard annotation. State plainly that pre/post numbers are not comparable. |
| **D3** | Any OTHER device read/write re-triggering Article 5(3)? | Yes: the A/B cookies (D1) and the geo IP transfer (D5). Tier 1 is not storage-free until both are fixed. Answer is "not clean yet": pull both into P1. |
| **D4** | Where does the rotating secret salt live? | **Postgres** as source of truth (durable, in-stack, shared across instances); each instance caches current + previous salt in memory and refreshes daily. No new Redis dependency for a once-daily 32-byte value; never in-process-only (it would re-roll and split sessions on every restart/deploy). |
| **D5** | Geo lookup: keep `ip-api.com` (US, HTTP) or self-host? | **Self-host** MaxMind GeoLite2 / DB-IP locally so the raw IP never leaves the EU. Only then are the EU-residency doc and "no raw IP" framing true. **P1.** |
| **D6** | Sessionization mechanism: ingest-time stateful `session_id` vs query-time gap? | **Query-time gap sessionization** off `ip_hash` (keeps ingestion a stateless hash, no hot-path state store); rework the session-based materialized views. Only go ingest-time-stateful with a concrete query-performance reason, and then use ClickHouse itself as the last-seen store, not Redis. |
| **D7** | Replay TTL default. | **30 days** shipped default, per-tenant overridable to 90. Replay is the highest-PII data held; minimize by default. |
| **D8** | Per-tenant retention UI now or later? | Ship sane global defaults now (12-month events, 30-day replay, `page_snapshots` TTL + GC); add the per-tenant config UI as a P3 follow-up. Build the replay/snapshot TTL **enforcement** now (the urgent data-minimization fix); defer only the config surface. |
| **D9** | Who signs off on the consent-free claim, and when? | An **external German Fachanwalt fuer IT-Recht / Datenschutzrecht** for the public "kein Banner noetig" claim (a Data Protection Officer opinion is necessary but not sufficient for marketing copy). Ship the engineering in parallel; gate all customer-facing no-banner copy on the written external sign-off; get the salted-hash pseudonymous-vs-anonymous question addressed specifically. |
| **D10** | How do existing `auto_consent` test links interact with the new default-deny gate? | Restrict `auto_consent` to internal QA on owned properties only; never let a test link grant Tier-2 consent for real visitor traffic. Document the boundary. |
| **D11** | CMP integration shape. | Ship a thin documented `setConsent({analytics, replay})` adapter the customer fires from their CMP callback, plus a TCF/Usercentrics worked example; specify default-deny on the first consent-unknown request. |
| **D12** | Bot filtering once the client id is gone. | Server-side user-agent blocklist (standard known-bots list) at ingestion; optional known-bot IP-range filtering. Names the gap so visitor counts stay credible. |

---

## Summary

Tier 1 is sold as consent-free but writes to `sessionStorage` on `init()` (`session.ts:8-20`, `touchSession()` on every `track()`, plus the experiment cache in `experiment.ts`). Under EDPB Guidelines 2/2023 and German Section 25 TDDDG, any device write triggers the banner obligation, personal data or not, so the consent-free wedge is currently false in code. The fix: client stores nothing pre-consent, sessionization moves server-side onto the existing `ip_hash` primitive with a real secret salt (the current salt is the public date string, `enrich.ts:13`, which is brute-forceable), a default-deny consent signal gates all Tier-2 features, GPC/DNT are honored as opt-outs (not opt-in substitutes), and retention gets a short replay TTL plus a `page_snapshots` TTL. The "consent-free" claim ships only after a qualified EU/German lawyer signs off.

The 2026-06-25 review (Section 0) verified every code claim above and added three scope corrections that must be in P1 or Tier 1 is still not consent-free: the A/B middleware writes a 1-year `lumitra_uid` cookie with no consent gate (make assignment cookieless or move it to Tier 2, D1); the geo lookup ships the raw IP to a US service over plaintext HTTP (self-host the geo database, D5); and server-side sessionization is a materialized-view + ingestion rework, not a one-line hash change (query-time gap sessionization recommended, D6). All decisions are consolidated in Section 6.
