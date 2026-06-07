---
title: Framework-Agnostic Web Analytics Architecture
type: plan
status: draft
date: 2026-04-28
tags: [research, architecture, heatmaps, experiments, dom-fingerprint, framer-clone-integration, visual-editor, breakpoints]
projects: [analytics-platform, framer-clone, lola-stories]
summary: Long-form research plan for evolving the platform from a React-leaning, code-based experiments tool into a stack-agnostic system with runtime DOM-mutation experiments, multi-viewport heatmap visualization, and native integration into the Framer-clone visual editor.
---

# Framework-Agnostic Web Analytics Architecture

> Strategic research doc. Not yet a build plan. Captures the architectural shift from class-chain selectors and code-only experiments toward DOM-fingerprint identification, runtime mutation experiments, and a multi-device canvas visualization layer that culminates in native integration with the Framer-clone editor.

## Context

The current Lumitra Analytics platform was designed for a single React app (Lola Stories) with engineers writing code-based experiments. It works for that scope. It does not survive contact with:

1. **Non-React stacks.** Vue, Svelte, Solid, Astro, plain HTML, Webflow, Framer published sites. No fiber tree to walk; no hooks model.
2. **Cross-breakpoint heatmap rendering.** Clicks captured on a layout container (e.g. `div.flex-col-reverse`) render at proportional offsets that no longer correspond to a meaningful UI element after the children reflow at a new breakpoint. Demonstrated empirically on `lolastories.com` between viewport widths of 1000px and 1029px: identical click data, blob lands on the laptop image at 1000px and floats in white space at 1029px.
3. **No-deploy experimentation.** Every variant requires a code change, a CI run, and a redeploy. Marketing PMs cannot test copy or color tweaks without engineering involvement. Iteration loops collapse to weekly cadence at best.
4. **Visualizing mobile vs desktop simultaneously.** Existing dashboard renders heatmaps at one viewport; cross-device comparison requires manual viewport resizing.
5. **Strategic moat.** The Framer-clone product is a visual website builder. Analytics that "lives inside" the same canvas, with heatmaps overlaid on the design view and A/B variants expressed as design alternatives, is a fundamentally different UX than a separate dashboard. That moat does not exist today.

This document scopes the architectural changes required to address all five.

## Failure modes observed today

Three concrete failure shapes drive the design:

| Mode | Symptom | Root cause |
|------|---------|------------|
| A. Stable element, moved position | Button moves between layouts; blob follows | Already solved by the SDK's element-relative offsets (`ox`/`oy`/`ew`/`eh` in `properties` JSON). |
| B. Reflowing parent | Click captured on a wrapper whose children rearrange. Blob renders at proportional offset within wrapper, no longer aligned with any meaningful child. | Selector chain captured the ancestor, not the leaf. The proportional position is mathematically correct but semantically meaningless after reflow. |
| C. Non-existent element | Selector resolves at viewport A but not at viewport B (mobile-only menu, conditional render). | Layout is qualitatively different across breakpoints, not just spatially rearranged. |

Mode A is solved. Mode B is the dominant blob in the screenshots from 2026-04-27 testing on `lolastories.com`. Mode C surfaces whenever conditional rendering is used (every modern app).

A separate but related issue: `viewport_width` is currently `NULL` on click events in ClickHouse. The SDK populates it on pageview events but the click listener path drops it. Without per-event viewport, the dashboard cannot bucket clicks by breakpoint.

## Three architectural pillars

### Pillar 1: DOM-neighborhood fingerprint identification

Replace the brittle "CSS class chain selector" with a multi-feature fingerprint captured at click time.

**Capture (per click event):**

```ts
{
  selector: "main > section:nth-of-type(1) > .flex-col-reverse > .inline-flex",  // fallback
  fingerprint: {
    tag: "button",
    role: "button",                           // ARIA role
    accessibleName: "Join the Waitlist",      // aria-label or innerText
    textHash: murmur3("Join the Waitlist"),   // 32-bit hash of normalized text
    nearestHeading: "Turn Family Voices into Magical Stories",
    nearestLandmarkRole: "main",
    positionBucket: "top-left-third",         // 3x3 viewport grid
    ancestorRoles: ["main", "section"],       // up to 3 levels
  },
  ox: 37, oy: 22, ew: 207, eh: 30,            // already captured today
  viewportWidth: 1029,                        // NEW (currently NULL on clicks)
  viewportHeight: 828,                        // NEW
}
```

**Match (at render time):** weighted similarity score against candidate elements found via `document.querySelectorAll('*')` filtered by tag + role:

```
score(candidate, fingerprint) =
  4 * (role match) +
  4 * (accessibleName match exact) +
  3 * (textHash match) +
  2 * (nearestHeading match) +
  2 * (ancestorRoles overlap) +
  1 * (positionBucket match) +
  0.5 * (tag match)
```

Pick the highest-scoring candidate above a threshold (e.g. 8.0). Below threshold, fall back to selector resolution. Below that, drop the click rather than render incorrectly.

**Why this beats React fiber:**

- 100% framework-agnostic. Works on a static HTML page from 2003.
- Survives class changes, layout reorganization, refactors that move components.
- Naturally prefers leaf elements (because they have role + aria-label + text content; containers don't).
- Degrades gracefully when no candidate scores well.
- Schema-additive: new fingerprint features can be appended without breaking existing data.

**Implementation surface:**

- `packages/tracker/src/listeners.ts`: extend click event capture with fingerprint computation.
- `packages/shared/src/schemas.ts`: add `fingerprint` shape to the click event Zod schema.
- ClickHouse: store the fingerprint as JSON in the existing `properties` column (no DDL change required initially).
- `packages/dashboard/src/lib/queries/heatmap.ts`: add fingerprint extraction.
- `packages/dashboard/src/components/heatmap/SnapshotHeatmap.tsx` and `packages/extension/src/background.ts`: replace `querySelector(selector)` with `findByFingerprint(fingerprint)`.

**Estimated effort:** 1.5 to 2 days for tracker + 1 day for renderer integration + 0.5 day for tests = 3 days.

### Pillar 2: Runtime DOM-mutation experiments

Today's experiments are code-based: `useLumitraVariant('signup-flow')` returns `'control' | 'simplified-form' | 'multi-step'`, the React component branches accordingly. This is correct for backend logic and structural changes.

The missing model is DOM-mutation experiments: variants stored on the dashboard as a list of declarative mutations applied client-side at runtime. Variants:

```jsonc
{
  "experimentKey": "hero-cta-copy",
  "variants": {
    "control": { "mutations": [] },
    "test-friendlier": {
      "mutations": [
        { "type": "setText",      "fingerprint": {...}, "value": "Start Your Story" },
        { "type": "setStyle",     "fingerprint": {...}, "value": { "background": "#10b981" } },
        { "type": "setAttribute", "fingerprint": {...}, "name": "href", "value": "/onboarding-v2" },
        { "type": "hide",         "fingerprint": {...} },
        { "type": "replaceHtml",  "fingerprint": {...}, "value": "<span>...</span>" }
      ]
    }
  }
}
```

**Tracker flow:**

1. `init()` already calls `/api/projects/{id}/config` to fetch flag + experiment definitions. Extend the response with mutation lists per variant.
2. Inject a synchronous anti-flicker style: `<style id="__lumitra_hide__">html{visibility:hidden}</style>`. This style is injected by the page's `<head>` script tag (deferred or sync, depending on host site setup) before paint.
3. Resolve variant assignments using existing deterministic hash logic.
4. For each assigned variant's mutations, call `findByFingerprint()` and apply the operation.
5. Remove the anti-flicker style. Visible page now reflects variant.
6. Install a `MutationObserver` on `document.body` to re-apply mutations after SPA route transitions or React re-renders.

**Visual editor in the dashboard:**

- Open the live site (or a static snapshot via the existing rrweb snapshot pipeline) in a sandboxed iframe.
- Click an element; capture its fingerprint; show an inspector panel.
- Editor inputs: text, style overrides, link target, hide toggle, custom HTML.
- Save creates a variant entry; subsequent saves bump versions.
- Preview button renders the iframe with mutations applied.

**Implementation surface:**

- `packages/tracker/src/mutations.ts` (new): mutation primitives + applier + anti-flicker.
- `packages/tracker/src/index.ts`: orchestrate fetch, resolve, apply, remove anti-flicker.
- `packages/shared/src/schemas.ts`: variant mutation Zod schemas.
- Postgres: new table `experiment_variant_mutations` (or store as JSON in existing `experiments.variants`).
- `packages/dashboard/src/app/(dashboard)/experiments/[id]/visual-editor/page.tsx` (new): the visual editor UI.
- `packages/dashboard/src/components/visual-editor/*`: iframe sandbox, fingerprint capture, inspector panel.

**Estimated effort:** 4 to 6 days. Tracker side is 1.5 to 2 days. Editor UI is the bulk: 2.5 to 4 days depending on polish.

### Pillar 3: Build-time component attribution (optional polish)

For stacks with a known compiler (React/JSX, Vue SFC, Svelte, Solid, Astro), a unified plugin walks the AST and injects `data-lumitra-component="ComponentName"` on the root element of each component definition.

The DOM fingerprint matcher gains a single high-weight feature: `componentName` match scores `+5`, dwarfing all other features when present.

**Distribution:**

- `packages/build-plugin-react/`: Babel/SWC plugin.
- `packages/build-plugin-vue/`: Vue compiler hook.
- `packages/build-plugin-svelte/`: Svelte preprocess.
- Each is a small standalone npm package; users install whichever matches their stack.

This is strictly additive to Pillar 1. Customers who do not run the plugin still get fingerprint identification; those who do get even cleaner data.

**Estimated effort:** 1 to 2 days per framework. Ship React first, others as customer demand surfaces.

## Strategic angle: native Framer-clone integration

The Framer-clone product (`projects/framer-clone/`) is a visual website builder where users place components on a canvas, configure them via property panels, and publish to a hosted URL. Today it has no awareness of Lumitra Analytics.

**Native integration phases:**

### Phase A: Auto-instrumentation on publish

Every component placed on the canvas already has a stable internal ID. At publish time, the renderer emits `data-lumitra-component="<ComponentType>"` and `data-lumitra-id="<canvasNodeId>"` on the root element. Both are first-class fingerprint features. Selector chains become irrelevant inside Framer-clone-built sites because every element has a stable ID by construction.

### Phase B: Heatmap overlay during edit

Inside the Framer-clone editor, a "heatmap mode" toggle pulls the project's last 7 days of clicks (filtered to the matching project ID) and overlays them directly on the design canvas. Multi-device canvases (Framer's distinctive feature) become multi-viewport heatmap views for free: each artboard size renders the heatmap data filtered to viewports matching that artboard's width.

This is the canvas-style multi-device heatmap visualization the user has been asking about, achieved by riding on the existing canvas primitive instead of building a separate visualization layer.

### Phase C: Variants as design alternatives

A canvas node can have N "design alternatives" (Framer already has this concept for component states). Map alternatives to experiment variants 1:1: variant A is the alternative the engineer marked "Variant A". Publish writes the variants into the runtime mutation set (Pillar 2) automatically. PMs run an experiment by clicking a button on the canvas, no engineer involvement.

### Phase D: Experiment results in editor sidebar

A live sidebar pane shows running experiments, conversion delta per variant, statistical significance. Click a variant's row to highlight which canvas alternative it corresponds to. Decision-making happens in the same tool where the design lives.

This is the moat. Competitors (PostHog, Hotjar, VWO) sell analytics that integrate via SDK. None of them own the design surface. Framer-clone + Lumitra owns design + analytics + experimentation in one tool.

**Cross-product dependency:** Phase A requires Pillar 1 (fingerprint) and Pillar 3 (or equivalent build-time injection). Phase C requires Pillar 2 (runtime mutations). So the order is: Pillar 1 -> Pillar 2 -> Phase A -> Phase B -> Phase C -> Phase D.

## Multi-device heatmap canvas (standalone, in dashboard)

Independent of the Framer-clone integration, the dashboard itself can ship a canvas-style multi-device heatmap view.

**UX:**

- A dedicated `/heatmap-canvas` page.
- Three artboards visible side-by-side: 390px (mobile), 768px (tablet), 1440px (desktop). Each is an iframe rendering the target URL at that exact viewport width.
- Pan and zoom controls span all artboards together (same gesture model as Framer-clone canvas).
- Each artboard renders its own heatmap layer, filtered to clicks captured at viewports within that artboard's bucket (e.g. 320px-640px for mobile).
- Hover over a click anywhere shows the same data point highlighted across all three artboards (same fingerprint match).
- Date range and variant filter apply to all artboards.

**Implementation surface:**

- `packages/dashboard/src/app/(dashboard)/heatmap-canvas/page.tsx` (new).
- `packages/dashboard/src/components/heatmap/CanvasArtboard.tsx` (new): single-viewport iframe + heatmap layer.
- `packages/dashboard/src/components/heatmap/CanvasContainer.tsx` (new): pan/zoom orchestration.
- Reuses existing `SnapshotHeatmap` rendering primitives.

**Dependency:** requires Pillar 1 fingerprint identification to make per-viewport rendering coherent. Without fingerprints, mobile clicks rendered on the desktop artboard will be at wrong positions (Mode B failure mode amplified).

**Estimated effort:** 3 to 4 days after Pillar 1 lands.

## Phasing and dependency graph

```
Pillar 1 (DOM fingerprint)
    |
    +--> Pillar 2 (Runtime mutations)
    |        |
    |        +--> Visual editor (dashboard)
    |        |
    |        +--> Phase C (Framer-clone variants)
    |
    +--> Multi-device canvas (dashboard)
    |        |
    |        +--> Phase B (Framer-clone heatmap overlay)
    |
    +--> Pillar 3 (Build-time plugin)
              |
              +--> Phase A (Framer-clone auto-instrumentation)
```

**Recommended sequence:**

1. (immediate, today) Tactical: ship `viewport_width` on click events. One-line tracker fix. Permanent value.
2. Pillar 1: DOM-fingerprint identification. 3 days.
3. Multi-device heatmap canvas in dashboard. 3 to 4 days. Demonstrates the canvas pattern, validates the fingerprint matcher under cross-viewport stress.
4. Pillar 2: Runtime mutations + visual editor. 4 to 6 days.
5. Pillar 3: Build-time plugins, starting with React. 1 to 2 days per framework.
6. Phase A: Framer-clone auto-instrumentation on publish. 1 day.
7. Phase B: Heatmap overlay in Framer-clone canvas. 2 to 3 days.
8. Phase C: Variants as design alternatives. 3 to 5 days.
9. Phase D: Experiment results in Framer-clone sidebar. 2 days.

Total estimated effort across all phases: roughly 4 to 6 weeks of focused work, parallelizable into 3 independent tracks (analytics-platform, framer-clone integration, build plugins).

## Open questions

1. **Fingerprint match thresholds.** The 8.0 score floor is a guess. Need empirical calibration on real customer sites before shipping. Plan: record 1000 clicks across 5 sites, compute scores, examine distribution, set threshold at the inflection point.
2. **Anti-flicker tradeoff.** Synchronous anti-flicker hides the page until config loads. Latency of `/api/projects/{id}/config` becomes the page's perceived load time. Acceptable on fast networks, problematic on 3G. Investigate: ship config inline as a `<script>` tag from the SSR layer where possible, fall back to async fetch with a 200ms anti-flicker timeout.
3. **MutationObserver scope.** Re-applying mutations on every React re-render is wasteful. Investigate: scope observer to specific subtrees identified at first mutation pass.
4. **Cross-domain iframe sandbox for visual editor.** Some target sites have CSP `frame-ancestors` that block iframe embedding. Fallback: render against the rrweb DOM snapshot stored in `page_snapshots` instead of a live iframe. Already implemented for historical heatmaps.
5. **Conflict resolution between concurrent experiments.** If experiment A and experiment B both target the same element, which mutation wins? Define precedence: lexicographic by experiment key, or explicit priority field on each experiment.
6. **Schema versioning for fingerprint features.** When we add a new fingerprint feature (e.g. `nearestSiblingText`), old clicks lack it. Match scoring must skip missing features without penalizing the candidate.

## Out of scope (explicitly deferred)

- Mobile native app analytics (iOS/Android SDKs). Different architecture, separate research doc when the time comes.
- Server-side experiments (split traffic at edge based on cookies). Possible Cloudflare Worker integration, separate doc.
- Geographic targeting beyond the existing IP -> country lookup.
- Privacy-preserving aggregations (differential privacy, k-anonymity). Important for enterprise customers, separate doc.
- AI-driven element labeling (LLM at ingestion time labels what each click "means"). Interesting but speculative; revisit after Pillar 1 ships.

## Cross-references

- Live problem demonstration: screenshots from 2026-04-27 testing session, viewport widths 1000px and 1029px.
- Earlier related work: `2026-04-26-allowed-origins-ingestion-gate.md` (origin gating, completed).
- Repository memory: `project_heatmap_rendering_gap.md` (pixel-to-element migration, 2026-04-08), `project_heatmap_architecture.md` (element-based toolbar + DOM versioning).
- Obsidian companion: `Computer Science & Software Development/Framework-Agnostic Web Analytics Architecture.md` in Marlin's main vault.

## Decision log

This document does not yet propose a definitive build path. It enumerates the design space and lays out trade-offs. Decisions are deferred to subsequent planning sessions, one per pillar.
