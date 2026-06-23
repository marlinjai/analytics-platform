import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { authenticateRequest, corsHeaders } from '@/lib/auth-api';

type Params = { params: Promise<{ projectId: string }> };

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

const funnelStepSchema = z.union([
  z.object({ type: z.literal('pageview'), url: z.string().min(1) }),
  z.object({ type: z.literal('custom'), eventName: z.string().min(1) }),
]);

const createFunnelSchema = z.object({
  name: z.string().min(1).max(128),
  steps: z.array(funnelStepSchema).min(2).max(10),
});

export async function GET(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const db = getDb();
  const funnels = await db`
    SELECT id, name, steps, created_at
    FROM funnels
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ funnels });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await request.json();
  const parsed = createFunnelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { name, steps } = parsed.data;
  const db = getDb();

  const [funnel] = await db`
    INSERT INTO funnels (project_id, name, steps)
    VALUES (${projectId}, ${name}, ${db.json(steps)})
    RETURNING *
  `;

  return NextResponse.json({ funnel }, { status: 201 });
}
