---
type: plan
status: draft
date: 2026-06-25
title: Session Replay Asset Rehosting Pipeline (replays that render in any project)
summary: Make session replays render faithfully across arbitrary customer sites without asking anyone to reconfigure CORS. Root cause is rrweb's inlineImages tainting the canvas on cross-origin assets. Phase 0 is a one-line tracker change that likely fixes the visible breakage; Phase 1 is a server-side asset-capture pipeline (fetch assets server-side, store in R2, rewrite replay events) for permanence against expiry, deletion, and auth-gated assets.
tags: [session-replay, rrweb, assets, r2, cors, privacy, analytics-platform, infrastructure]
projects: [analytics-platform]
---

# Session Replay Asset Rehosting Pipeline

## Goal

Session replays must render faithfully on **any** project the tracker is installed on, with **no per-project CORS or asset-origin configuration**. Today, replays of Lola Stories show blank product images (the marketplace renders as just the CSS gradient) and washed-out screens. The fix should be a one-time platform investment, not a checklist we hand every customer.

See the privacy/legal companion in the Obsidian vault: `Computer Science & Software Development/GDPR and ePrivacy for Web Analytics` (this pipeline stores customers' first-party assets, which has DPA + retention implications covered there).

## Problem and root cause

Session replay is DOM reconstruction (see [[2026-04-28-framework-agnostic-analytics-architecture]] and the `Framework-Agnostic Web Analytics Architecture` vault note), not video. The reconstructed DOM needs the page's images/CSS/fonts. Our tracker currently captures them with `inlineImages: true` (`packages/tracker/src/replay.ts`), which inlines an image by **drawing it to a `<canvas>` and calling `toDataURL()`**.

That is the exact failure:

- For a **cross-origin image without CORS headers**, the browser **taints the canvas**, `toDataURL()` throws a `SecurityError`, and rrweb leaves the image **blank**. Lola's marketplace/product images are served from a different origin (storage-brain / R2 / a CDN) without `Access-Control-Allow-Origin`, so they vanish. The gradient is CSS, which inlines fine, hence "gradient survives, products disappear."
- `inlineImages` also **bloats replay payloads** (every image becomes a base64 data URI in the event stream), and misses **lazy-loaded** images that had not loaded at snapshot time.
- `<canvas>`/WebGL content is a separate gap (handled by the new `recordCanvas` setting, shipped 2026-06-25, not this plan).

> [!important] The reframing insight
> A plain `<img src="https://cross-origin/...">` **displays fine cross-origin without any CORS**. CORS is only required to **read pixels back** (canvas `toDataURL`). `inlineImages` is the only reason we touch the canvas at all. So **turning `inlineImages` off** leaves the original `src` in the snapshot, and at replay the browser simply loads and displays it. That alone should fix the blank-marketplace symptom for public CDN images. The server-side pipeline then exists for **permanence**, not for basic display.

The industry split confirms the direction: rrweb-based tools (PostHog, us) hit this; FullStory and LogRocket run a **server-side asset-capture/rehosting** pipeline so cross-origin, signed-URL-expiry, and deletion stop mattering. A server fetch is **not subject to browser CORS**, which is the whole trick.

## Phase 0: stop tainting the canvas (quick win)

A near-zero-cost change that likely fixes the visible breakage immediately.

- In `packages/tracker/src/replay.ts`, set `inlineImages: false` (keep `inlineStylesheet: true` and `collectFonts: true` for now).
- Effect: image `src` (and `srcset`) stay as original URLs in the snapshot. At replay the iframe loads them live, cross-origin, and **displays them** (no CORS needed for display). Payloads shrink substantially.
- Honest tradeoffs we accept until Phase 1:
  - Replay fidelity now depends on the asset still being **reachable at replay time**: expired signed URLs, deleted assets, and auth-gated assets render blank.
  - The replay viewer's browser (the dashboard user) fetches the customer's assets **live** at view time (a minor data-flow + slight info-leak consideration; Phase 1 removes it by serving from our R2).
- Verify: record a Lola session after deploy, confirm marketplace images render in the replay viewer.

This is the unblock. Ship it first and measure before building Phase 1.

## Phase 1: server-side asset rehosting pipeline (permanence)

Capture every asset URL a replay references, fetch it **server-side** (no browser CORS), store it once in R2 (content-addressed), and rewrite the replay to point at our copy. This is the FullStory/LogRocket model adapted to our stack (Next.js dashboard + ClickHouse for events + R2 for blobs + Postgres for config/state).

### Where asset URLs live in the event stream

rrweb events carry asset references in:
- Full snapshot (`type: 2`) and incremental "add node" mutations (`type: 3`, `source: 0`): `img[src]`, `img[srcset]` / `source[srcset]`, `link[rel=stylesheet|icon|preload][href]`, `video[poster]`/`[src]`, `audio[src]`, inline `style` attributes and inlined `<style>` text containing `url(...)`.
- URLs may be relative; resolve against the event's page URL (rrweb records the base href / the chunk carries `url`).

### Pipeline stages

| Stage | Where | What |
|---|---|---|
| 1. Extract | On `replay_chunk` ingest (`/api/collect`) or async post-ingest | Walk the chunk's events, collect absolute asset URLs, skip `data:` URIs |
| 2. Dedupe + enqueue | Postgres `replay_assets` | Upsert `url_hash -> {status: pending}` so each unique URL is fetched once across all sessions |
| 3. Fetch + store | Background worker (cron or queue) | SSRF-safe server fetch of each pending URL; store bytes in R2 keyed by `sha256(content)`; record `url_hash -> r2_key, content_type, bytes, status` |
| 4. Rewrite | Replay read (`/api/sessions/[id]/replay`) | Rewrite asset URLs in the reassembled events to `https://<assets-cdn>/<r2_key>`; any URL not yet `ready` falls back to its original URL (graceful) |
| 5. Serve | R2 + CDN | Replay viewer loads assets same-origin-ish from our CDN: no CORS, no expiry, immutable, cacheable forever (content-addressed) |

Rewrite at **read time** (stage 4) rather than mutating stored events: it is idempotent, lets late-captured assets start resolving automatically, and keeps the raw event stream intact for re-processing.

### Data model

```
-- Postgres
replay_assets (
  url_hash     text primary key,   -- sha256(absolute_url)
  source_url   text not null,
  r2_key       text,               -- sha256(content); null until fetched
  content_type text,
  bytes        int,
  status       text not null,      -- pending | ready | failed | skipped
  attempts     int not null default 0,
  fetched_at   timestamptz,
  last_error   text
)
```

R2 objects are content-addressed (`r2_key = sha256(content)`), so identical assets across sessions/projects dedupe automatically and the CDN can cache them immutably.

### SSRF safety (non-negotiable)

The fetcher pulls arbitrary URLs from untrusted customer sites, so it is an SSRF vector. The worker MUST: allow only `http`/`https`; resolve and **block private/link-local/loopback IP ranges** and our own internal hosts; cap response size (e.g. <=5 MB, skip larger); set a short timeout; not follow redirects to disallowed targets; not forward our credentials/cookies.

### Edge cases

- **Auth-gated / signed-URL assets**: a server fetch lacks the user's credentials, so these may `403`. Mark `failed`, fall back to the original URL at replay. (Most marketplace/product images are public CDN URLs, so this is the minority.)
- **Already-inline `data:` URIs**: skip.
- **Large media / video**: size cap, skip and fall back.
- **Fonts**: Phase 2 (move `collectFonts` to the proxy too; same cross-origin caveat).
- **Canvas/WebGL**: out of scope here, covered by the `recordCanvas` setting.

## Phase 2: tighten

- Turn `inlineStylesheet`/`collectFonts` capture into proxied assets too (fonts have the same cross-origin caveat as images).
- `srcset` / responsive images, `<video>`/`<audio>`.
- Retention/GC: expire `replay_assets` + R2 objects in step with replay retention (see the GDPR note: align to the configured TTL; CNIL reference points are <=13/25 months, replay 30 to 90 days).
- Metrics: per-project asset capture rate, `failed` rate, R2 storage, dedupe ratio.
- **SSRF hardening (the `ssrf.ts` residual-vector follow-ups, tracked here so the in-code "Phase 2" pointers resolve):**
  - **DNS-rebinding (resolve-vs-connect TOCTOU):** `assertHostResolvesPublic` validates the resolved IP, then `fetch()` re-resolves the hostname at connect time. Pin the validated IP into the connection (custom dispatcher / `lookup` override), or re-resolve-and-compare at connect, so the IP we checked is the IP we hit.
  - **Threadpool / concurrency:** `dns.lookup` runs getaddrinfo on the bounded libuv threadpool. The fetch worker MUST cap concurrency so a burst of stalled lookups from untrusted hosts cannot starve the shared pool. (The per-operation wall-clock deadline added in the core bounds a single request; the cap bounds the fleet.)
  - **Defense-in-depth egress block:** drop outbound `169.254.169.254` + RFC1918 at the host/network layer of the worker, independent of the application-level block list.
  - **Per-chunk tag map:** the read/extract integration should pass the session id->tagName map to `walkAssets(..., seedIdToTag)` so attribute mutations referencing nodes added in earlier chunks are resolved tag-aware (otherwise they fall back to the conservative no-`href`/`data` subset).
  - **Runtime-swapped `<link>` rel:** a `<link href>` swapped via an attribute mutation usually omits `rel` in the payload, so it is conservatively not rehosted (it live-loads from origin, graceful). Full fidelity needs the snapshot's `rel` for the id threaded into the mutation walk (an id->rel companion to the tag map). Compound-rare; deferred deliberately, not a silent gap.

## Tradeoffs

| Concern | Mitigation |
|---|---|
| R2 storage cost | Content-hash dedupe + retention-aligned GC |
| Fetch cost/latency | Fully async; replay falls back to original URL until `ready` |
| Capture-time vs fetch-time asset drift (asset changed before we fetched it) | Fetch ASAP on ingest; acceptable minor risk for analytics replay |
| SSRF surface | Hard allowlist + private-range block + size/time caps (above) |
| Privacy: we now store customers' first-party assets | DPA + retention + EU residency (see GDPR note); processor role |

## Effort

- **Phase 0**: one line in `replay.ts` + a verification recording. Hours.
- **Phase 1**: extract + `replay_assets` table + SSRF-safe fetch worker + R2 put + read-time rewrite. A few days. The fetch worker fits our existing background-job pattern (instrumentation/cron); R2 access already exists via storage-brain.
- **Phase 2**: incremental.

## Decisions (DECIDED 2026-06-25)

1. **Phase 0 already shipped** (`@marlinjai/analytics-tracker` 1.4.0, `inlineImages: false`), so this is straight to **Phase 1**.
2. **Direct Cloudflare R2** (S3-compatible client), not the storage-brain SDK. Keeps analytics standalone (its stated design principle: own everything, no cross-service deps), self-contained, fewer moving parts. Content-addressing is implemented with `r2_key = sha256(content)` directly, so we still get cross-session/cross-project dedupe without storage-brain.
3. **Dedicated R2 custom domain `replay-assets.lumitra.co`**, not serving through the dashboard. CDN edge-cached, offloads the dashboard, immutable content-addressed objects cache forever, and avoids the dashboard middleware/auth surface entirely.
4. **Rewrite at read-time** (in `/api/sessions/[id]/replay`), not rewrite-and-store at ingest. Idempotent, lets late-captured assets resolve automatically, keeps the raw event stream intact for re-processing.

## Infra prerequisites (provision before Phase 1 e2e)

- **R2 bucket** `lumitra-replay-assets` (EU jurisdiction for residency), created via Terraform in the infra repo.
- **R2 custom domain** `replay-assets.lumitra.co` bound to that bucket + DNS record (Cloudflare). Public read, immutable cache headers.
- **Infisical keys** (analytics project `45b9c32b`, env `prod`, root path): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (secrets, scaffolded as PLACEHOLDER for Marlin to fill), `R2_REPLAY_ASSETS_BUCKET=lumitra-replay-assets`, `REPLAY_ASSETS_CDN_BASE=https://replay-assets.lumitra.co` (non-secret config).

## Build breakdown (Phase 1)

Pure, infra-independent, unit-tested core (shipped in PR #29):
- `replay-assets/walk.ts` — the single shared traversal both extract and rewrite run (so they cannot drift): resolve relative URLs against the page URL; collect from `img/source/video/audio/embed/input[src]`, `img/source[srcset]`, `link[rel=stylesheet|icon|preload as image|font|style][href]`, `video[poster]`, `object[data]`, `use/image[href|xlink:href]`, inline `style`/`<style>` `url(...)` + bare-string `@import`; skip `data:`/`blob:`/non-http(s). Tag-aware for both snapshot nodes AND incremental attribute mutations (via an id->tag map, so `<a href>`/`<script src>` are not over-collected).
- `replay-assets/extract.ts` — `extractAssetUrls`, collect mode over `walk`.
- `replay-assets/rewrite.ts` — read-time rewriter, replace mode over `walk`: given a `url -> CDN` map, rewrite asset URLs in reassembled events; URLs not yet `ready` fall back to the original.
- `replay-assets/ssrf.ts` — SSRF-safe URL validator + fetcher: allow only `http`/`https`; resolve host and block private/link-local/loopback/internal ranges (IPv4 + the IPv6 embedded-v4 / `::/96` / NAT64 / 6to4 forms); size cap (<=5 MB, streamed); one whole-operation wall-clock deadline (DNS + every redirect hop); re-validate every redirect hop; release the body on every exit path; never forward credentials/cookies. Residual DNS-rebinding + concurrency hardening tracked in Phase 2 above.
- `replay-assets/types.ts` — local rrweb serialized-node shape.
- Postgres migration `016-postgres.sql`: `replay_assets` table (see data model above) — schema-only, no writer yet, so it ships with the core.

Integration layer (needs the table + R2 creds to verify e2e):
- `replay-assets/store.ts` — R2 adapter (S3 client): content-addressed `put(sha256(content))`. Moved here from the core list: it needs the S3 client + R2 creds to verify against a real bucket, so it is built with the rest of the wiring, not in the unwired core.
- Enqueue on `replay_chunk` ingest (`/api/collect`): extract + upsert `pending`.
- Background fetch worker (existing instrumentation/cron pattern): drain `pending`, SSRF-fetch (with the Phase 2 rebinding mitigation + a concurrency cap), R2 put, mark `ready|failed`.
- Read-time rewrite wired into `/api/sessions/[id]/replay`: `getReplayChunks` must `SELECT url`, and pass the session id->tag map into `walkAssets(..., seedIdToTag)`.

## Status

**Decided.** Pure core is ready to implement and unit-test immediately. Integration + e2e are gated on the R2 bucket + `replay-assets.lumitra.co` domain + Infisical R2 creds being provisioned.
