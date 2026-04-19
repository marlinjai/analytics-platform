import { getDb } from './db';

// LRU-style cache to avoid repeated DB lookups
const knownHashes = new Set<string>();
const MAX_CACHE_SIZE = 500;

/**
 * If this is a new page version, extract and store the rrweb full snapshot.
 * Fire-and-forget — errors are logged, never thrown.
 */
export async function maybeStoreSnapshot(
  projectId: string,
  url: string,
  pageHash: string,
  replayChunk: unknown[]
): Promise<void> {
  const cacheKey = `${projectId}:${url}:${pageHash}`;

  // Fast path: already seen this version
  if (knownHashes.has(cacheKey)) return;

  // Find the rrweb FullSnapshot event (type === 2)
  const fullSnapshot = replayChunk.find(
    (evt: unknown) =>
      evt !== null &&
      typeof evt === 'object' &&
      (evt as Record<string, unknown>).type === 2
  );
  if (!fullSnapshot) return; // no snapshot in this chunk

  try {
    const sql = getDb();

    // Upsert — ON CONFLICT DO NOTHING handles races
    await sql`
      INSERT INTO page_snapshots (project_id, url, page_hash, snapshot)
      VALUES (${projectId}, ${url}, ${pageHash}, ${JSON.stringify(fullSnapshot)})
      ON CONFLICT (project_id, url, page_hash) DO NOTHING
    `;

    // Cache on success
    if (knownHashes.size >= MAX_CACHE_SIZE) {
      const first = knownHashes.values().next().value;
      if (first !== undefined) knownHashes.delete(first);
    }
    knownHashes.add(cacheKey);
  } catch (err) {
    console.error('[snapshot-store] Failed to store snapshot:', err);
  }
}
