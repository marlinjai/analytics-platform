import type { RrwebEvent } from './types';
import { walkAssets } from './walk';

/**
 * Extract the absolute http(s) asset URLs referenced by a batch of rrweb events
 * (a reassembled replay session, or a single chunk). Runs the shared walk in
 * collect mode, so it sees exactly the same locations the rewriter will swap.
 *
 * The pipeline fetches these server-side and rehosts them so replays render even
 * when the original asset is cross-origin, expired, or deleted. See
 * docs/superpowers/plans/2026-06-25-session-replay-asset-rehosting-pipeline.md
 *
 * Only display assets are collected (images, stylesheets, icons, poster/media
 * sources, SVG external refs, and CSS url() references). Scripts are excluded.
 */
export function extractAssetUrls(events: readonly RrwebEvent[], pageUrl: string): string[] {
  const out = new Set<string>();
  walkAssets(events, pageUrl, (url) => {
    out.add(url);
    return undefined; // collect-only: the handler never returns a replacement, so the walk mutates nothing
  });
  return [...out];
}

// Re-exported so the shared resolver/tokenizer stay importable from one place.
export { resolveAssetUrl, parseSrcsetCandidates } from './walk';
