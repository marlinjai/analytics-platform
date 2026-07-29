/**
 * scope.ts — the ACTIVE-COMPANY scope, derived purely from the verify payload.
 *
 * These are pure-function tests (no cookies, no I/O). They pin the two rules the
 * whole boundary rests on:
 *   - the switch destinations are exactly the analytics-granted companies the
 *     user can READ (grant + at least tenant.viewer; billing_admin excluded), and
 *   - the active analytics company is `active_tenant` intersected with that set,
 *     so a null or non-granted active_tenant means "no company chosen" (null).
 */
import { describe, it, expect } from 'vitest';
import type { SessionVerifyResponse } from '@marlinjai/auth-brain-shared';
import {
  grantedCompanies,
  resolveActiveScope,
  resolveActiveCompanyId,
  isSwitchableCompany,
} from '@/lib/scope';

const CO_A = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const CO_B = '019f0000-0000-7000-8000-000000000000';
const CO_C = '019fcccc-0000-7000-8000-000000000000';

type TenantSpec = { id: string; role: string; grant?: boolean };

function session(tenants: TenantSpec[], activeId: string | null): SessionVerifyResponse {
  return {
    user: { id: 'user-1' },
    tenants: tenants.map((t) => ({
      id: t.id,
      name: `Co ${t.id.slice(0, 4)}`,
      slug: t.id.slice(0, 4),
      app_grants: t.grant === false ? [] : ['analytics'],
    })),
    active_tenant: activeId ? { id: activeId } : null,
    effective_roles: {
      tenant_groups: [],
      tenants: tenants.map((t) => ({ id: t.id, role: t.role, source: 'direct' })),
      workspaces: [],
    },
  } as unknown as SessionVerifyResponse;
}

describe('grantedCompanies — valid switch destinations', () => {
  it('includes a company with the analytics grant and at least viewer', () => {
    const s = session([{ id: CO_A, role: 'member' }], CO_A);
    expect(grantedCompanies(s).map((c) => c.id)).toEqual([CO_A]);
  });

  it('EXCLUDES a company the user only has billing_admin on (off the ladder)', () => {
    const s = session([{ id: CO_A, role: 'billing_admin' }], CO_A);
    expect(grantedCompanies(s)).toEqual([]);
  });

  it('EXCLUDES a company without the analytics app grant', () => {
    const s = session([{ id: CO_A, role: 'admin', grant: false }], CO_A);
    expect(grantedCompanies(s)).toEqual([]);
  });

  it('EXCLUDES a granted tenant the user holds no effective role on (fail-closed)', () => {
    const s = session([{ id: CO_A, role: 'admin' }], CO_A);
    // Drop the effective role for CO_A but keep it in tenants[] with the grant.
    (s as unknown as { effective_roles: { tenants: unknown[] } }).effective_roles.tenants = [];
    expect(grantedCompanies(s)).toEqual([]);
  });

  it('lists multiple granted companies', () => {
    const s = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'viewer' },
      ],
      null,
    );
    expect(grantedCompanies(s).map((c) => c.id).sort()).toEqual([CO_A, CO_B].sort());
  });
});

describe('resolveActiveScope — the active company', () => {
  it('single company, active_tenant set -> that company is active (S1 default)', () => {
    const scope = resolveActiveScope(session([{ id: CO_A, role: 'admin' }], CO_A));
    expect(scope.activeCompany?.id).toBe(CO_A);
    expect(scope.companies).toHaveLength(1);
  });

  it('multiple companies, active_tenant null -> no active company (must pick)', () => {
    const scope = resolveActiveScope(
      session(
        [
          { id: CO_A, role: 'admin' },
          { id: CO_B, role: 'admin' },
        ],
        null,
      ),
    );
    expect(scope.activeCompany).toBeNull();
    expect(scope.companies).toHaveLength(2);
  });

  it('active_tenant pointing at a NON-granted company -> no active company', () => {
    // Active tenant is a billing-only / non-analytics company (CO_C) not in the
    // granted set: the analytics active scope is null (list vs boundary agree).
    const s = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_C, role: 'billing_admin' },
      ],
      CO_C,
    );
    const scope = resolveActiveScope(s);
    expect(scope.activeCompany).toBeNull();
    expect(scope.companies.map((c) => c.id)).toEqual([CO_A]);
  });

  it('zero granted companies -> empty list, null active', () => {
    const scope = resolveActiveScope(session([{ id: CO_A, role: 'billing_admin' }], CO_A));
    expect(scope.companies).toEqual([]);
    expect(scope.activeCompany).toBeNull();
  });
});

describe('resolveActiveCompanyId + isSwitchableCompany', () => {
  it('resolveActiveCompanyId returns the active id, or null', () => {
    expect(resolveActiveCompanyId(session([{ id: CO_A, role: 'admin' }], CO_A))).toBe(CO_A);
    expect(
      resolveActiveCompanyId(
        session(
          [
            { id: CO_A, role: 'admin' },
            { id: CO_B, role: 'admin' },
          ],
          null,
        ),
      ),
    ).toBeNull();
  });

  it('isSwitchableCompany is true only for a granted destination', () => {
    const s = session(
      [
        { id: CO_A, role: 'admin' },
        { id: CO_B, role: 'billing_admin' },
      ],
      CO_A,
    );
    expect(isSwitchableCompany(s, CO_A)).toBe(true);
    // billing_admin -> not a destination
    expect(isSwitchableCompany(s, CO_B)).toBe(false);
    // a company the user has no relationship with at all
    expect(isSwitchableCompany(s, CO_C)).toBe(false);
  });
});
