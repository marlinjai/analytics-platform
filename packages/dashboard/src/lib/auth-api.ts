import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
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

/**
 * Authenticate a request via session (cookie) or API key (X-API-Key header).
 *
 * 1. Try session auth first (existing auth() + checkProjectMembership())
 * 2. If no session, try API key from X-API-Key header
 * 3. For project keys: verify the key's projectId matches the route's projectId
 * 4. For account keys: verify the user has membership to the route's project
 * 5. API keys get implicit 'admin' role (they can create/manage experiments)
 */
export async function authenticateRequest(
  request: NextRequest,
  projectId: string,
  requiredRoles?: string[],
): Promise<AuthResult> {
  // --- Try session auth first ---
  const session = await auth();
  if (session?.user?.id) {
    const hasAccess = await checkProjectMembership(
      session.user.id,
      projectId,
      requiredRoles,
    );
    if (!hasAccess) {
      return { authenticated: false, error: 'Forbidden', status: 403 };
    }
    return { authenticated: true, userId: session.user.id, projectId };
  }

  // --- Fall back to API key auth ---
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return { authenticated: false, error: 'Unauthorized', status: 401 };
  }

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return {
      authenticated: false,
      error: 'Invalid or revoked API key',
      status: 401,
    };
  }

  if (keyInfo.kind === 'account') {
    // Account key: verify user has membership to this project
    const hasAccess = await checkProjectMembership(
      keyInfo.userId,
      projectId,
      requiredRoles,
    );
    if (!hasAccess) {
      return {
        authenticated: false,
        error: 'Account key owner does not have access to this project',
        status: 403,
      };
    }
    return { authenticated: true, userId: keyInfo.userId, projectId };
  }

  // Project key: verify it belongs to the project in the route
  if (keyInfo.projectId !== projectId) {
    return {
      authenticated: false,
      error: 'API key does not belong to this project',
      status: 403,
    };
  }

  // API keys get implicit 'admin' role — if required roles are specified,
  // check that 'admin' (or 'owner') is among them.
  if (requiredRoles && requiredRoles.length > 0) {
    const apiKeyRole = 'admin';
    if (!requiredRoles.includes(apiKeyRole)) {
      return { authenticated: false, error: 'Forbidden', status: 403 };
    }
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
  // Try session auth
  const session = await auth();
  if (session?.user?.id) {
    return { authenticated: true, userId: session.user.id };
  }

  // Try account API key
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return { authenticated: false, error: 'Unauthorized', status: 401 };
  }

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return { authenticated: false, error: 'Invalid or revoked API key', status: 401 };
  }

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
