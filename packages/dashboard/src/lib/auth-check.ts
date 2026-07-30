import { cookies } from 'next/headers';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';
import { getDb } from './db';
import { authBrainClient } from './auth-brain';
import { hasCompanyAccess, type CompanyRequirement } from './project-access';
import { resolveActiveCompanyId } from './scope';

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
export async function lookupCompanyId(projectId: string): Promise<string | null> {
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
 * The result of the active-company BOUNDARY + role decision for a session.
 *
 * The boundary and the role check produce DIFFERENT statuses on purpose:
 *   - `404` (foreign / no scope): the project does not belong to the ACTIVE
 *     company — or there is no active company at all. It is INVISIBLE, exactly
 *     as a project that does not exist. This is the suite convention (auth-brain
 *     collapses unknown-and-foreign into 404; Studio: "a foreign resource is
 *     simply invisible (404), never a 403 existence leak"). We never leak which
 *     project ids live in other companies.
 *   - `403` (forbidden): the project IS in the active company, but the caller's
 *     role there is insufficient for the action.
 */
export type ProjectAuthz =
  | { ok: true; userId: string }
  | { ok: false; status: 403 | 404; error: string };

/**
 * The active-company boundary + role decision for an already-verified session.
 *
 * Marlin settled 2026-07-29: the active scope is a BOUNDARY, not a filter. So a
 * project-scoped surface is authorized iff:
 *   1. the project's `company_id` EQUALS the session's ACTIVE company (not merely
 *      "one of the user's companies"); anything else is 404, and
 *   2. the caller holds the required role on that (active) company; else 403.
 *
 * The active company comes ONLY from the verify payload's `active_tenant` (via
 * resolveActiveCompanyId) — never from a header, query param, or body. The
 * payload is the live read: auth-brain re-checks roles and nulls a revoked scope
 * on every verify, so honouring it fails a revoked role closed immediately.
 */
export async function decideProjectForSession(
  session: SessionVerifyResponse,
  projectId: string,
  requiredRole: CompanyRequirement = 'tenant.viewer',
): Promise<ProjectAuthz> {
  const companyId = await lookupCompanyId(projectId);
  const activeCompanyId = resolveActiveCompanyId(session);

  // BOUNDARY first. No company, no active scope, or a DIFFERENT company (even one
  // the user is a member of but has not switched to) -> invisible (404).
  if (!companyId || !activeCompanyId || companyId !== activeCompanyId) {
    return { ok: false, status: 404, error: 'Not found' };
  }

  // In scope: now the role check. Insufficient role -> 403 (not an existence
  // leak: the project IS in the active company).
  if (!hasCompanyAccess(session.effective_roles, companyId, requiredRole)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, userId: session.user.id };
}

/**
 * SESSION-path project authorization WITH the active-company boundary, for the
 * stats / heatmap / session / toolbar routes that already did `auth()` (for the
 * 401) and hold only a `userId`.
 *
 * It re-reads the cookie and re-verifies (30s SDK cache) so the decision is made
 * against the LIVE payload — a role revoked mid-session, or a scope auth-brain
 * has nulled, fails closed on the very next request without waiting for a new
 * session. Returns the discriminated `ProjectAuthz` so a foreign project
 * collapses to 404 and an in-scope role failure to 403 (the boolean
 * `checkProjectMembership` could not tell those apart).
 *
 * Fail-closed: a missing/failed verify or a user mismatch is treated as "nothing
 * is in scope" -> 404 (never leaks existence, never 500s).
 */
export async function authorizeProjectRequest(
  userId: string,
  projectId: string,
  requiredRole: CompanyRequirement = 'tenant.viewer',
): Promise<ProjectAuthz> {
  const jar = await cookies();
  const cookie = jar.get('lumitra_session')?.value;
  if (!cookie) return { ok: false, status: 404, error: 'Not found' };

  const session = await authBrainClient.verifySession(cookie);
  if (!session?.user?.id || session.user.id !== userId) {
    return { ok: false, status: 404, error: 'Not found' };
  }

  return decideProjectForSession(session, projectId, requiredRole);
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
