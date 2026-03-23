import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getClickHouse } from '@/lib/clickhouse';
import { checkProjectMembership } from '@/lib/auth-check';
import { analyzeExperiment, type VariantData } from '@/lib/experiment-stats';

type Params = { params: Promise<{ projectId: string; experimentId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, experimentId } = await params;

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();

  // Load experiment
  const [experiment] = await db`
    SELECT * FROM experiments
    WHERE id = ${experimentId} AND project_id = ${projectId}
  `;
  if (!experiment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Load goals (use primary goal, or first goal if no primary)
  const goals = await db`
    SELECT * FROM experiment_goals
    WHERE experiment_id = ${experimentId}
    ORDER BY is_primary DESC, created_at ASC
  `;

  if (goals.length === 0) {
    return NextResponse.json(
      { error: 'Experiment has no goals defined' },
      { status: 400 },
    );
  }

  // Safe: we already checked goals.length > 0 above
  const primaryGoal = goals[0]!;

  // Query ClickHouse for per-variant session counts
  const ch = getClickHouse();

  const sessionsResult = await ch.query({
    query: `
      SELECT
        variant,
        uniqExact(session_id) AS unique_sessions
      FROM analytics.events
      WHERE project_id = {projectId: UUID}
        AND experiment_id = {experimentId: String}
        AND variant != ''
      GROUP BY variant
    `,
    query_params: {
      projectId,
      experimentId,
    },
    format: 'JSONEachRow',
  });

  const sessionRows = await sessionsResult.json<{
    variant: string;
    unique_sessions: string;
  }>();

  // Build a map of variant -> unique sessions
  const sessionsByVariant: Record<string, number> = {};
  for (const row of sessionRows) {
    sessionsByVariant[row.variant] = Number(row.unique_sessions);
  }

  // Query conversions based on goal type
  let conversionsByVariant: Record<string, number> = {};

  if (primaryGoal.goal_type === 'pageview') {
    // Count unique sessions that had a pageview matching the target URL pattern
    const convResult = await ch.query({
      query: `
        SELECT
          variant,
          uniqExact(session_id) AS converted_sessions
        FROM analytics.events
        WHERE project_id = {projectId: UUID}
          AND experiment_id = {experimentId: String}
          AND variant != ''
          AND type = 'pageview'
          AND url LIKE {target: String}
        GROUP BY variant
      `,
      query_params: {
        projectId,
        experimentId,
        target: primaryGoal.target,
      },
      format: 'JSONEachRow',
    });

    const convRows = await convResult.json<{
      variant: string;
      converted_sessions: string;
    }>();
    for (const row of convRows) {
      conversionsByVariant[row.variant] = Number(row.converted_sessions);
    }
  } else if (primaryGoal.goal_type === 'custom_event') {
    // Count unique sessions that triggered the custom event
    const convResult = await ch.query({
      query: `
        SELECT
          variant,
          uniqExact(session_id) AS converted_sessions
        FROM analytics.events
        WHERE project_id = {projectId: UUID}
          AND experiment_id = {experimentId: String}
          AND variant != ''
          AND type = 'custom'
          AND event_name = {target: String}
        GROUP BY variant
      `,
      query_params: {
        projectId,
        experimentId,
        target: primaryGoal.target,
      },
      format: 'JSONEachRow',
    });

    const convRows = await convResult.json<{
      variant: string;
      converted_sessions: string;
    }>();
    for (const row of convRows) {
      conversionsByVariant[row.variant] = Number(row.converted_sessions);
    }
  } else if (primaryGoal.goal_type === 'click') {
    // Count unique sessions that clicked the target selector
    const convResult = await ch.query({
      query: `
        SELECT
          variant,
          uniqExact(session_id) AS converted_sessions
        FROM analytics.events
        WHERE project_id = {projectId: UUID}
          AND experiment_id = {experimentId: String}
          AND variant != ''
          AND type = 'click'
          AND selector = {target: String}
        GROUP BY variant
      `,
      query_params: {
        projectId,
        experimentId,
        target: primaryGoal.target,
      },
      format: 'JSONEachRow',
    });

    const convRows = await convResult.json<{
      variant: string;
      converted_sessions: string;
    }>();
    for (const row of convRows) {
      conversionsByVariant[row.variant] = Number(row.converted_sessions);
    }
  }

  // Build variant data array in the same order as the experiment's variants config
  const experimentVariants = experiment.variants as Array<{ key: string }>;
  const variantData: VariantData[] = experimentVariants.map((v) => ({
    key: v.key,
    sessions: sessionsByVariant[v.key] ?? 0,
    conversions: conversionsByVariant[v.key] ?? 0,
  }));

  // Run Bayesian analysis
  const results = analyzeExperiment(experimentId, variantData);

  return NextResponse.json({
    results,
    goal: {
      id: primaryGoal.id,
      name: primaryGoal.name,
      goal_type: primaryGoal.goal_type,
      target: primaryGoal.target,
    },
  });
}
