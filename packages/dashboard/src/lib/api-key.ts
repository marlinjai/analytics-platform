import { API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST } from '@analytics-platform/shared';
import type { EffectiveRoles } from '@marlinjai/auth-brain-shared';
import { getDb } from './db';
import { authBrainClient } from './auth-brain';

// auth-brain's service-account key prefix. Deliberately distinct from analytics'
// own `ap_*` prefixes, so the two credential families can never be confused.
const AUTH_BRAIN_KEY_PREFIX = 'sk_live_';

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

/**
 * A machine principal presenting an auth-brain SERVICE-ACCOUNT key.
 *
 * This replaces the old local `account_api_keys` table. The point is not the
 * storage location: it is that auth-brain's `verifyApiKey` returns a payload
 * carrying `effective_roles` and the scoped company's `app_grants`, exactly like
 * a human session's verify payload. A local key produced NO payload, which is
 * why authorizing it needed a direct OpenFGA `can()` (the last violation of
 * decision 2's one-decision-plane rule). With a payload, the machine branch uses
 * the SAME `hasCompanyAccess` the session branch uses, and the FGA call is gone.
 */
interface ValidatedServiceAccountKey {
  kind: 'service-account';
  /** The service-account principal id (NOT a human user id). */
  principalId: string;
  keyId: string;
  /** The company (auth-brain tenant) this key is scoped to. */
  companyId: string;
  /** Entitlement slugs of the scoped company; the analytics door reads this. */
  appGrants: string[];
  /** Effective roles across every scope the key reaches, direct + inherited. */
  effectiveRoles: EffectiveRoles;
}

export type ValidatedKey = ValidatedProjectKey | ValidatedServiceAccountKey;

export async function validateApiKey(
  apiKey: string
): Promise<ValidatedKey | null> {
  const keyHash = await sha256(apiKey);
  const db = getDb();

  // auth-brain SERVICE-ACCOUNT key. Resolved by auth-brain, never stored here:
  // analytics consumes identity, it does not mint or hold machine credentials.
  // Fail-closed: the SDK maps 401 / timeout / 5xx to null, and a key scoped to
  // anything other than a company is rejected outright (a workspace- or
  // org-scoped key has no single company to authorize against, and an org-scoped
  // key carries EMPTY app_grants by design, so it could never pass the door).
  if (apiKey.startsWith(AUTH_BRAIN_KEY_PREFIX)) {
    let verified;
    try {
      verified = await authBrainClient.verifyApiKey(apiKey);
    } catch {
      return null;
    }
    if (!verified?.principal) return null;
    const { scope, id: principalId } = verified.principal;
    if (scope?.type !== 'tenant' || !scope.id) return null;
    return {
      kind: 'service-account',
      principalId,
      keyId: verified.key.id,
      companyId: scope.id,
      appGrants: scope.app_grants ?? [],
      effectiveRoles: verified.effective_roles,
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
