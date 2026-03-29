import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Default SDK feature-toggle settings
const DEFAULT_SETTINGS: Record<string, boolean> = {
  replay: false,
  heatmap: true,
  scrollDepth: true,
};

type Params = { params: Promise<{ projectId: string }> };

function corsHeaders(origin?: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

/**
 * GET /api/projects/{id}/config
 *
 * Public endpoint — no auth required.
 * Returns the merged (defaults + overrides) SDK configuration for a project.
 * The tracker SDK fetches this on init to apply remote feature toggles.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  if (!projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }

  const db = getDb();

  // Verify the project exists
  const [project] = await db`SELECT id FROM projects WHERE id = ${projectId}`;
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Load stored settings
  const rows = await db`
    SELECT key, value FROM project_settings WHERE project_id = ${projectId}
  `;

  // Merge defaults with stored overrides (stored values are JSON-encoded booleans/strings)
  const config: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }

  // Load active feature flags
  const flagRows = await db`
    SELECT key, enabled, rollout_percentage, variants
    FROM feature_flags
    WHERE project_id = ${projectId} AND enabled = true
  `;
  const flags = flagRows.map((f) => ({
    key: f.key,
    enabled: f.enabled,
    rolloutPercentage: f.rollout_percentage,
    variants: f.variants ?? null,
  }));

  // Load running experiments
  const experimentRows = await db`
    SELECT id, key, variants
    FROM experiments
    WHERE project_id = ${projectId} AND status = 'running'
  `;
  const experiments = experimentRows.map((e) => ({
    id: e.id,
    key: e.key,
    variants: e.variants,
  }));

  const cors = corsHeaders(_request.headers.get('origin'));
  return NextResponse.json({ config, flags, experiments }, {
    headers: {
      ...cors,
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}
