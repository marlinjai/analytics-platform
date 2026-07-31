import { join } from 'node:path';
import { open, type CountryResponse, type Reader } from 'maxmind';

export interface GeoResult {
  country: string;
  countryCode: string;
}

const EMPTY: GeoResult = { country: '', countryCode: '' };

// Private / loopback / link-local / unspecified: never geolocated, never read DB.
const PRIVATE_IP_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0$|::1$|fc00:|fe80:)/;

// DB-IP Lite (Country) / GeoLite2-Country .mmdb, provided at image build time
// (see packages/dashboard/scripts/fetch-geoip.sh + Dockerfile). The raw IP is
// looked up LOCALLY and never leaves the EU, replacing the prior ip-api.com call
// (a transfer of the raw IP to a US service over plaintext HTTP). Path is
// overridable for local dev; absent in dev/test, where geo degrades to empty.
const DB_PATH =
  process.env.GEOIP_DB_PATH ?? join(process.cwd(), 'geoip', 'country.mmdb');

let readerPromise: Promise<Reader<CountryResponse> | null> | null = null;

function loadReader(): Promise<Reader<CountryResponse> | null> {
  return open<CountryResponse>(DB_PATH).catch((err: unknown) => {
    // Non-fatal and loud: a missing/broken DB disables country enrichment but
    // never blocks ingestion. Surfaced in logs, not silently swallowed.
    console.error(
      `[geo] GeoIP DB unavailable at ${DB_PATH}; country enrichment disabled:`,
      (err as Error).message,
    );
    return null;
  });
}

/**
 * Resolve an IP to its country using the locally bundled GeoIP database.
 * Private IPs and an absent database both return an empty result. The reader is
 * opened once and cached; lookups are in-process (no network).
 */
export async function lookupCountry(ip: string): Promise<GeoResult> {
  if (!ip || PRIVATE_IP_RE.test(ip)) return EMPTY;
  if (!readerPromise) readerPromise = loadReader();
  const reader = await readerPromise;
  if (!reader) return EMPTY;
  try {
    const record = reader.get(ip);
    return {
      country: record?.country?.names?.en ?? '',
      countryCode: record?.country?.iso_code ?? '',
    };
  } catch {
    // maxmind throws on a malformed IP string; treat as unknown.
    return EMPTY;
  }
}

/** Test-only: drop the cached reader so each test starts cold. */
export function __resetGeoReaderForTests(): void {
  readerPromise = null;
}
