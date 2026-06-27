import { randomBytes } from 'node:crypto';
import { getDb } from './db';

/**
 * Secret daily salt for the cookieless visitor key.
 *
 * The visitor key is sha256(salt : ip : userAgent : projectId), computed
 * server-side at ingestion (see enrich.ts) and stored as `ip_hash`. The salt is:
 *   - secret + cryptographically random (32 bytes), so a known-plaintext
 *     brute-force over the ~4.3B IPv4 space cannot reverse a stored hash (the old
 *     date-string salt was public, hence effectively no salt);
 *   - rotated daily and DISCARDED after two days, so yesterday-but-one's hashes
 *     become unreversible even by us (this is what strengthens the anonymity
 *     argument: see the Fachanwalt brief F3 and plan decision D4);
 *   - stored in Postgres as the shared source of truth so every dashboard
 *     instance converges on the same value, with current + previous held in
 *     memory. The previous salt is consumed at query time by sessionization
 *     (S3) so a session that straddles the midnight rotation still stitches.
 *
 * Postgres is already on the ingestion hot path (API-key auth), so reading the
 * salt here adds no new dependency.
 */

const SALT_BYTES = 32;
// Keep today + yesterday; anything older is GC'd so its hashes are unreversible.
const RETENTION_DAYS = 2;

/** A fresh 32-byte cryptographically random salt, hex-encoded (64 chars). */
export function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString('hex');
}

/** UTC day key 'YYYY-MM-DD' for a given instant (default: now). */
export function utcDayKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Shift a 'YYYY-MM-DD' day key by `days` (may be negative), in UTC. */
export function shiftDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ActiveSalts {
  /** UTC day these salts are valid for. */
  dayKey: string;
  /** Today's secret salt (used to mint the stored visitor key). */
  current: string;
  /** Yesterday's salt, or null on a fresh deploy / gap day. */
  previous: string | null;
}

let cache: ActiveSalts | null = null;
let inflight: Promise<ActiveSalts> | null = null;

type Sql = ReturnType<typeof getDb>;

/**
 * Ensure a row exists for `dayKey` and return its converged salt. INSERT ...
 * ON CONFLICT DO NOTHING then SELECT, so concurrent instances all settle on
 * whichever value won the insert race rather than each minting its own.
 */
async function ensureSalt(sql: Sql, dayKey: string): Promise<string> {
  const candidate = generateSalt();
  await sql`
    INSERT INTO daily_salts (day, salt)
    VALUES (${dayKey}, ${candidate})
    ON CONFLICT (day) DO NOTHING
  `;
  const rows = await sql<{ salt: string }[]>`
    SELECT salt FROM daily_salts WHERE day = ${dayKey}
  `;
  return rows[0]?.salt ?? candidate;
}

async function load(): Promise<ActiveSalts> {
  const sql = getDb();
  const today = utcDayKey();
  const yesterday = shiftDayKey(today, -1);

  const current = await ensureSalt(sql, today);

  // Yesterday's salt may legitimately not exist (fresh deploy / gap day).
  const prevRows = await sql<{ salt: string }[]>`
    SELECT salt FROM daily_salts WHERE day = ${yesterday}
  `;
  const previous = prevRows[0]?.salt ?? null;

  // Discard salts past the retention window so their visitor hashes can no
  // longer be re-derived, by us or anyone.
  const cutoff = shiftDayKey(today, -RETENTION_DAYS);
  await sql`DELETE FROM daily_salts WHERE day < ${cutoff}`;

  return { dayKey: today, current, previous };
}

/**
 * Active salts (today + yesterday), served from an in-memory cache that
 * refreshes when the UTC day rolls over. Concurrent callers share one load so a
 * cold start under a burst issues a single set of queries.
 */
export async function getActiveSalts(): Promise<ActiveSalts> {
  const today = utcDayKey();
  if (cache && cache.dayKey === today) return cache;
  if (!inflight) {
    inflight = load()
      .then((result) => {
        cache = result;
        return result;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** The current day's secret salt: used to mint the stored visitor key. */
export async function getCurrentSalt(): Promise<string> {
  return (await getActiveSalts()).current;
}

/** Test-only: drop the in-memory cache so each test starts cold. */
export function __resetSaltCacheForTests(): void {
  cache = null;
  inflight = null;
}
