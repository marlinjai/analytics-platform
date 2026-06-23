import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

type Params = { params: Promise<{ projectId: string }> };

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

/**
 * PUT /api/projects/{id}/settings
 *
 * Auth required (owner or admin). Reachable by session cookie or account key.
 * Body: { [key: string]: boolean | string | number }
 * Upserts each key/value pair into project_settings.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  const db = getDb();

  // Upsert each key/value pair
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) {
    return NextResponse.json({ ok: true, settings: {} });
  }

  for (const [key, value] of entries) {
    const encoded = JSON.stringify(value);
    await db`
      INSERT INTO project_settings (project_id, key, value, updated_at)
      VALUES (${projectId}, ${key}, ${encoded}, now())
      ON CONFLICT (project_id, key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = now()
    `;
  }

  // Return updated settings
  const rows = await db`
    SELECT key, value FROM project_settings WHERE project_id = ${projectId}
  `;
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }

  return NextResponse.json({ ok: true, settings });
}

/**
 * GET /api/projects/{id}/settings
 *
 * Auth required — returns raw stored settings (not merged with defaults).
 * Used by the Settings UI to read current values.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const rows = await db`
    SELECT key, value FROM project_settings WHERE project_id = ${projectId}
  `;

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }

  return NextResponse.json({ settings });
}
