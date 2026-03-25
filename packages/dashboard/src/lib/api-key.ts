import { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST, API_KEY_PREFIX_ACCOUNT } from '@analytics-platform/shared';
import { getDb } from './db';

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ValidatedProjectKey {
  kind: 'project';
  projectId: string;
  keyId: string;
  prefix: string;
}

interface ValidatedAccountKey {
  kind: 'account';
  userId: string;
  keyId: string;
  prefix: string;
}

export type ValidatedKey = ValidatedProjectKey | ValidatedAccountKey;

export async function validateApiKey(
  apiKey: string
): Promise<ValidatedKey | null> {
  const keyHash = await sha256(apiKey);
  const db = getDb();

  // Account-level key
  if (apiKey.startsWith(API_KEY_PREFIX_ACCOUNT)) {
    const rows = await db`
      SELECT id, user_id, prefix
      FROM account_api_keys
      WHERE key_hash = ${keyHash}
        AND revoked_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const row = rows[0]!;
    db`UPDATE account_api_keys SET last_used_at = now() WHERE id = ${row.id}`.catch(() => {});
    return {
      kind: 'account',
      userId: row.user_id as string,
      keyId: row.id as string,
      prefix: row.prefix as string,
    };
  }

  // Project-level key
  if (!apiKey.startsWith(API_KEY_PREFIX_LIVE) && !apiKey.startsWith(API_KEY_PREFIX_TEST)) {
    return null;
  }

  const rows = await db`
    SELECT id, project_id, prefix
    FROM api_keys
    WHERE key_hash = ${keyHash}
      AND revoked_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0]!;
  db`UPDATE api_keys SET last_used_at = now() WHERE id = ${row.id}`.catch(() => {});
  return {
    kind: 'project',
    projectId: row.project_id as string,
    keyId: row.id as string,
    prefix: row.prefix as string,
  };
}
