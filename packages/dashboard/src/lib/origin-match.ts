/**
 * Allowed-origin matching for ingestion gating.
 *
 * Entries are stored as `host`, `host:port`, or `*.host` (no scheme, lowercase).
 * `normalizeOriginEntry` strips schemes/trailing slashes for storage.
 * `originIsAllowed` parses the request Origin/Referer and matches it.
 *
 * Empty allowlist means "no restriction" so legacy projects keep working.
 */

export function normalizeOriginEntry(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/\/.*$/, '');
  return value;
}

function parseOriginHost(origin: string): { host: string; port: string | null } | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || null,
    };
  } catch {
    return null;
  }
}

function matchEntry(entry: string, host: string, port: string | null): boolean {
  const normalized = normalizeOriginEntry(entry);
  const [entryHost, entryPort] = normalized.includes(':') && !normalized.startsWith('*.')
    ? normalized.split(':')
    : [normalized, null];

  if (entryPort && entryPort !== port) return false;

  if (entryHost.startsWith('*.')) {
    const suffix = entryHost.slice(2);
    return host.endsWith('.' + suffix);
  }

  return host === entryHost;
}

export function originIsAllowed(
  origin: string | null | undefined,
  allowedOrigins: string[]
): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;

  const parsed = parseOriginHost(origin);
  if (!parsed) return false;

  return allowedOrigins.some((entry) => matchEntry(entry, parsed.host, parsed.port));
}
