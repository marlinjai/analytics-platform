import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth-api';
import { getDb } from '@/lib/db';
import { randomBytes } from 'crypto';

type Params = { params: Promise<{ projectId: string }> };

// GET — List all test links for a project
export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const links = await db`
    SELECT id, code, label, variant, language, target_url, auto_consent, active, created_at
    FROM test_links
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ links });
}

// POST — Create a new test link
export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const { label, variant, language, targetUrl, autoConsent } = body;

  if (!label || !variant || !targetUrl) {
    return NextResponse.json(
      { error: 'label, variant, and targetUrl are required' },
      { status: 400 },
    );
  }

  // Generate a short, readable code
  const code = `${variant.slice(0, 4)}-${(language || 'de').slice(0, 2)}-${randomBytes(3).toString('hex')}`;

  const db = getDb();
  const [link] = await db`
    INSERT INTO test_links (project_id, code, label, variant, language, target_url, auto_consent)
    VALUES (${projectId}, ${code}, ${label}, ${variant}, ${language || 'de'}, ${targetUrl}, ${autoConsent !== false})
    RETURNING id, code, label, variant, language, target_url, auto_consent, active, created_at
  `;

  return NextResponse.json({ link }, { status: 201 });
}

// DELETE — Delete a test link
export async function DELETE(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { searchParams } = new URL(request.url);
  const linkId = searchParams.get('id');

  if (!linkId) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const db = getDb();
  await db`DELETE FROM test_links WHERE id = ${linkId} AND project_id = ${projectId}`;

  return NextResponse.json({ ok: true });
}
