import { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST, API_KEY_PREFIX_ACCOUNT } from '@analytics-platform/shared';

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function generateApiKey(environment: 'live' | 'test' | 'account'): Promise<{
  fullKey: string;
  keyHash: string;
  prefix: string;
}> {
  const prefixMap = {
    live: API_KEY_PREFIX_LIVE,
    test: API_KEY_PREFIX_TEST,
    account: API_KEY_PREFIX_ACCOUNT,
  } as const;
  const prefix = prefixMap[environment];
  const fullKey = prefix + randomHex(16);
  const keyHash = await sha256(fullKey);
  return { fullKey, keyHash, prefix };
}
