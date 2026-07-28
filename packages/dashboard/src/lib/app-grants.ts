/**
 * app-grants.ts: the analytics app-grant door.
 *
 * Analytics is grant-gated. A signed-in suite user may enter (and create
 * projects) only if one of their auth-brain tenants carries the `analytics`
 * app grant. Inner per-project authorization (derived from the verify payload's
 * effective_roles; see project-access.ts) is unchanged in MEANING and runs
 * AFTER this door: the grant answers "may this account use analytics at all",
 * per-project checks answer "may it see THIS project".
 *
 * The grant lives on the verified session payload as the union of
 * `session.tenants[].app_grants` (auth-brain shared >= 1.4.0). We treat the
 * user as granted if ANY of their tenants lists the analytics slug.
 *
 * Version-skew fail-closed: an auth-brain that predates app_grants returns a
 * session whose tenants have NO `app_grants` field. We cannot prove the grant,
 * so we fail closed (deny) and emit a distinct, grep-able log line. This keeps
 * a registry/deploy skew from silently opening the door to everyone.
 */

export const ANALYTICS_APP_SLUG = 'analytics';

/**
 * Grep-able marker for the version-skew fail-closed path. Alerting and log
 * search key off this exact prefix, so do not reword it casually.
 */
export const GRANT_VERSION_SKEW_LOG = '[app-grant] analytics-gate version-skew fail-closed';

/**
 * Structural shape of what the grant evaluation needs from a verified session.
 * The real `SessionVerifyResponse` from the auth-brain SDK is assignable to
 * this, and tests can pass minimal literals.
 */
export interface GrantSessionShape {
  tenants?: Array<{ app_grants?: string[] | null } | null> | null;
}

export type GrantDecision =
  | { granted: true }
  | { granted: false; reason: 'no-grant' | 'version-skew' };

/**
 * Decide whether a verified session carries the analytics app grant.
 *
 * - Granted: at least one tenant's `app_grants` includes the analytics slug.
 * - version-skew: NO tenant carried an `app_grants` array (field absent
 *   everywhere), so the payload predates the grant model. Fails closed.
 * - no-grant: the field is present but the analytics slug is not listed.
 *
 * If even one tenant does carry the analytics slug, that is proof enough and we
 * grant, regardless of a sibling tenant missing the field.
 */
export function evaluateAnalyticsGrant(
  session: GrantSessionShape,
  appSlug: string = ANALYTICS_APP_SLUG,
): GrantDecision {
  const tenants = session?.tenants;
  if (!Array.isArray(tenants)) {
    // No tenants array at all: the payload cannot express grants. Fail closed.
    return { granted: false, reason: 'version-skew' };
  }

  let sawGrantField = false;
  for (const tenant of tenants) {
    const grants = tenant?.app_grants;
    if (!Array.isArray(grants)) continue;
    sawGrantField = true;
    if (grants.includes(appSlug)) {
      return { granted: true };
    }
  }

  // No tenant granted the slug. Version skew is specifically the "field missing
  // entirely" payload: the user HAS tenants, yet not one carries an app_grants
  // array (an auth-brain that predates the grant model). An empty tenant list,
  // or tenants that DO report grants but not analytics, is a plain ungranted
  // user, not skew. Both outcomes deny; only the skew branch alerts.
  if (tenants.length > 0 && !sawGrantField) {
    return { granted: false, reason: 'version-skew' };
  }
  return { granted: false, reason: 'no-grant' };
}

/**
 * Emit the distinct, grep-able version-skew line. Never logs the cookie or any
 * session secret. `context` names the call site (e.g. "auth", "authApi",
 * "page") so a skew can be traced to the surface that hit it.
 */
export function logGrantVersionSkew(context: string, userId: string): void {
  console.warn(`${GRANT_VERSION_SKEW_LOG} context=${context} user=${userId}`);
}
