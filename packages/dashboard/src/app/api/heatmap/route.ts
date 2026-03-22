import { NextRequest, NextResponse } from 'next/server';
import { heatmapQuerySchema } from '@analytics-platform/shared';
import { getHeatmapData } from '@/lib/queries/heatmap';
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
    // Session auth — membership will be checked after parsing
    authenticatedProjectId = null; // defer to membership check below
  } else {
    // No session — try toolbar token
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

  const parsed = heatmapQuerySchema.safeParse({
    projectId: params.projectId,
    url: params.url,
    dateRange: { from: params.from, to: params.to },
    deviceType: params.deviceType || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { projectId, url, dateRange, deviceType } = parsed.data;

  // --- Authorization ---
  if (authenticatedProjectId) {
    // Token auth — the token's pid must match the requested projectId
    if (authenticatedProjectId !== projectId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    // Session auth — check membership
    if (!(await checkProjectMembership(session!.user.id, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const points = await getHeatmapData(projectId, url, dateRange, deviceType);

  return NextResponse.json(
    { points },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
