-- Secret daily salt for the cookieless visitor key (consent-free Tier 1, plan D4).
--
-- The stored visitor key is sha256(salt : ip : userAgent : projectId), computed
-- server-side at ingestion (see packages/dashboard/src/lib/enrich.ts). Before
-- this, the salt was the literal UTC date string ('YYYY-MM-DD'), which is public
-- and predictable, so a stored ip_hash was brute-forceable over the ~4.3B IPv4
-- space (effectively no salt). This table holds one cryptographically random
-- 32-byte salt per UTC day, generated lazily by the dashboard on the first
-- ingestion of the day and shared across instances. Salts older than two days
-- are garbage-collected (see daily-salt.ts) so prior days' visitor hashes become
-- unreversible even by us, which is the point.
--
-- HARD CUTOVER (plan D2): ip_hash values minted before this migration used the
-- old date-string salt and the ip-only composition, so the same visitor will NOT
-- match across the cut. Pre/post visitor and session metrics are not comparable;
-- annotate the dashboard at the cutover date.
CREATE TABLE IF NOT EXISTS daily_salts (
  day         DATE PRIMARY KEY,
  salt        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
