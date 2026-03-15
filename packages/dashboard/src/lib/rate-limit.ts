const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100;

interface WindowEntry {
  timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let entry = windows.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    return false; // rate limited
  }

  entry.timestamps.push(now);
  return true; // allowed
}
