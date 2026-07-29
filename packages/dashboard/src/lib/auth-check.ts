import { cookies } from 'next/headers';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';
import { getDb } from './db';
import { authBrainClient } from './auth-brain';
import { hasCompanyAccess, type CompanyRequirement } from './project-access';

/**
 * Per-project authorization for analytics.
 *
 * S2 decision: a project belongs to a COMPANY (auth-brain tenant), not a
 * workspace. Access is company membership, derived from the verified session's
 * `effective_roles.tenants` (see project-access.ts `hasCompanyAccess`). OpenFGA
 * stays auth-brain's internal engine; no SESSION path calls `can()`.
 *
 * The tenant role ladder is `owner > admin > member > viewer`. A route names a
 * minimum company role via one of the legacy relation strings, mapped here:
 *   viewer          -> "tenant.viewer" (read-only)
 *   member          -> "tenant.member" (write: experiments, flags, funnels, ...)
 *   admin  | owner  -> "tenant.admin"  (settings, keys, destructive ops)
 * `billing_admin` is not accepted as a route requirement and never satisfies a
 * check (enforced in hasCompanyAccess).
 */
function mapMembershipRole(role: string): CompanyRequirement {
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
        `checkProjectMembership: unknown required role "${role}". ` +
          `Valid roles are owner, admin, member, viewer.`,
      );
  }
}

/** Resolve a project's owning company id. Returns null if the project has no
 * company (unreachable project) or does not exist — both DENY downstream. */
async function lookupCompanyId(projectId: string): Promise<string | null> {
  const db = getDb();
  const [project] = await db<{ company_id: string }[]>`
    SELECT company_id FROM projects WHERE id = ${projectId} AND company_id IS NOT NULL
  `;
  return project?.company_id ?? null;
}

/**
 * Decide project access for an already-verified session, straight from its
 * effective roles. No cookie re-read, no FGA. Use this on paths that already
 * hold the verified `SessionVerifyResponse` (e.g. the API auth seam).
 *
 * Fail-closed: a project with no company, or a company the session has no
 * effective role on, returns false.
 */
export async function checkCompanyAccessForSession(
  session: SessionVerifyResponse,
  projectId: string,
  requiredRole: CompanyRequirement = 'tenant.viewer',
): Promise<boolean> {
  const companyId = await lookupCompanyId(projectId);
  return hasCompanyAccess(session.effective_roles, companyId, requiredRole);
}

/**
 * SESSION path: derive per-project access from the caller's verified session.
 *
 * Reads the lumitra_session cookie, verifies it with auth-brain (30s cached),
 * and checks the payload's effective_roles.tenants. Retained signature so the
 * ~dozen stats/heatmap/session route call-sites need no change; `userId` is
 * enforced against the session as defense-in-depth.
 *
 * Fail-closed: no cookie, a failed/expired verify (SDK maps timeouts + 5xx to
 * null), a user mismatch, or a missing company role all return false. There is
 * NO "allow because we could not check" branch.
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: CompanyRequirement = 'tenant.viewer',
): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return false;

  const session = await authBrainClient.verifySession(cookie);
  if (!session?.user?.id || session.user.id !== userId) return false;

  return checkCompanyAccessForSession(session, projectId, requiredRole);
}

/**
 * @deprecated Use checkProjectAccess() with the tenant.viewer / tenant.member /
 * tenant.admin role strings. Kept as a backward-compat shim so existing routes
 * (all read-only, no requiredRoles) continue to compile unchanged.
 */
export async function checkProjectMembership(
  userId: string,
  projectId: string,
  requiredRoles?: string[],
): Promise<boolean> {
  // Enforce the LEAST-privileged relation that satisfies the set: a read-only
  // role anywhere in the list means the route is readable. Unknown roles throw
  // rather than silently downgrading the check.
  const role =
    !requiredRoles || requiredRoles.length === 0
      ? 'tenant.viewer'
      : leastPrivileged(requiredRoles.map(mapMembershipRole));
  return checkProjectAccess(userId, projectId, role);
}

/** The least-privileged (most permissive) requirement in a set. */
function leastPrivileged(reqs: CompanyRequirement[]): CompanyRequirement {
  if (reqs.includes('tenant.viewer')) return 'tenant.viewer';
  if (reqs.includes('tenant.member')) return 'tenant.member';
  return 'tenant.admin';
}

/**
 * ACCOUNT-KEY (machine) path — NAMED, JUSTIFIED OpenFGA SURVIVOR.
 *
 * Local analytics account keys (the `account_api_keys` table) authenticate a
 * machine AS an auth-brain user, but they produce NO session verify payload:
 * there is no cookie to verify, and auth-brain does not know these local keys,
 * so `verifyApiKey()` cannot return their effective_roles either. Until account
 * keys are re-issued as auth-brain service accounts — an auth-brain change,
 * explicitly out of scope for this slice — the only payload-free way to
 * authorize the key owner per project is an OpenFGA `can()` by user id.
 *
 * S2 re-point: the check is now "does this user hold `requiredRole` on the
 * project's COMPANY" (a `tenant`-typed can()), not on its workspace. The SDK
 * builds the FGA object as `tenant:<companyId>` with relation viewer/member/admin
 * (verified against the SDK's can() implementation, which accepts scope=tenant).
 *
 * This preserves the PRIOR SHAPE (no widening, no local rule invented) and is
 * the single surviving direct-FGA decision in analytics. Fail-closed on any FGA
 * error and on a NULL/unknown company. Escalated in the task report for follow-up.
 */
export async function checkAccountKeyProjectAccess(
  userId: string,
  projectId: string,
  requiredRole: CompanyRequirement = 'tenant.viewer',
): Promise<boolean> {
  const companyId = await lookupCompanyId(projectId);
  if (!companyId) return false;
  try {
    return await authBrainClient.can(userId, requiredRole, {
      type: 'tenant',
      id: companyId,
      tenantId: companyId,
    });
  } catch {
    // can() throws on OpenFGA errors; deny rather than 500 or fall open.
    return false;
  }
}
