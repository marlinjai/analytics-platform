import { NextRequest, NextResponse } from 'next/server';
import { createProjectSchema } from '@analytics-platform/shared';
import { authenticateAccountRequest, corsHeaders } from '@/lib/auth-api';
import { hasCompanyAccess } from '@/lib/project-access';
import { resolveActiveCompanyId } from '@/lib/scope';
import { getDb } from '@/lib/db';

type ProjectRow = { id: string; company_id: string | null; [k: string]: unknown };

export async function GET(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const domain = request.nextUrl.searchParams.get('domain');

  // A project belongs to a company (migration 018). Access is company
  // membership: load every project that has a company, then keep the ones this
  // caller can read. The project count is small on a self-hosted instance.
  const candidates: ProjectRow[] = domain
    ? await db<ProjectRow[]>`
        SELECT * FROM projects
        WHERE company_id IS NOT NULL AND domain = ${domain}
        ORDER BY created_at DESC
      `
    : await db<ProjectRow[]>`
        SELECT * FROM projects
        WHERE company_id IS NOT NULL
        ORDER BY created_at DESC
      `;

  // Decision plane depends on the principal:
  //   - session: the list is a FILTER that must agree with the BOUNDARY, so it
  //     is scoped to the ACTIVE company only (not "every company the user can
  //     read"). Otherwise the switcher would offer projects the boundary then
  //     404s. A null active scope yields an empty list — nothing is in scope.
  //     The active scope is a SESSION concept; a machine caller has none (below).
  //   - service-account key (machine): its scoped COMPANY is its boundary, which
  //     is the machine equivalent of an active scope. Filter to that company and
  //     apply the same role check. Pure payload, no FGA, no per-item round trip.
  let projects: ProjectRow[];
  if (authResult.principal === 'session') {
    const activeCompanyId = resolveActiveCompanyId(authResult.session);
    projects = activeCompanyId
      ? candidates.filter(
          (p) =>
            p.company_id === activeCompanyId &&
            hasCompanyAccess(authResult.session.effective_roles, p.company_id, 'tenant.viewer'),
        )
      : [];
  } else {
    projects = candidates.filter(
      (p) =>
        p.company_id === authResult.companyId &&
        hasCompanyAccess(authResult.effectiveRoles, p.company_id, 'tenant.viewer'),
    );
  }

  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateAccountRequest(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { name, domain, allowedOrigins, companyId } = parsed.data;

  // Project creation is a tenant.admin action. The target company comes from the
  // request, but is NEVER trusted on its own — we confirm the caller actually
  // holds tenant.admin on it before creating the project:
  //   - session: check the verified payload's company roles (no FGA).
  //   - service-account key (CLI): same check against ITS payload, and the target
  //     must be the company the key is scoped to. A key cannot create a project in
  //     a company it was not issued for, even if its principal holds admin there.
  let authorized: boolean;
  if (authResult.principal === 'session') {
    authorized = hasCompanyAccess(authResult.session.effective_roles, companyId, 'tenant.admin');
  } else {
    authorized =
      companyId === authResult.companyId &&
      hasCompanyAccess(authResult.effectiveRoles, companyId, 'tenant.admin');
  }
  if (!authorized) {
    return NextResponse.json(
      { error: 'You do not have admin access to the target company, or it does not exist.' },
      { status: 403 },
    );
  }

  const db = getDb();
  const [project] = await db`
    INSERT INTO projects (name, domain, allowed_origins, company_id)
    VALUES (${name}, ${domain}, ${allowedOrigins}, ${companyId})
    RETURNING *
  `;

  return NextResponse.json({ project }, { status: 201 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
