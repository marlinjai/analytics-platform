import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import type { EffectiveRoles, SessionVerifyResponse } from '@marlinjai/auth-brain-shared';
import { authBrainClient } from '@/lib/auth-brain';
import { decideProjectForSession, lookupCompanyId } from '@/lib/auth-check';
import { hasCompanyAccess, type CompanyRequirement } from '@/lib/project-access';
import { validateApiKey } from '@/lib/api-key';
import { ANALYTICS_APP_SLUG, evaluateAnalyticsGrant, logGrantVersionSkew } from '@/lib/app-grants';

type AuthSuccess = {
  authenticated: true;
  userId: string;
  projectId: string;
};

type AuthFailure = {
  authenticated: false;
  error: string;
  status: number;
};

type AuthResult = AuthSuccess | AuthFailure;

/**
 * Resolve the session cookie for an API request and apply the analytics door.
 *
 * Three outcomes the callers must tell apart:
 * - `none`: no cookie, or the cookie failed verification. The caller falls
 *   through to API-key auth (machine callers keep their own auth model).
 * - `ungranted`: a valid signed-in user whose tenants do NOT carry the
 *   analytics grant (or a version-skew payload, logged here). The caller must
 *   block with 403 and NOT fall through to API-key auth: this is a human
 *   session that the door refuses, not a missing credential.
 * - `granted`: a valid session with the analytics grant. Per-project
 *   authorization still runs afterwards, unchanged.
 */
type SessionGrant =
  | { kind: 'none' }
  | { kind: 'ungranted' }
  | { kind: 'granted'; userId: string; session: SessionVerifyResponse };

async function resolveSessionGrant(): Promise<SessionGrant> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return { kind: 'none' };

  const session = await authBrainClient.verifySession(cookie);
  if (!session?.user?.id) return { kind: 'none' };

  const decision = evaluateAnalyticsGrant(session);
  if (!decision.granted) {
    if (decision.reason === 'version-skew') {
      logGrantVersionSkew('authApi', session.user.id);
    }
    return { kind: 'ungranted' };
  }

  // Carry the verified payload forward: per-project authorization is derived
  // from its effective_roles, not from a second FGA round-trip.
  return { kind: 'granted', userId: session.user.id, session };
}

/**
 * The 403 body returned when a signed-in user lacks the analytics app grant.
 * Distinct from a per-project "Forbidden" so the client can route the user to
 * the request-access page rather than showing a project-permission error.
 */
const NO_GRANT_FAILURE: AuthFailure = {
  authenticated: false,
  error: 'Your account does not have access to Analytics. Request access to continue.',
  status: 403,
};

/**
 * Maps a legacy route role string to the COMPANY (auth-brain tenant) requirement.
 *
 * S2: a project belongs to a company, and the tenant role ladder is
 * `owner > admin > member > viewer`. A route names a minimum role via a legacy
 * relation string; we map it onto the tenant requirement:
 *   'owner' | 'admin'   -> 'tenant.admin'  (settings, keys, destructive ops)
 *   'member'            -> 'tenant.member' (writes: experiments, flags, funnels)
 *   'viewer'            -> 'tenant.viewer' (read access)
 *
 * The `owner|admin -> tenant.admin` collapse does NOT let `billing_admin`
 * through: `billing_admin` is never a route requirement, and `hasCompanyAccess`
 * grants `tenant.admin` only to an actual `admin`/`owner` company role — a
 * `billing_admin` caller satisfies nothing on this ladder.
 *
 * Any other string throws: a typo or a non-existent relation must NEVER silently
 * downgrade an authorization check (which the old `.every(...)` collapse did).
 */
function mapToCompanyRole(role: string): CompanyRequirement {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'tenant.admin';
    case 'member':
      return 'tenant.member';
    case 'viewer':
      return 'tenant.viewer';
    default:
      throw new Error(
        `authenticateRequest: unknown required role "${role}". ` +
          `Valid roles are owner, admin, member, viewer.`,
      );
  }
}

/**
 * Resolves an array of required route roles to the single company requirement to
 * enforce. We require the LEAST-privileged requirement that satisfies the set on
 * the `viewer < member < admin` ladder: a listed viewer means the route is
 * readable (`tenant.viewer`); else a listed member means it is a write
 * (`tenant.member`); only when every listed role is privileged (owner/admin) do
 * we enforce `tenant.admin`. Unknown roles throw via mapToCompanyRole().
 */
function resolveRequiredRole(requiredRoles?: string[]): CompanyRequirement {
  if (!requiredRoles || requiredRoles.length === 0) return 'tenant.viewer';
  const mapped = requiredRoles.map(mapToCompanyRole);
  if (mapped.includes('tenant.viewer')) return 'tenant.viewer';
  if (mapped.includes('tenant.member')) return 'tenant.member';
  return 'tenant.admin';
}

/**
 * Project (site) API keys carry implicit admin over their OWN project, but must
 * not perform OWNER-only destructive lifecycle ops (project reset / deletion).
 * A route flags those by requiring `owner` without `admin`; deny a project key
 * there, and allow it on every read/write/admin route as before.
 */
function projectKeyForbidden(requiredRoles?: string[]): boolean {
  return Boolean(requiredRoles?.includes('owner') && !requiredRoles.includes('admin'));
}

/**
 * Authenticate a request via session (lumitra_session cookie) or API key.
 *
 * 1. Try session cookie -> verifySession() -> per-project decision from the
 *    payload's effective_roles (no FGA)
 * 2. If no session, try API key from X-API-Key header
 * 3. Project keys (`ap_live_`/`ap_test_`): the key's projectId must match the
 *    route's, and they carry implicit admin over their OWN project only
 * 4. Service-account keys (`sk_live_`): verifyApiKey() -> the SAME door + company
 *    role check the session path runs, against the key's scoped company. There is
 *    no OpenFGA call on either path (decision 2: one decision plane)
 *
 * requiredRoles map to auth-brain tenant requirements via resolveRequiredRole():
 *   ['viewer'] / undefined / [] -> 'tenant.viewer'
 *   ['member']                  -> 'tenant.member'
 *   ['admin'] / ['owner'] / ['owner','admin'] -> 'tenant.admin'
 * An unknown role string throws rather than silently downgrading the check.
 */
export async function authenticateRequest(
  request: NextRequest,
  projectId: string,
  requiredRoles?: string[],
): Promise<AuthResult> {
  const requiredRole = resolveRequiredRole(requiredRoles);

  // --- Try session auth ---
  const sessionGrant = await resolveSessionGrant();
  if (sessionGrant.kind === 'ungranted') return NO_GRANT_FAILURE;
  if (sessionGrant.kind === 'granted') {
    const { userId, session } = sessionGrant;
    // Per-project authorization straight from the verified payload: the
    // active-company BOUNDARY (foreign project -> 404) then the company role
    // check (insufficient -> 403). No FGA on the session path.
    const decision = await decideProjectForSession(session, projectId, requiredRole);
    if (!decision.ok) {
      return { authenticated: false, error: decision.error, status: decision.status };
    }
    return { authenticated: true, userId, projectId };
  }

  // --- Fall back to API key ---
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return { authenticated: false, error: 'Unauthorized', status: 401 };

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return { authenticated: false, error: 'Invalid or revoked API key', status: 401 };
  }

  if (keyInfo.kind === 'service-account') {
    // Machine principal, authorized from the SAME payload shape as a human
    // session. auth-brain's verifyApiKey returns effective_roles + the scoped
    // company's app_grants, so this branch runs the identical door + role check
    // the session branch runs, and there is no OpenFGA call anywhere in
    // analytics any more (decision 2: one decision plane).
    //
    // The company BOUNDARY is the key's own scope: a key scoped to company A
    // cannot reach a project in company B, exactly as a human whose active
    // company is A cannot. Foreign project -> 404, never 403: a machine caller
    // must not be able to probe which project ids exist elsewhere either.
    if (!keyInfo.appGrants.includes(ANALYTICS_APP_SLUG)) {
      return NO_GRANT_FAILURE;
    }
    const projectCompanyId = await lookupCompanyId(projectId);
    if (!projectCompanyId || projectCompanyId !== keyInfo.companyId) {
      return { authenticated: false, error: 'Not found', status: 404 };
    }
    if (!hasCompanyAccess(keyInfo.effectiveRoles, projectCompanyId, requiredRole)) {
      return { authenticated: false, error: 'Forbidden', status: 403 };
    }
    return { authenticated: true, userId: `service_account:${keyInfo.principalId}`, projectId };
  }

  if (keyInfo.projectId !== projectId) {
    return { authenticated: false, error: 'API key does not belong to this project', status: 403 };
  }

  if (projectKeyForbidden(requiredRoles)) {
    return { authenticated: false, error: 'Forbidden', status: 403 };
  }

  return { authenticated: true, userId: `apikey:${keyInfo.keyId}`, projectId };
}

/**
 * Authenticate a request that is not project-scoped (e.g. project creation).
 * Supports session auth or account-level API keys.
 *
 * On success it reports the principal kind and, for a session, the verified
 * payload, so callers that must filter a resource LIST by per-project access
 * (e.g. GET /api/projects) can decide from `session.effective_roles`.
 *
 * A SERVICE-ACCOUNT principal now carries a payload too (effective roles plus its
 * scoped company), so list filtering works identically for both: no principal
 * needs a per-item round trip any more.
 */
type AccountAuthSuccess =
  | { authenticated: true; principal: 'session'; userId: string; session: SessionVerifyResponse }
  | {
      authenticated: true;
      principal: 'service-account';
      userId: string;
      companyId: string;
      effectiveRoles: EffectiveRoles;
      session?: undefined;
    };

export async function authenticateAccountRequest(
  request: NextRequest,
): Promise<AccountAuthSuccess | AuthFailure> {
  const sessionGrant = await resolveSessionGrant();
  if (sessionGrant.kind === 'ungranted') return NO_GRANT_FAILURE;
  if (sessionGrant.kind === 'granted') {
    return {
      authenticated: true,
      principal: 'session',
      userId: sessionGrant.userId,
      session: sessionGrant.session,
    };
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return { authenticated: false, error: 'Unauthorized', status: 401 };

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) return { authenticated: false, error: 'Invalid or revoked API key', status: 401 };

  if (keyInfo.kind !== 'service-account') {
    return {
      authenticated: false,
      error:
        'Project-level API keys cannot perform account-level operations. Use an auth-brain service-account key (sk_live_) scoped to the company.',
      status: 403,
    };
  }

  // The door applies to machine callers too: a company without the analytics
  // entitlement gets nothing, whoever is asking.
  if (!keyInfo.appGrants.includes(ANALYTICS_APP_SLUG)) return NO_GRANT_FAILURE;

  return {
    authenticated: true,
    principal: 'service-account',
    userId: `service_account:${keyInfo.principalId}`,
    companyId: keyInfo.companyId,
    effectiveRoles: keyInfo.effectiveRoles,
  };
}

/**
 * CORS headers for API endpoints accessed by CLI tools and external agents.
 */
export function corsHeaders(origin?: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}
