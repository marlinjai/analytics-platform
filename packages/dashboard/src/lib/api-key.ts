import { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST } from '@analytics-platform/shared';
import { getDb } from './db.js';

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ValidatedKey {
  projectId: string;
  keyId: string;
  prefix: string;
}

export async function validateApiKey(
  apiKey: string
): Promise<ValidatedKey | null> {
  // Check prefix
  if (!apiKey.startsWith(API_KEY_PREFIX_LIVE) && !apiKey.startsWith(API_KEY_PREFIX_TEST)) {
    return null;
  }

  const keyHash = await sha256(apiKey);
  const db = getDb();

  const rows = await db`
    SELECT id, project_id, prefix
    FROM api_keys
    WHERE key_hash = ${keyHash}
      AND revoked_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0]!;

  // Update last_used_at
  db`UPDATE api_keys SET last_used_at = now() WHERE id = ${row.id}`.catch(() => {
    // Non-critical, don't block the request
  });

  return {
    projectId: row.project_id as string,
    keyId: row.id as string,
    prefix: row.prefix as string,
  };
}
