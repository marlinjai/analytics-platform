import type { TrackerEvent, StoredEvent } from '@analytics-platform/shared';

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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

export async function enrichEvents(
  events: TrackerEvent[],
  ip: string
): Promise<StoredEvent[]> {
  const salt = getDailySalt();
  const ipHash = await sha256(`${ip}:${salt}`);
  const receivedAt = Date.now();

  return events.map((event) => {
    const { browser, os } = parseUserAgent(event.userAgent ?? '');
    return {
      ...event,
      eventId: crypto.randomUUID(),
      ipHash,
      country: '', // stub — add GeoIP lookup later
      receivedAt,
      browser,
      os,
    };
  });
}
