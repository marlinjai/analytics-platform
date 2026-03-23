/**
 * MurmurHash3 (32-bit) — fast, deterministic, non-cryptographic hash.
 * Used for experiment variant assignment and feature flag rollout bucketing.
 * Zero dependencies, ~200 bytes minified.
 */
export function murmurhash3(key: string, seed: number = 0): number {
  let h = seed;
  for (let i = 0; i < key.length; i++) {
    const k = Math.imul(key.charCodeAt(i), 0xcc9e2d51);
    h ^= Math.imul(k << 15 | k >>> 17, 0x1b873593);
    h = Math.imul(h << 13 | h >>> 19, 5) + 0xe6546b64;
  }
  h ^= key.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
