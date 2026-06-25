import type { RrwebEvent } from './types';
import { walkAssets } from './walk';

/**
 * Read-time rewrite of asset URLs in reassembled rrweb events. Given a map of
 * `absolute original URL -> rehosted CDN URL` (only for assets we have actually
 * stored), return a copy of the events with those URLs swapped to our CDN. Runs
 * the shared walk in replace mode, so it rewrites exactly the locations the
 * extractor collected (no drift).
 *
 * Done at read time (not at ingest) so it is idempotent, lets late-captured
 * assets resolve as soon as they are stored, and keeps the raw event stream
 * intact for re-processing. Any URL not in the map is left as the original, so
 * the replay degrades gracefully to live-loading while assets are still pending.
 *
 * Input must be JSON-serializable rrweb events (as returned by JSON.parse from
 * ClickHouse); structuredClone would throw on live objects with functions/DOM
 * refs/cycles.
 *
 * NOTE on the empty-map fast path: it returns the SAME array (no clone) for
 * speed, so the caller MUST treat the result as read-only. The documented read
 * path serializes it to JSON immediately, which is safe. The non-empty path
 * returns a private structuredClone.
 */
export function rewriteAssetUrls(
  events: readonly RrwebEvent[],
  urlToCdn: ReadonlyMap<string, string>,
  pageUrl: string,
): RrwebEvent[] {
  if (urlToCdn.size === 0) return events as RrwebEvent[];
  const cloned: RrwebEvent[] = structuredClone(events as RrwebEvent[]);
  walkAssets(cloned, pageUrl, (url) => urlToCdn.get(url));
  return cloned;
}
