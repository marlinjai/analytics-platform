/**
 * project-access.ts — the per-project authorization decision derived purely from
 * the auth-brain verify payload's effective_roles (Decision 2 consolidation).
 *
 * These tests assert the decision against the PAYLOAD SHAPE, not a mocked FGA
 * response. One test builds a payload through the REAL published
 * `sessionVerifyResponseSchema` from @marlinjai/auth-brain-shared and feeds its
 * `effective_roles` into the decision, so a field-name drift between what
 * analytics reads and what auth-brain actually sends fails here (the exact class
 * of bug behind the workspace-grant 403: a mock the real service never sent).
 */
import { describe, it, expect } from 'vitest';
import { sessionVerifyResponseSchema, type EffectiveRoles } from '@marlinjai/auth-brain-shared';
import { hasCompanyAccess } from '@/lib/project-access';

const CO = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const OTHER_CO = '019f0000-0000-7000-8000-000000000000';

function tenantRoles(tenants: EffectiveRoles['tenants']): EffectiveRoles {
  return { tenant_groups: [], tenants, workspaces: [] };
}


// ===========================================================================
// hasCompanyAccess — the S2 decision plane (a project belongs to a COMPANY).
// ===========================================================================

describe('hasCompanyAccess — role adequacy on the owner>admin>member>viewer ladder', () => {
  it('owner satisfies every tier', () => {
    const er = tenantRoles([{ id: CO, role: 'owner', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.member')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(true);
  });

  it('admin satisfies viewer, member and admin', () => {
    const er = tenantRoles([{ id: CO, role: 'admin', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.member')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(true);
  });

  it('member satisfies viewer and member but NOT admin', () => {
    const er = tenantRoles([{ id: CO, role: 'member', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.member')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(false);
  });

  it('viewer satisfies viewer only', () => {
    const er = tenantRoles([{ id: CO, role: 'viewer', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(true);
    expect(hasCompanyAccess(er, CO, 'tenant.member')).toBe(false);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(false);
  });
});

describe('hasCompanyAccess — billing_admin is OFF the general ladder', () => {
  it('DENIES billing_admin at viewer, member AND admin tiers', () => {
    const er = tenantRoles([{ id: CO, role: 'billing_admin', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(er, CO, 'tenant.member')).toBe(false);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(false);
  });
});

describe('hasCompanyAccess — inherited parity with direct', () => {
  it('an INHERITED company admin gates exactly like a DIRECT admin (source ignored)', () => {
    const inherited = tenantRoles([{ id: CO, role: 'admin', source: 'inherited' }]);
    const direct = tenantRoles([{ id: CO, role: 'admin', source: 'direct' }]);
    expect(hasCompanyAccess(inherited, CO, 'tenant.admin')).toBe(true);
    expect(hasCompanyAccess(direct, CO, 'tenant.admin')).toBe(true);
  });

  it('an INHERITED viewer grants read just like a DIRECT viewer', () => {
    const inherited = tenantRoles([{ id: CO, role: 'viewer', source: 'inherited' }]);
    expect(hasCompanyAccess(inherited, CO, 'tenant.viewer')).toBe(true);
  });
});

describe('hasCompanyAccess — fail closed / no widening', () => {
  it('denies on a null/absent effective_roles payload', () => {
    expect(hasCompanyAccess(null, CO, 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(undefined, CO, 'tenant.viewer')).toBe(false);
  });

  it('denies on an empty/absent company id (unknown/NULL company_id)', () => {
    const er = tenantRoles([{ id: CO, role: 'admin', source: 'direct' }]);
    expect(hasCompanyAccess(er, '', 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(er, null, 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(er, undefined, 'tenant.viewer')).toBe(false);
  });

  it('NO cross-company read: a role on company A never grants access to company B', () => {
    const er = tenantRoles([{ id: OTHER_CO, role: 'admin', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(false);
  });

  it('denies an unrecognized role string rather than silently granting', () => {
    const er = tenantRoles([{ id: CO, role: 'superuser', source: 'direct' }]);
    expect(hasCompanyAccess(er, CO, 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(er, CO, 'tenant.admin')).toBe(false);
  });
});

describe('hasCompanyAccess — against the REAL published verify schema', () => {
  // Build a schema-valid SessionVerifyResponse whose company (tenant) role is
  // parametrized, then feed its effective_roles.tenants into the decision.
  // Parsing through the published Zod schema guarantees the shape this module
  // reads matches what auth-brain actually emits.
  function buildCompanyPayload(tenantRole: string) {
    const now = '2026-07-28T00:00:00.000Z';
    const raw = {
      user: {
        id: 'user-1',
        email: 'u@example.com',
        email_verified: true,
        name: 'U',
        given_name: null,
        family_name: null,
        picture: null,
        locale: null,
        zoneinfo: null,
        mfa_enabled: false,
        mfa_enrolled_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
      session: { id: 'sess-1', created_at: now, last_seen_at: now, expires_at: now },
      tenants: [
        {
          id: CO,
          group_id: 'group-1',
          name: 'Lola Stories',
          slug: 'lola-stories',
          legal_name: null,
          vat_id: null,
          billing_address: null,
          stripe_customer_id: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          role: tenantRole,
          app_grants: ['analytics'],
        },
      ],
      workspaces: [],
      active_tenant: null,
      active_workspace: null,
      effective_roles: {
        tenant_groups: [],
        tenants: [{ id: CO, role: tenantRole, source: 'inherited' }],
        workspaces: [],
      },
    };
    // Throws if our fixture drifts from the real published schema.
    return sessionVerifyResponseSchema.parse(raw);
  }

  it('grants admin/member/viewer when the parsed payload carries company admin', () => {
    const payload = buildCompanyPayload('admin');
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.admin')).toBe(true);
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.member')).toBe(true);
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.viewer')).toBe(true);
  });

  it('grants only read when the parsed payload carries company viewer', () => {
    const payload = buildCompanyPayload('viewer');
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.viewer')).toBe(true);
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.member')).toBe(false);
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.admin')).toBe(false);
  });

  it('denies billing_admin at every tier against the parsed payload', () => {
    const payload = buildCompanyPayload('billing_admin');
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.viewer')).toBe(false);
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.member')).toBe(false);
    expect(hasCompanyAccess(payload.effective_roles, CO, 'tenant.admin')).toBe(false);
  });

  it('denies a company absent from the parsed payload', () => {
    const payload = buildCompanyPayload('admin');
    expect(hasCompanyAccess(payload.effective_roles, OTHER_CO, 'tenant.viewer')).toBe(false);
  });
});
