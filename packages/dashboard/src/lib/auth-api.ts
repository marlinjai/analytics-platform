import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { authBrainClient } from '@/lib/auth-brain';
import { checkProjectAccess } from '@/lib/auth-check';
import { validateApiKey } from '@/lib/api-key';

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

async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return null;
  const session = await authBrainClient.verifySession(cookie);
  return session?.user?.id ?? null;
}

/**
 * Maps a legacy route role string to the auth-brain OpenFGA workspace relation.
 *
 * The auth-brain workspace type only defines three relations: `admin`, `member`,
 * `viewer` (verified against the live OpenFGA model, there is NO `workspace.owner`
 * relation). Ownership is modelled one level up, on `tenant`/`tenant_group`, not on
 * the workspace. So at workspace granularity the most-privileged relation is
 * `workspace.admin`, and a workspace owner is granted `workspace.admin`.
 *
 * Concretely:
 *   'owner' | 'admin'   -> 'workspace.admin'  (manage settings, keys, destructive ops)
 *   'viewer' | 'member' -> 'workspace.viewer' (read access)
 *
 * Any other string throws: a typo or a non-existent relation must NEVER silently
 * downgrade an authorization check (which the old `.every(...)` collapse did).
 */
function mapToWorkspaceRole(role: string): 'workspace.admin' | 'workspace.viewer' {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'workspace.admin';
    case 'viewer':
    case 'member':
      return 'workspace.viewer';
    default:
      throw new Error(
        `authenticateRequest: unknown required role "${role}". ` +
          `Valid roles are owner, admin, member, viewer.`,
      );
  }
}

/**
 * Resolves an array of required route roles to the single workspace relation to
 * enforce. We require the LEAST-privileged relation that satisfies the set: if any
 * listed role is read-only (viewer/member), the route is readable, so we enforce
 * `workspace.viewer`; only when every listed role is privileged (owner/admin) do we
 * enforce `workspace.admin`. Unknown roles throw via mapToWorkspaceRole().
 */
function resolveRequiredRole(requiredRoles?: string[]): 'workspace.admin' | 'workspace.viewer' {
  if (!requiredRoles || requiredRoles.length === 0) return 'workspace.viewer';
  const mapped = requiredRoles.map(mapToWorkspaceRole);
  return mapped.includes('workspace.viewer') ? 'workspace.viewer' : 'workspace.admin';
}

/**
 * Authenticate a request via session (lumitra_session cookie) or API key.
 *
 * 1. Try session cookie -> verifySession() -> checkProjectAccess() via OpenFGA
 * 2. If no session, try API key from X-API-Key header
 * 3. Project keys: verify the key's projectId matches the route's projectId
 * 4. Account keys: verify user has workspace access to the route's project
 * 5. API keys carry implicit "admin" access level
 *
 * requiredRoles map to auth-brain workspace relations via resolveRequiredRole():
 *   ['viewer'] / ['member']   -> 'workspace.viewer'
 *   ['owner'] / ['admin'] / ['owner','admin'] -> 'workspace.admin'
 *   undefined / []            -> 'workspace.viewer'
 * An unknown role string throws rather than silently downgrading the check.
 */
export async function authenticateRequest(
  request: NextRequest,
  projectId: string,
  requiredRoles?: string[],
): Promise<AuthResult> {
  const requiredRole = resolveRequiredRole(requiredRoles);

  // --- Try session auth ---
  const userId = await getSessionUserId();
  if (userId) {
    const hasAccess = await checkProjectAccess(userId, projectId, requiredRole);
    if (!hasAccess) return { authenticated: false, error: 'Forbidden', status: 403 };
    return { authenticated: true, userId, projectId };
  }

  // --- Fall back to API key ---
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return { authenticated: false, error: 'Unauthorized', status: 401 };

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return { authenticated: false, error: 'Invalid or revoked API key', status: 401 };
  }

  if (keyInfo.kind === 'account') {
    const hasAccess = await checkProjectAccess(keyInfo.userId, projectId, requiredRole);
    if (!hasAccess) {
      return {
        authenticated: false,
        error: 'Account key owner does not have access to this project',
        status: 403,
      };
    }
    return { authenticated: true, userId: keyInfo.userId, projectId };
  }

  if (keyInfo.projectId !== projectId) {
    return { authenticated: false, error: 'API key does not belong to this project', status: 403 };
  }

  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes('admin')) {
    return { authenticated: false, error: 'Forbidden', status: 403 };
  }

  return { authenticated: true, userId: `apikey:${keyInfo.keyId}`, projectId };
}

/**
 * Authenticate a request that is not project-scoped (e.g. project creation).
 * Supports session auth or account-level API keys.
 */
export async function authenticateAccountRequest(
  request: NextRequest,
): Promise<{ authenticated: true; userId: string } | AuthFailure> {
  const userId = await getSessionUserId();
  if (userId) return { authenticated: true, userId };

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return { authenticated: false, error: 'Unauthorized', status: 401 };

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) return { authenticated: false, error: 'Invalid or revoked API key', status: 401 };

  if (keyInfo.kind !== 'account') {
    return {
      authenticated: false,
      error: 'Project-level API keys cannot perform account-level operations. Use an account key (ap_account_).',
      status: 403,
    };
  }

  return { authenticated: true, userId: keyInfo.userId };
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
