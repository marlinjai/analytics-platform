import { NextRequest, NextResponse } from 'next/server';
import { statsQuerySchema } from '@analytics-platform/shared';
import { getRageClicks } from '@/lib/queries/advanced';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import { verifyToolbarToken } from '@/lib/toolbar-token';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }
  }

  const parsed = statsQuerySchema.safeParse({
    projectId: params.projectId,
    dateRange: { from: params.from, to: params.to },
    interval: params.interval ?? 'day',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400, headers: corsHeaders });
  }

  const { projectId, dateRange } = parsed.data;

  // --- Authorization ---
  if (authenticatedProjectId) {
    if (authenticatedProjectId !== projectId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }
  } else {
    if (!(await checkProjectMembership(session!.user.id, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }
  }

  const environment = request.nextUrl.searchParams.get('environment') ?? 'production';
  const data = await getRageClicks(projectId, dateRange, environment);
  return NextResponse.json({ data }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
