import { API_KEY_PREFIX_TEST } from '@analytics-platform/shared';
import type { TrackerEvent, StoredEvent } from '@analytics-platform/shared';
import { getCurrentSalt } from './daily-salt';
import { lookupCountry } from './geo';

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface UAParsed {
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string): UAParsed {
  if (!ua) return { browser: '', os: '' };

  // Browser detection — order matters (more specific first)
  let browser = '';
  if (/Edg\//.test(ua)) {
    browser = 'Edge';
  } else if (/OPR\/|Opera\//.test(ua)) {
    browser = 'Opera';
  } else if (/SamsungBrowser\//.test(ua)) {
    browser = 'Samsung Internet';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox';
  } else if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) {
    browser = 'Chrome';
  } else if (/Chromium\//.test(ua)) {
    browser = 'Chromium';
  } else if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    browser = 'Safari';
  } else if (/MSIE |Trident\//.test(ua)) {
    browser = 'Internet Explorer';
  }

  // OS detection
  let os = '';
  if (/Windows NT/.test(ua)) {
    os = 'Windows';
  } else if (/Android/.test(ua)) {
    os = 'Android';
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    os = 'iOS';
  } else if (/Mac OS X/.test(ua)) {
    os = 'macOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  } else if (/CrOS/.test(ua)) {
    os = 'Chrome OS';
  }

  return { browser, os };
}

// ── Device Model Extraction ─────────────────────────────────

function extractDeviceModel(ua: string): string {
  // Android: extract model between "Android XX;" and ")"
  const androidMatch = ua.match(/Android\s[\d.]+;\s*([^)]+)\)/);
  if (androidMatch?.[1]) {
    // Clean up: "SM-S921B Build/UP1A" -> "SM-S921B"
    return androidMatch[1].replace(/\s*Build\/.*$/, '').trim().slice(0, 64);
  }

  // iOS: can't get model from UA, return generic
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPod/.test(ua)) return 'iPod';

  return '';
}

// ── Environment Inference ────────────────────────────────────

const DEV_HOSTNAME_RE = /^localhost$|^127\.0\.0\.1$|^0\.0\.0\.0$|\.local$/;

function inferEnvironment(url: string, keyPrefix: string): string {
  if (keyPrefix.startsWith(API_KEY_PREFIX_TEST)) return 'test';
  try {
    const hostname = new URL(url).hostname;
    if (DEV_HOSTNAME_RE.test(hostname)) return 'development';
  } catch {
    // invalid URL — assume production
  }
  return 'production';
}

export async function enrichEvents(
  events: TrackerEvent[],
  ip: string,
  keyPrefix: string = '',
): Promise<StoredEvent[]> {
  // Secret, daily-rotated salt (see daily-salt.ts). The raw IP is hashed into
  // the visitor key here and never stored or logged.
  const salt = await getCurrentSalt();
  const receivedAt = Date.now();

  // One GeoIP lookup per batch (all events share the same IP).
  const { country } = await lookupCountry(ip);

  return Promise.all(
    events.map(async (event) => {
      const ua = event.userAgent ?? '';
      // Cookieless visitor key: sha256(salt : ip : userAgent : projectId). Folds
      // user-agent + project into the key so it doubles as the sessionization
      // key (plan workstreams a+b, decisions D4/D6), not just a visitor counter.
      const ipHash = await sha256(`${salt}:${ip}:${ua}:${event.projectId}`);
      const { browser, os } = parseUserAgent(ua);
      const deviceModel = extractDeviceModel(ua);
      const environment = inferEnvironment(event.url, keyPrefix);
      return {
        ...event,
        eventId: crypto.randomUUID(),
        ipHash,
        country,
        receivedAt,
        browser,
        os,
        deviceModel,
        environment,
      };
    }),
  );
}
