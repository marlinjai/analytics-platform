'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CodeSnippet } from '@/components/ui/CodeSnippet';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────

interface Variant {
  key: string;
  weight: number;
  description?: string;
}

interface Experiment {
  id: string;
  project_id: string;
  key: string;
  name: string;
  description?: string;
  hypothesis?: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: Variant[];
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  winner_variant: string | null;
}

interface Goal {
  id: string;
  name: string;
  goal_type: 'pageview' | 'custom_event' | 'click';
  target: string;
  is_primary: boolean;
}

interface VariantResult {
  key: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  liftVsControl: number | null;
  probabilityToBeBest: number;
  credibleInterval: [number, number];
}

interface ExperimentResults {
  experimentId: string;
  status: 'needs_data' | 'not_significant' | 'significant';
  variants: VariantResult[];
  totalSessions: number;
  minimumSampleReached: boolean;
  recommendation: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const VARIANT_COLORS = ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

// ── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Experiment['status'] }) {
  const colors: Record<Experiment['status'], string> = {
    draft: 'bg-gray-500/10 text-gray-400',
    running: 'bg-green-500/10 text-green-400',
    paused: 'bg-yellow-500/10 text-yellow-400',
    completed: 'bg-blue-500/10 text-blue-400',
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${colors[status]}`}>
      {status}
    </span>
  );
}

// ── Hero Results Card ──────────────────────────────────────────────────────

function HeroResultCard({
  results,
  experiment,
}: {
  results: ExperimentResults;
  experiment: Experiment;
}) {
  // Find the best variant (not control)
  const bestVariant = results.variants
    .filter((v) => v.key !== 'control')
    .sort((a, b) => b.probabilityToBeBest - a.probabilityToBeBest)[0];

  const controlVariant = results.variants.find((v) => v.key === 'control');
  const totalSessions = results.variants.reduce((s, v) => s + v.sessions, 0);
  const needsMoreData = results.variants.some(
    (v) => v.sessions < 100,
  );

  // Determine the state of the hero card
  let bgClass = 'border-gray-700 bg-gray-900';
  let headlineColor = 'text-gray-300';

  if (experiment.status === 'completed' && experiment.winner_variant) {
    bgClass = 'border-green-700/50 bg-green-900/10';
    headlineColor = 'text-green-400';
  } else if (results.status === 'significant' && bestVariant) {
    bgClass = 'border-green-700/50 bg-green-900/10';
    headlineColor = 'text-green-400';
  } else if (needsMoreData) {
    bgClass = 'border-gray-700 bg-gray-900';
    headlineColor = 'text-gray-400';
  } else {
    bgClass = 'border-yellow-700/50 bg-yellow-900/10';
    headlineColor = 'text-yellow-400';
  }

  let headline = '';
  if (experiment.status === 'completed' && experiment.winner_variant) {
    headline = `${experiment.winner_variant} was declared the winner`;
  } else if (needsMoreData) {
    const minNeeded = 100 * results.variants.length;
    const remaining = Math.max(0, minNeeded - totalSessions);
    headline = `Not enough data yet — need ~${remaining.toLocaleString()} more sessions`;
  } else if (bestVariant && results.status === 'significant') {
    headline = `${bestVariant.key} has a ${(bestVariant.probabilityToBeBest * 100).toFixed(1)}% probability of beating Control`;
  } else if (bestVariant) {
    headline = `${bestVariant.key} is leading at ${(bestVariant.probabilityToBeBest * 100).toFixed(1)}% — not yet significant`;
  } else {
    headline = 'Collecting data...';
  }

  return (
    <div className={`rounded-xl border p-6 ${bgClass}`}>
      <p className={`text-2xl font-bold ${headlineColor}`}>{headline}</p>
      {results.recommendation && (
        <p className="mt-2 text-sm text-gray-400">{results.recommendation}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-6 text-sm text-gray-400">
        <div>
          <span className="text-xs text-gray-500">Total sessions</span>
          <p className="font-semibold text-white">{totalSessions.toLocaleString()}</p>
        </div>
        {controlVariant && (
          <div>
            <span className="text-xs text-gray-500">Control conv. rate</span>
            <p className="font-semibold text-white">{(controlVariant.conversionRate * 100).toFixed(1)}%</p>
          </div>
        )}
        {bestVariant && (
          <div>
            <span className="text-xs text-gray-500">Best variant conv. rate</span>
            <p className="font-semibold text-white">{(bestVariant.conversionRate * 100).toFixed(1)}%</p>
          </div>
        )}
        {bestVariant && bestVariant.liftVsControl !== null && (
          <div>
            <span className="text-xs text-gray-500">Lift vs control</span>
            <p className={`font-semibold ${bestVariant.liftVsControl > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {bestVariant.liftVsControl > 0 ? '+' : ''}{bestVariant.liftVsControl.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Variants Results Table ─────────────────────────────────────────────────

function VariantsTable({
  results,
  winnerVariant,
}: {
  results: ExperimentResults;
  winnerVariant: string | null;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs text-gray-400">
              <th className="px-4 py-3 text-left font-medium">Variant</th>
              <th className="px-4 py-3 text-right font-medium">Sessions</th>
              <th className="px-4 py-3 text-right font-medium">Conversions</th>
              <th className="px-4 py-3 text-right font-medium">Conv. Rate</th>
              <th className="px-4 py-3 text-right font-medium">Lift vs Control</th>
              <th className="px-4 py-3 text-right font-medium">P(Win)</th>
            </tr>
          </thead>
          <tbody>
            {results.variants.map((v, i) => {
              const isWinner = winnerVariant === v.key;
              return (
                <tr
                  key={v.key}
                  className={`border-b border-gray-800/50 last:border-0 ${isWinner ? 'bg-green-900/10' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
                      />
                      <span className="font-medium text-gray-100">{v.key}</span>
                      {isWinner && (
                        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                          Winner
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{v.sessions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{v.conversions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-100">{(v.conversionRate * 100).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right">
                    {v.liftVsControl !== null ? (
                      <span className={v.liftVsControl > 0 ? 'text-green-400' : v.liftVsControl < 0 ? 'text-red-400' : 'text-gray-400'}>
                        {v.liftVsControl > 0 ? '+' : ''}{v.liftVsControl.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-500">&mdash;</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${v.probabilityToBeBest * 100 > 90 ? 'text-green-400' : v.probabilityToBeBest * 100 > 50 ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {(v.probabilityToBeBest * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Conversion Rate Timeline Chart ─────────────────────────────────────────

interface TimelineTooltipPayload {
  dataKey?: string;
  value?: number;
  color?: string;
}

interface TimelineTooltipProps {
  active?: boolean;
  payload?: TimelineTooltipPayload[];
  label?: string;
}

function TimelineTooltip({ active, payload, label }: TimelineTooltipProps) {
  if (!active || !payload?.length) return null;
  const date = label
    ? new Date(label).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-gray-400">{date}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="text-xs" style={{ color: p.color }}>
          <span className="font-semibold">{String(p.dataKey)}:</span>{' '}
          {(p.value ?? 0).toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

function ConversionTimeline({
  timeseries,
  variants,
}: {
  timeseries: ExperimentResults['timeseries'];
  variants: string[];
}) {
  if (timeseries.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">Not enough daily data to show timeline yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-300">Conversion Rate Over Time</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={timeseries} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#374151"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) =>
              new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            }
          />
          <YAxis
            stroke="#374151"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip content={<TimelineTooltip />} />
          <Legend
            verticalAlign="top"
            height={30}
            formatter={(value: string) => (
              <span className="text-xs text-gray-400">{value}</span>
            )}
          />
          {variants.map((variant, i) => (
            <Line
              key={variant}
              type="monotone"
              dataKey={variant}
              stroke={VARIANT_COLORS[i % VARIANT_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sample Size Indicator ──────────────────────────────────────────────────

function SampleSizeIndicator({
  results,
}: {
  results: ExperimentResults;
}) {
  const minPerVariant = 100;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-3 text-sm font-medium text-gray-300">Sample Size Progress</h3>
      <div className="space-y-3">
        {results.variants.map((v, i) => {
          const progress = Math.min(100, (v.sessions / minPerVariant) * 100);
          const isComplete = v.sessions >= minPerVariant;
          return (
            <div key={v.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
                  />
                  <span className="text-gray-300">{v.key}</span>
                </div>
                <span className={isComplete ? 'text-green-400' : 'text-gray-500'}>
                  {v.sessions.toLocaleString()} / {minPerVariant.toLocaleString()}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: isComplete
                      ? '#22c55e'
                      : VARIANT_COLORS[i % VARIANT_COLORS.length],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {results.variants.some((v) => v.sessions < minPerVariant) && (
        <p className="mt-3 text-xs text-yellow-400">
          Minimum {minPerVariant} sessions per variant recommended for reliable results.
        </p>
      )}
    </div>
  );
}

// ── Goals Section ──────────────────────────────────────────────────────────

function GoalsSection({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-3 text-sm font-medium text-gray-300">Conversion Goals</h3>
      <div className="space-y-2">
        {goals.map((goal) => (
          <div key={goal.id} className="flex items-center justify-between border-b border-gray-800/50 py-2 last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-100">{goal.name}</span>
              {goal.is_primary && (
                <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-xs text-blue-400">
                  Primary
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                {goal.goal_type}
              </span>
              <code className="text-xs text-gray-500">{goal.target}</code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Declare Winner Dialog ──────────────────────────────────────────────────

function DeclareWinnerDialog({
  variants,
  results,
  onConfirm,
  onCancel,
}: {
  variants: Variant[];
  results: ExperimentResults;
  onConfirm: (variantKey: string) => void;
  onCancel: () => void;
}) {
  // Pre-select the variant with highest probability
  const bestVariantKey =
    results.variants
      .sort((a, b) => b.probabilityToBeBest - a.probabilityToBeBest)[0]?.variant ?? variants[0]?.key ?? '';
  const [selected, setSelected] = useState(bestVariantKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">Stop Experiment & Declare Winner</h3>
        <p className="mt-2 text-sm text-gray-400">
          This will stop the experiment and lock in the winning variant. This action cannot be undone.
        </p>

        <div className="mt-4 space-y-2">
          {variants.map((v, i) => {
            const result = results.variants.find((r) => r.key === v.key);
            return (
              <label
                key={v.key}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                  selected === v.key
                    ? 'border-blue-500 bg-blue-500/5'
                    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="winner"
                  value={v.key}
                  checked={selected === v.key}
                  onChange={() => setSelected(v.key)}
                  className="accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
                    />
                    <span className="font-medium text-gray-100">{v.key}</span>
                  </div>
                  {result && (
                    <p className="mt-0.5 text-xs text-gray-400">
                      {(result.conversionRate * 100).toFixed(1)}% conv. rate &middot;{' '}
                      {(result.probabilityToBeBest * 100).toFixed(1)}% P(win)
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
          >
            Declare Winner
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Variant Heatmap Comparison ─────────────────────────────────────────────

function VariantHeatmapLink({
  experiment,
}: {
  experiment: Experiment;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-2 text-sm font-medium text-gray-300">Per-Variant Heatmaps</h3>
      <p className="mb-3 text-xs text-gray-400">
        Compare click heatmaps between variants to see how user behavior differs.
      </p>
      <div className="flex flex-wrap gap-2">
        {experiment.variants.map((v, i) => (
          <Link
            key={v.key}
            href={`/heatmap?experiment_id=${experiment.id}&variant=${v.key}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition"
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
            />
            Heatmap: {v.key}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Integration Code Section ────────────────────────────────────────────────

function IntegrationCodeSection({ experiment }: { experiment: Experiment }) {
  const [open, setOpen] = useState(true);

  const variantCases = experiment.variants
    .map((v, i) => {
      if (i === 0) return `    case '${v.key}':\n      return <>{/* Control */}</>;`;
      return `    case '${v.key}':\n      return <>{/* Variant ${i} */}</>;`;
    })
    .join('\n');

  const reactCode = `import { useLumitraVariant } from '@marlinjai/analytics-react';

function MyComponent() {
  const variant = useLumitraVariant('${experiment.key}');

  switch (variant) {
${variantCases}
    default:
      return <>{/* Fallback */}</>;
  }
}`;

  const vanillaCode = `import { getTracker } from '@marlinjai/analytics-tracker';

const tracker = getTracker();
await tracker.ready();
const variant = tracker.getVariant('${experiment.key}');

switch (variant) {
${experiment.variants.map((v) => `  case '${v.key}':\n    // render ${v.key}\n    break;`).join('\n')}
}`;

  const curlCode = `# Get experiment variant assignment for a visitor
curl -X POST https://analytics.lumitra.co/api/collect \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "experiment_exposure",
    "experiment_key": "${experiment.key}",
    "visitor_id": "<visitor-id>"
  }'`;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h3 className="text-sm font-medium text-gray-300">Integration Code</h3>
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-400">
            Use this code in your application to render the correct variant for each user.
          </p>
          <CodeSnippet
            tabs={[
              { label: 'React', language: 'jsx', code: reactCode },
              { label: 'Vanilla JS', language: 'js', code: vanillaCode },
              { label: 'cURL', language: 'bash', code: curlCode },
            ]}
          />
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ExperimentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const experimentId = params.experimentId as string;

  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [showDeclareWinner, setShowDeclareWinner] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const projectId = useCurrentProjectId();

  const fetchExperimentByProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/experiments/${experimentId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setExperiment(data.experiment ?? data);

        // Fetch goals
        try {
          const goalsRes = await fetch(
            `/api/projects/${projectId}/experiments/${experimentId}/goals`,
          );
          if (goalsRes.ok) {
            const goalsData = await goalsRes.json();
            setGoals(goalsData.goals ?? []);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, experimentId]);

  useEffect(() => {
    fetchExperimentByProject();
  }, [fetchExperimentByProject]);

  // Fetch results when experiment is running or completed
  useEffect(() => {
    if (!experiment || !projectId) return;
    if (experiment.status === 'draft') return;

    setLoadingResults(true);
    fetch(`/api/projects/${projectId}/experiments/${experimentId}/results`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        return r.json();
      })
      .then((data) => setResults(data.results ?? data))
      .catch(() => {
        // Set empty results if API not available yet
        setResults(null);
      })
      .finally(() => setLoadingResults(false));
  }, [experiment, projectId, experimentId]);

  // Actions
  async function handleStart() {
    if (!projectId) return;
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/experiments/${experimentId}/start`,
        { method: 'POST' },
      );
      if (res.ok) {
        const data = await res.json();
        setExperiment(data.experiment ?? { ...experiment!, status: 'running', started_at: new Date().toISOString() });
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePause() {
    if (!projectId) return;
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/experiments/${experimentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'paused' }),
        },
      );
      if (res.ok) {
        setExperiment((prev) => prev ? { ...prev, status: 'paused' } : prev);
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume() {
    if (!projectId) return;
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/experiments/${experimentId}/start`,
        { method: 'POST' },
      );
      if (res.ok) {
        setExperiment((prev) => prev ? { ...prev, status: 'running' } : prev);
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeclareWinner(variantKey: string) {
    if (!projectId) return;
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/experiments/${experimentId}/stop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ winnerVariant: variantKey }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setExperiment(
          data.experiment ?? {
            ...experiment!,
            status: 'completed' as const,
            ended_at: new Date().toISOString(),
            winner_variant: variantKey,
          },
        );
        setShowDeclareWinner(false);
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!projectId || !experiment) return;
    if (!confirm(`Delete experiment "${experiment.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/experiments/${experimentId}`,
        { method: 'DELETE' },
      );
      if (res.ok || res.status === 204) {
        router.push('/experiments');
      }
    } catch {
      // ignore
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="h-32 animate-pulse rounded-xl bg-gray-800" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-800" />
      </div>
    );
  }

  if (!experiment) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">Experiment not found.</p>
        <Link href="/experiments" className="text-xs text-blue-400 hover:text-blue-300 transition">
          Back to experiments
        </Link>
      </div>
    );
  }

  const variantKeys = experiment.variants.map((v) => v.key);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/experiments"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 transition"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Experiments
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{experiment.name}</h1>
            <StatusBadge status={experiment.status} />
          </div>
          <code className="mt-1 block text-sm text-gray-500">{experiment.key}</code>
          {experiment.hypothesis && (
            <p className="mt-2 text-sm text-gray-400">
              <span className="font-medium text-gray-300">Hypothesis:</span> {experiment.hypothesis}
            </p>
          )}
          {experiment.description && (
            <p className="mt-1 text-sm text-gray-500">{experiment.description}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {experiment.status === 'draft' && (
            <>
              <button
                onClick={handleStart}
                disabled={actionLoading}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition"
              >
                {actionLoading ? 'Starting...' : 'Start Experiment'}
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg border border-red-700/50 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/40 transition"
              >
                Delete
              </button>
            </>
          )}
          {experiment.status === 'running' && (
            <>
              <button
                onClick={handlePause}
                disabled={actionLoading}
                className="rounded-lg border border-yellow-700/50 px-4 py-2 text-sm font-medium text-yellow-400 hover:bg-yellow-950/40 disabled:opacity-50 transition"
              >
                Pause
              </button>
              <button
                onClick={() => setShowDeclareWinner(true)}
                disabled={actionLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
              >
                Stop & Declare Winner
              </button>
            </>
          )}
          {experiment.status === 'paused' && (
            <>
              <button
                onClick={handleResume}
                disabled={actionLoading}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition"
              >
                Resume
              </button>
              <button
                onClick={() => setShowDeclareWinner(true)}
                disabled={actionLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
              >
                Stop & Declare Winner
              </button>
            </>
          )}
        </div>
      </div>

      {/* Results — only shown for running, paused, or completed experiments */}
      {experiment.status !== 'draft' && (
        <>
          {loadingResults ? (
            <div className="space-y-4">
              <div className="h-32 animate-pulse rounded-xl bg-gray-800" />
              <div className="h-48 animate-pulse rounded-xl bg-gray-800" />
              <div className="h-64 animate-pulse rounded-xl bg-gray-800" />
            </div>
          ) : results ? (
            <>
              {/* Hero Card */}
              <HeroResultCard results={results} experiment={experiment} />

              {/* Variants Table */}
              <VariantsTable results={results} winnerVariant={experiment.winner_variant} />

              {/* Conversion Timeline */}
              <ConversionTimeline timeseries={[]} variants={variantKeys} />

              {/* Sample Size + Goals side by side */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SampleSizeIndicator results={results} />
                <GoalsSection goals={goals} />
              </div>

              {/* Per-variant heatmap links */}
              <VariantHeatmapLink experiment={experiment} />

              {/* Integration Code — also shown for running experiments */}
              {(experiment.status === 'running') && (
                <IntegrationCodeSection experiment={experiment} />
              )}
            </>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
              <div className="text-center">
                <p className="text-sm text-gray-500">
                  {experiment.status === 'running'
                    ? 'Collecting data... Results will appear once sessions are recorded.'
                    : 'No results available.'}
                </p>
                {experiment.status === 'running' && (
                  <p className="mt-2 text-xs text-gray-600">
                    Results update automatically as new events come in.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Draft state — show setup summary */}
      {experiment.status === 'draft' && (
        <>
          {/* Variant configuration */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h3 className="mb-3 text-sm font-medium text-gray-300">Variant Configuration</h3>
            <div className="space-y-2">
              {experiment.variants.map((v, i) => (
                <div key={v.key} className="flex items-center justify-between border-b border-gray-800/50 py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length] }}
                    />
                    <span className="font-mono text-sm text-gray-100">{v.key}</span>
                  </div>
                  <span className="text-sm text-gray-400">{v.weight}%</span>
                </div>
              ))}
            </div>
            {/* Traffic split bar */}
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800 flex">
              {experiment.variants.map((v, i) => (
                <div
                  key={v.key}
                  className="h-full"
                  style={{
                    width: `${v.weight}%`,
                    backgroundColor: VARIANT_COLORS[i % VARIANT_COLORS.length],
                  }}
                />
              ))}
            </div>
          </div>

          {/* Goals */}
          <GoalsSection goals={goals} />

          {/* Integration Code */}
          <IntegrationCodeSection experiment={experiment} />
        </>
      )}

      {/* Declare Winner Modal */}
      {showDeclareWinner && results && (
        <DeclareWinnerDialog
          variants={experiment.variants}
          results={results}
          onConfirm={handleDeclareWinner}
          onCancel={() => setShowDeclareWinner(false)}
        />
      )}
    </div>
  );
}
