# Lumitra — Brand Strategy Brief

## Competitive Visual Landscape

### Analytics Tool Logo Analysis

| Tool | Logo Type | Color | Shape | Mood |
|------|-----------|-------|-------|------|
| **Hotjar** | Flame icon | Orange (#FF3C00) | Organic/rounded | Warm, energetic |
| **Clarity** | Abstract dots | Blue (#0078D4) | Geometric circles | Corporate, clean |
| **PostHog** | Hedgehog mascot | Black + Yellow | Character | Playful, developer-friendly |
| **Plausible** | Wordmark only | Dark blue (#1A1F36) | Typography | Minimal, privacy-focused |
| **Umami** | Sushi roll | Purple (#7C3AED) | Character/food | Quirky, approachable |
| **Fathom** | Abstract mark | Green (#22C55E) | Geometric | Clean, minimal |
| **Matomo** | Abstract "M" | Teal (#35BEB1) | Lettermark | Technical, established |
| **Mixpanel** | Abstract spark | Purple (#7856FF) | Geometric | Modern, SaaS |
| **Amplitude** | Soundwave "A" | Blue (#1D61F0) | Lettermark | Data-driven, enterprise |
| **FullStory** | Hexagon eye | Purple (#6B2FDD) | Geometric | Observational |
| **GA4** | Chart line | Orange (#F9AB00) | Pictogram | Familiar, institutional |
| **Heap** | Diamond "H" | Green (#00C389) | Lettermark | Growth, simple |

### Pattern Recognition

**Overused:**
- Blue (Clarity, Amplitude, Plausible) — saturated space
- Purple (Mixpanel, FullStory, Umami) — crowded
- Abstract geometric marks — hard to distinguish at 16px

**Underused:**
- Indigo-to-violet gradient (Lumitra's current territory) — distinctive in this space
- Warm + cool blend (nobody bridges warm orange-ish tones with cool purples)
- Light/illumination metaphors — despite many tools being about "seeing" data

**What works at 16px (favicon/extension icon):**
- PostHog's hedgehog — instantly recognizable even tiny
- Hotjar's flame — simple silhouette, unique color
- GA4's chart line — dead simple
- **Lesson:** The icon must be a single clear shape, not detailed artwork

### Gap Opportunity

Nobody owns "light/illumination" visually. The analytics space is full of abstract geometry and blue/purple. Lumitra's name literally means "light" — this is the brand's natural territory.

---

## Strategic Positioning

### Brand Essence
**"See what users actually do."**

Not "track" (surveillance connotation), not "analyze" (cold/technical) — **see**. Lumitra illuminates user behavior. The heatmap overlay is literally shining light on a dark page.

### Positioning Statement
For product teams and indie makers who need to understand user behavior, Lumitra is the privacy-first analytics platform that makes invisible patterns visible — through heatmaps, session replay, and visual analytics that you own and control.

### Competitor Differentiation

| vs. | Lumitra wins on |
|-----|-----------------|
| Hotjar | Self-hosted, privacy-first, no sampling limits |
| Clarity | Element-based heatmaps (not just coordinates), A/B testing roadmap |
| PostHog | Simpler, focused (not trying to be everything), lighter weight |
| Plausible/Fathom | Visual analytics (heatmaps, replay) — they're numbers-only |
| GA4 | Privacy-first, visual, actually usable |

### Target Audience (primary)
- Indie hackers, solo founders, small teams (1-10)
- Privacy-conscious European companies (GDPR)
- Developers who want self-hosted control

### Target Audience (secondary)
- Marketing teams at SMBs who find GA4 unusable
- Product managers who want heatmaps without Hotjar's pricing

---

## Logo Direction

### Requirements
1. **Works at 16px** — must be a single, clear silhouette
2. **Recognizable in monochrome** — can't rely on gradient alone
3. **Distinct from competitors** — not another abstract hexagon or circle
4. **Connected to "light/illumination"** — brand name etymology
5. **Modern and simple** — 2024+ aesthetic, not dated skeuomorphism

### Recommended Concept: The Prism/Beacon Mark

A minimal geometric mark that suggests light being focused or emitted:

**Option A — Focused Lens**
A simplified convex lens shape (like a vertical eye/almond) with a small dot or light ray. Suggests "focusing" on data, "seeing" clearly. At 16px it's a distinctive oval-with-dot silhouette.

**Option B — Beacon Slash**
A single diagonal slash or ray emanating from a point, like a lighthouse beam cutting through darkness. Ultra-minimal. At 16px it's just an angled line with a bright point — unlike anything else in the space.

**Option C — Abstract L + Light**
A stylized "L" with the top-right corner emitting a subtle gradient glow or ray. Lettermark that carries the light metaphor. Simple at any size.

**Option D — Heatmap Dot**
A single radial gradient circle (like one heatmap data point) — red core fading to transparent. This IS the product. Instantly communicates "heatmap" and "warmth/light." Dead simple at 16px. Risk: might look like a generic dot.

### Color Recommendation

**Keep the indigo-to-violet gradient** (`#6366f1 → #8b5cf6`) as the primary brand color. It's:
- Already embedded in the product (extension widget, popup, dashboard accents)
- Distinctive in the analytics space (nobody else owns this exact range)
- Connotes "premium" and "intelligence" without being cold blue or generic purple

**Accent:** A warm highlight color for CTAs and emphasis — suggest `#F59E0B` (amber-500) or `#FB923C` (orange-400) as a complement. The warm-cool contrast (indigo + amber) creates visual energy and maps to the "illumination" theme (cool darkness + warm light).

### Typography Recommendation

**Keep system fonts** for the product (performance). For marketing/branding:
- **Wordmark:** Inter or Geist (modern, geometric, tech-forward)
- **Weight:** Semibold (600) for the wordmark — confident but not heavy
- **No decorative fonts** — the brand should feel precise and trustworthy

---

## Deliverables Needed

### For Chrome Web Store (immediate)
1. **Icon set**: 16, 32, 48, 128px PNG — the logo mark only (no text)
2. **Promotional tile**: 440x280px — logo + tagline + screenshot
3. **Screenshots**: 1280x800px — extension in action on a real page

### For Marketing Site (near-term)
4. **Full logo**: Mark + "Lumitra" wordmark (horizontal layout)
5. **Favicon**: 32x32, derived from the mark
6. **OG image**: 1200x630px for social sharing
7. **Brand color palette**: Primary, secondary, accent, neutrals with hex/RGB/HSL

### For Lumitra Studio Brand Config
8. **brand.json**: Name, slug, default modes, color palette
9. **context.md**: Brand guidelines, tone, visual rules
10. **Reference images**: Competitor logos, style targets, mood board

---

## Handoff Instructions

This brief should be handed to a visual designer (human or AI) with these specific asks:

1. **Generate 4 logo concepts** following Options A-D above
2. **Each concept at 4 sizes**: 128px (detailed), 48px, 32px, 16px (must be legible)
3. **Color variants**: Full gradient, monochrome white, monochrome dark
4. **Wordmark pairing**: Each mark + "Lumitra" in Inter/Geist Semibold
5. **Mockups**: Each logo on dark dashboard background and in Chrome toolbar

**Style targets:** Think Vercel (precision), Linear (craft), Raycast (polish) — modern developer tools that feel premium without being corporate.
