---
title: Server-Side Experiments + Unified Flow-Canvas Experiment Surface
summary: Extend Lumitra's (already-shipped, client-side) experimentation stack to server-side frameworks via a node SDK + shared deterministic assignment, propagate server-decided variants to the browser tracker so heatmaps/replays attribute correctly, add an admin forced-variant override, and surface + configure both client and server experiments from one place (the app-flow canvas). First consumer: the lola-stories story-writer experiment.
type: plan
status: draft
date: 2026-06-08
tags: [ab-testing, experimentation, feature-flags, server-side, node-sdk, flowmap, lola-stories]
projects: [analytics-platform, lola-stories]
---

# Server-Side Experiments + Unified Flow-Canvas Experiment Surface

## Context

Lumitra already shipped a full **client-side** experimentation stack (see CHANGELOG): experiment lifecycle (create/configure/variants/goals/start-stop/winner), multi-variant feature flags with percentage rollout, a zero-dependency **Bayesian engine** (Beta-posterior Monte Carlo: probability-to-be-best, lift, 95% CI), **per-variant heatmap** materialized views, the React SDK (`useLumitraVariant`/`useLumitraFlag`/`<LumitraVariant>`), the experiment + flags dashboard UI, runtime remote config (`GET /api/projects/{id}/config`, 60s TTL), and the tracker `ExperimentManager` (deterministic MurmurHash3, sticky `sessionStorage`, `getVariant`/`getFlag`/`identify`).

**This plan does not rebuild any of that.** The gap is that all of it is **browser-side**. Three things are missing for the experimentation vision:

1. Experiments that affect **server behavior** (e.g. the lola-stories story-writer pipeline runs in NestJS, not the browser) cannot be assigned or measured.
2. When a split is decided server-side, the browser tracker doesn't know the chosen variant, so **heatmaps and session replays mis-attribute** (or drop) the variant.
3. There is no **single place** to see and configure both client (screen) and server (endpoint) experiments together, nor an admin way to **force a variant** to QA both arms.

First consumer: the **lola-stories story-writer experiment** (objective metrics: generation latency, word count, fallback/truncation rate; quality metrics: story rating, listen-through). It is a pure server experiment, which makes it the ideal motivator for the node SDK.

## Requirements → built vs delivered here

| Requirement (from product) | Built today | Delivered by this plan |
|---|---|---|
| Where the split happens (client / server / edge) | client only | + **server** (node SDK); edge stays out of scope |
| Runtime-configurable (no redeploy) | ✅ remote config + dashboard | node SDK fetches the same config (cached) |
| ABC / n-way weighted splits | ✅ `variants[{key,weight}]` + Bayesian per arm | reused as-is server-side |
| Framework-agnostic incl. server backends + dashboard | client + React; dashboard source-agnostic | + **`@marlinjai/analytics-node`** server SDK |
| Heatmaps + replays correct per variant | ✅ for client-assigned | + **server→client propagation** of the assignment |
| Admin sees both side by side + can test both | results: ✅ (extension filter + per-variant views) | + **forced-variant override** (QA/preview) |
| One integrated view of client + server experiments | none | + **flow-canvas experiment overlay** (the unified surface) |

## Design

### D0. CORS fix (DO NOW — unblocks everything else)

`packages/dashboard/src/app/api/collect/route.ts` loads `SELECT allowed_origins FROM projects WHERE id = ?` and echoes the request origin only if it matches. The lola project's `allowed_origins` currently contains `https://lolastories.com` but **not** `https://app.lolastories.com`, so every event from the app subdomain is CORS-blocked (visible in the browser console). Until fixed, **zero** events flow from the lola web app.

Fix: add `https://app.lolastories.com` (and `https://staging.app.lolastories.com`) to the lola project's `allowed_origins` (analytics dashboard → project settings → allowed origins, or update the `projects` row). No code change. This is independent of everything below and should ship immediately.

### D1. Shared deterministic assignment (one source of truth)

Extract the assignment primitive the tracker already uses (MurmurHash3 of `experimentKey + ":" + unitId` → bucket → variant by weights) into a shared package consumable by both the browser tracker and the node SDK, so **server and client always compute the same variant for the same unit**. Pure function:

```
assign(experiment: { key, variants: [{key, weight}], status }, unitId: string) -> variantKey | null
```

`unitId` policy (document + enforce): stable `userId`/`familyId` when known, else the existing anonymous session id. Server experiments on logged-in flows should key on `familyId`/`userId` so the assignment is stable across devices and matches the client.

### D2. `@marlinjai/analytics-node` (server SDK)

A Node/server package mirroring the tracker's surface for backends (NestJS, etc.):
- `fetchConfig(projectId)` with a short in-process cache (mirror the 60s TTL).
- `getVariant(experimentKey, unitId)` / `getFlag(key, unitId)` using the **D1 shared assign** (no browser, no `sessionStorage`).
- `track(eventName, { unitId, experimentId, variant, properties })` → ingests a server event carrying `experiment_id` + `variant` so the existing ClickHouse columns + per-variant MVs + Bayesian results work unchanged.

Platform change required: the **collect (or a new `/api/ingest`) endpoint must accept server events** — authenticated by the project API key (server key), no `Origin` gating, with an explicit `unitId`. Today `/api/collect` is browser-CORS-gated; add a server-auth path that skips origin checks and trusts the API key. Small, additive.

### D3. Server→client variant propagation (correct heatmaps/replays)

For an experiment that is decided server-side **but also has a client surface** (the user then browses pages we heatmap/replay), the browser tracker must inherit the server's decision so all downstream client events carry the same `experiment_id`+`variant`. Mechanism:
- Server writes its assignment to a signed cookie (or injects it into the app bootstrap payload).
- Tracker gains `setVariant(experimentKey, variant)` / a `forcedAssignments` map that **overrides** its local hash for those experiments.
- Result: per-variant heatmaps and replays attribute correctly even when the split was server-decided.

(For the writer experiment specifically, heatmaps/replays are largely irrelevant — it changes story content, not page layout — but this is the general fix and is needed the moment a server experiment touches a heatmapped screen.)

### D4. Forced-variant override (admin QA / "test both")

A querystring (`?lumitra_variant=expKey:variantKey`) + cookie that **both** the tracker and the node SDK honor, gated to admins, plus a dashboard "preview as variant X". Lets an admin force themselves into either arm to test both side by side, independent of the hash. (Distinct from the existing results-side per-variant *viewing*, which is already built.)

### D5. Statistics for continuous metrics (gap to flag)

The shipped Bayesian engine models **conversion** (binary, Beta posterior). The writer's headline metrics are **continuous** (latency, word count, rating). Comparing arms on a continuous metric needs a different model (Bayesian normal / t-test). Either add a continuous-metric analysis path to the results engine, or (interim) compare continuous metrics via the dashboard's raw per-variant aggregates without a significance verdict. Flag, decide in Phase 1.

### D6. Unified experiment surface on the app-flow canvas (the integrated view)

lola-stories' `@lola/flowmap` (`/admin/flow`) already renders **every screen (web route) and endpoint (API) as nodes** with live screenshots + device-frame iframes. It is the natural single surface for "see client and server experiments together," because a **screen node = a client experiment** (tracker-assigned) and an **endpoint node = a server experiment** (node-SDK-assigned) — both on one canvas.

Integration:
- **Map** flow nodes to experiment keys (route path for screen/client experiments; endpoint path or a named server-experiment key for endpoint/server experiments).
- **Overlay (read):** badge nodes that have an experiment; show variant split, status (running/paused), and live results (probability-to-be-best, lift) pulled from the Lumitra experiment-results API.
- **Authoring (write):** from a node, create/tune an experiment — set variants + weights, **configure how much traffic goes to each arm**, start/stop, ramp — writing to the existing Lumitra experiment CRUD API.

This is exactly the "configure traffic allocation from where we see all the screens" vision. It is cross-repo: the canvas UI lives in lola (`@lola/flowmap`, `/admin/flow`); it reads/writes the Lumitra experiment API. Needs: (a) node→experiment-key mapping, (b) the Lumitra experiment list/results API consumable from lola `/admin` (auth + CORS), (c) an "experiments layer" toggle on the canvas.

## Phases

| Phase | Scope | Repos | Note |
|---|---|---|---|
| **0 (now)** | D0 CORS fix (`allowed_origins`) | platform data | unblocks all app analytics; no code |
| **1** | D1 shared assign + D2 node SDK + server ingest; wire the **writer experiment** (latency/length/fallback + rating) | platform + lola api | first server experiment end-to-end |
| **2** | D3 server→client propagation + D4 forced-variant override (admin QA) | platform sdk + lola | makes server experiments safe on heatmapped screens + QA-able |
| **3** | D6 flow-canvas **overlay** (read-only: badges + live results on nodes) | lola `@lola/flowmap` + Lumitra results API | the integrated view |
| **4** | D6 flow-canvas **authoring** (create/tune/ramp traffic from a node) | lola + platform | configure splits from the canvas |
| (later) | continuous-metric statistics (D5); edge assignment | platform | as needed |

## Already built — do not duplicate

Experiment lifecycle + multi-variant flags + Bayesian (conversion) engine + experiment goals + per-variant heatmap MVs + React SDK + experiment/flags dashboard UI + remote config delivery + tracker `ExperimentManager` + experiment/flags API routes (full CRUD + start/stop/results/goals) + ClickHouse `experiment_id`/`variant` columns and MVs. (CHANGELOG.) The 2026-03-22 plan (`2026-03-22-ab-testing-experimentation.md`) is the source of truth for the client-side design; this plan is its server-side + unified-surface continuation.

## Open decisions

1. `unitId` policy for server experiments (family vs user vs session) — recommend stable `familyId`/`userId` on logged-in flows.
2. Consent/GDPR: server-side assignment keyed on `familyId` is not a browser cookie, so likely outside cookie-consent, but any A/B that changes logged-in UX should be disclosed in the privacy policy (see the GDPR consent analysis doc).
3. Server-ingest auth shape: reuse the project API key on a no-origin path vs a dedicated server key.
4. Continuous-metric significance (D5): add now or defer.
