/**
 * Unit tests for the analytics app-grant decision logic.
 *
 * The door is: a signed-in user may enter only if one of their auth-brain
 * tenants carries the `analytics` app grant (the union of
 * `session.tenants[].app_grants`). A payload that predates the grant model (no
 * `app_grants` field at all) MUST fail closed and be flagged as version skew,
 * so a registry/deploy skew never silently opens the door.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ANALYTICS_APP_SLUG,
  GRANT_VERSION_SKEW_LOG,
  evaluateAnalyticsGrant,
  logGrantVersionSkew,
} from '@/lib/app-grants';

describe('evaluateAnalyticsGrant', () => {
  it('grants when a tenant lists the analytics slug', () => {
    const decision = evaluateAnalyticsGrant({ tenants: [{ app_grants: ['analytics'] }] });
    expect(decision).toEqual({ granted: true });
  });

  it('grants via the UNION: any granting tenant is enough', () => {
    const decision = evaluateAnalyticsGrant({
      tenants: [{ app_grants: ['crm'] }, { app_grants: ['billing', 'analytics'] }],
    });
    expect(decision).toEqual({ granted: true });
  });

  it('denies (no-grant) when the field is present but the slug is absent', () => {
    const decision = evaluateAnalyticsGrant({
      tenants: [{ app_grants: ['crm'] }, { app_grants: [] }],
    });
    expect(decision).toEqual({ granted: false, reason: 'no-grant' });
  });

  it('fails closed as version-skew when NO tenant carries the app_grants field', () => {
    // Simulates an auth-brain payload that predates app_grants.
    const decision = evaluateAnalyticsGrant({ tenants: [{}, {}] } as never);
    expect(decision).toEqual({ granted: false, reason: 'version-skew' });
  });

  it('fails closed as version-skew when tenants is missing entirely', () => {
    expect(evaluateAnalyticsGrant({})).toEqual({ granted: false, reason: 'version-skew' });
    expect(evaluateAnalyticsGrant({ tenants: null })).toEqual({
      granted: false,
      reason: 'version-skew',
    });
  });

  it('still grants when one tenant grants and a sibling lacks the field', () => {
    // A clear grant is proof enough; a skewed sibling must not override it.
    const decision = evaluateAnalyticsGrant({
      tenants: [{}, { app_grants: ['analytics'] }] as never,
    });
    expect(decision).toEqual({ granted: true });
  });

  it('denies a user with zero tenants but an app_grants-capable shape as no-grant', () => {
    // Empty tenants array: the payload CAN express grants, there just are none.
    expect(evaluateAnalyticsGrant({ tenants: [] })).toEqual({
      granted: false,
      reason: 'no-grant',
    });
  });

  it('exposes the canonical slug', () => {
    expect(ANALYTICS_APP_SLUG).toBe('analytics');
  });
});

describe('logGrantVersionSkew', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits the distinct grep-able marker without leaking secrets', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logGrantVersionSkew('unit', 'user-123');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    expect(line.startsWith(GRANT_VERSION_SKEW_LOG)).toBe(true);
    expect(line).toContain('context=unit');
    expect(line).toContain('user=user-123');
  });
});
