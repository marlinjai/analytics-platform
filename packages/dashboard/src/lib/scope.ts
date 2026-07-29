/**
 * scope.ts — the ACTIVE-COMPANY scope, derived purely from the auth-brain
 * verify payload.
 *
 * Marlin settled 2026-07-29: the scope switcher is a BOUNDARY, not a filter. The
 * active company is the single axis every project-scoped surface is measured
 * against, and it is re-read from the verify payload on EVERY request — never
 * cached in a cookie we mint, never taken from the client.
 *
 * This module is PURE over the payload (no I/O, no FGA, no cookies), so both the
 * page gate (auth.ts) and the API boundary (auth-check.ts) can share one
 * definition and it is trivially testable against the real `SessionVerifyResponse`
 * shape.
 *
 * Two derived facts:
 *   - `companies`: the analytics-granted companies the user may switch to. A
 *     company qualifies iff it (a) carries the analytics app grant AND (b) the
 *     user holds at least `tenant.viewer` on it (via effective_roles, so
 *     inherited counts). A tenant the user only has `billing_admin` on, or one
 *     with no analytics grant, is NOT a switch destination.
 *   - `activeCompany`: the payload's `active_tenant`, but ONLY when it is one of
 *     the granted companies. If auth-brain's active tenant is null, or points at
 *     a company outside the analytics-granted set (e.g. a billing-only tenant),
 *     the analytics active scope is `null` — "no company chosen" — so the list
 *     and the boundary can never disagree.
 *
 * The no-active-scope rule itself is S1's: exactly one (auth-brain) company ->
 * auth-brain defaults `active_tenant`; more than one and nothing chosen ->
 * `active_tenant` is null. We do not re-derive that here; we honour whatever the
 * payload's `active_tenant` says and map it through the granted set.
 */

import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';
import { ANALYTICS_APP_SLUG } from './app-grants';
import { hasCompanyAccess } from './project-access';

/** A company offered in the switcher / used as the boundary axis. */
export interface ScopeCompany {
  id: string;
  name: string;
  slug: string;
}

/** The resolved active-company scope for a verified session. */
export interface ActiveScope {
  /** The analytics active company, or null when nothing valid is chosen. */
  activeCompany: ScopeCompany | null;
  /** Analytics-granted companies the user may switch to (may be empty). */
  companies: ScopeCompany[];
}

/**
 * The analytics-granted companies for a verified session: carries the analytics
 * app grant AND the user holds at least `tenant.viewer` on it. These are the
 * ONLY valid switch destinations and the only companies that can ever be the
 * active analytics scope.
 */
export function grantedCompanies(session: SessionVerifyResponse): ScopeCompany[] {
  const tenants = session.tenants ?? [];
  return tenants
    .filter(
      (t) =>
        Array.isArray(t.app_grants) &&
        t.app_grants.includes(ANALYTICS_APP_SLUG) &&
        // Read access is the floor for a destination. `billing_admin` (off the
        // ladder) and any role below viewer do NOT qualify. Inheritance-aware.
        hasCompanyAccess(session.effective_roles, t.id, 'tenant.viewer'),
    )
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
}

/**
 * Resolve the active-company scope from the verify payload.
 *
 * `activeCompany` is the payload's `active_tenant` intersected with the granted
 * set: a non-granted or null `active_tenant` yields `null` (no analytics scope
 * chosen), which the page gate renders as the "choose a company" surface.
 */
export function resolveActiveScope(session: SessionVerifyResponse): ActiveScope {
  const companies = grantedCompanies(session);
  const activeId = session.active_tenant?.id ?? null;
  const activeCompany = activeId
    ? companies.find((c) => c.id === activeId) ?? null
    : null;
  return { activeCompany, companies };
}

/**
 * The active analytics company id, or null when no valid company is chosen.
 *
 * This is THE boundary axis: a project-scoped surface is in scope iff the
 * project's `company_id` equals this value. `null` means nothing is in scope
 * (fail-closed), never "allow all".
 */
export function resolveActiveCompanyId(session: SessionVerifyResponse): string | null {
  return resolveActiveScope(session).activeCompany?.id ?? null;
}

/** Is `companyId` a company the session may switch to (a valid destination)? */
export function isSwitchableCompany(
  session: SessionVerifyResponse,
  companyId: string,
): boolean {
  return grantedCompanies(session).some((c) => c.id === companyId);
}
