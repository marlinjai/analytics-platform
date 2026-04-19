import { NextRequest, NextResponse } from 'next/server';
import { pageSnapshotQuerySchema } from '@analytics-platform/shared';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import { verifyToolbarToken } from '@/lib/toolbar-token';
import { getDb } from '@/lib/db';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);

  // --- Auth: NextAuth session OR toolbar token ---
  let authenticatedProjectId: string | null = null;

  const session = await auth();
  if (session?.user?.id) {
    authenticatedProjectId = null; // defer to membership check below
  } else {
    const token = params.token;
    if (token) {
      const payload = await verifyToolbarToken(token);
      if (payload) {
        authenticatedProjectId = payload.pid;
      }
    }

    if (!session?.user?.id && !authenticatedProjectId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const parsed = pageSnapshotQuerySchema.safeParse({
    projectId: params.projectId,
    url: params.url,
    pageHash: params.pageHash,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { projectId, url, pageHash } = parsed.data;

  // --- Authorization ---
  if (authenticatedProjectId) {
    if (authenticatedProjectId !== projectId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    if (!(await checkProjectMembership(session!.user.id, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const db = getDb();
  const rows = await db`
    SELECT snapshot FROM page_snapshots
    WHERE project_id = ${projectId}
      AND url = ${url}
      AND page_hash = ${pageHash}
    LIMIT 1
  `;

  const row = rows[0];
  const snapshot = row ? row.snapshot : null;

  return NextResponse.json(
    { snapshot },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
