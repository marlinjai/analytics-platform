'use client';

import { Suspense, useEffect, useState } from 'react';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import type { FunnelStep } from '@/lib/queries/funnels';

// ── Types ──────────────────────────────────────────────────────────────────

interface Funnel {
  id: string;
  name: string;
  steps: FunnelStep[];
  created_at: string;
}

interface FunnelStepResult {
  stepIndex: number;
  label: string;
  sessions: number;
  conversionRate: number;
  dropoffRate: number;
}

interface FunnelWithResults extends Funnel {
  results: FunnelStepResult[];
  loading: boolean;
}

// ── Funnel Visualization ───────────────────────────────────────────────────

function FunnelVisualization({ results }: { results: FunnelStepResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-gray-500">No data yet for this date range.</p>;
  }

  const maxSessions = results[0]?.sessions ?? 1;

  return (
    <div className="mt-4 space-y-3">
      {results.map((step, i) => {
        const barWidth = maxSessions > 0 ? (step.sessions / maxSessions) * 100 : 0;
        return (
          <div key={step.stepIndex}>
            <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
              <span className="max-w-xs truncate font-medium text-gray-300">
                {i + 1}. {step.label}
              </span>
              <span className="shrink-0">
                {step.sessions.toLocaleString()} sessions ({step.conversionRate}%)
              </span>
            </div>
            <div className="h-7 overflow-hidden rounded bg-gray-800">
              <div
                className="flex h-full items-center px-2 transition-all duration-700"
                style={{
                  width: `${barWidth}%`,
                  minWidth: barWidth > 0 ? '2rem' : 0,
                  backgroundColor: i === 0 ? '#3b82f6' : '#6366f1',
                }}
              >
                {barWidth > 12 && (
                  <span className="text-xs font-medium text-white">
                    {step.sessions.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            {i < results.length - 1 && step.dropoffRate > 0 && (
              <p className="mt-1 text-xs text-red-400">
                -{step.dropoffRate}% drop-off to next step
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Funnel Card ────────────────────────────────────────────────────────────

function FunnelCard({
  funnel,
  from,
  to,
  onDelete,
  onExpand,
}: {
  funnel: FunnelWithResults;
  from: string;
  to: string;
  onDelete: () => void;
  onExpand: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && funnel.results.length === 0 && !funnel.loading) {
      onExpand(funnel.id);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">{funnel.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {funnel.steps.length} steps · created {new Date(funnel.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleExpand}
            className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
          >
            {expanded ? 'Hide' : 'View'}
          </button>
          <button
            onClick={onDelete}
            className="rounded px-3 py-1 text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 transition"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        funnel.loading ? (
          <div className="mt-4 space-y-2">
            {funnel.steps.map((_, i) => (
              <div key={i} className="h-7 animate-pulse rounded bg-gray-800" />
            ))}
          </div>
        ) : (
          <FunnelVisualization results={funnel.results} />
        )
      )}
    </div>
  );
}

// ── Create Funnel Form ─────────────────────────────────────────────────────

type NewStep = { type: 'pageview'; url: string } | { type: 'custom'; eventName: string };

function CreateFunnelForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<NewStep[]>([
    { type: 'pageview', url: '' },
    { type: 'pageview', url: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function addStep() {
    setSteps((s) => [...s, { type: 'pageview', url: '' }]);
  }

  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, patch: Partial<NewStep>) {
    setSteps((s) =>
      s.map((step, idx) => {
        if (idx !== i) return step;
        if (patch.type && patch.type !== step.type) {
          return patch.type === 'pageview'
            ? { type: 'pageview', url: '' }
            : { type: 'custom', eventName: '' };
        }
        return { ...step, ...patch } as NewStep;
      })
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/funnels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, steps }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create funnel');
        return;
      }
      setName('');
      setSteps([{ type: 'pageview', url: '' }, { type: 'pageview', url: '' }]);
      onCreated();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-700 bg-gray-900 p-5 space-y-4">
      <h3 className="font-semibold text-white">New Funnel</h3>

      {error && (
        <p className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-400">Funnel name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Signup flow"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label className="mb-1 block text-xs font-medium text-gray-400">Steps (in order)</label>
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-xs text-gray-600">{i + 1}</span>
            <select
              value={step.type}
              onChange={(e) => updateStep(i, { type: e.target.value as 'pageview' | 'custom' })}
              className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-xs text-gray-300 focus:outline-none"
            >
              <option value="pageview">Pageview</option>
              <option value="custom">Custom event</option>
            </select>
            {step.type === 'pageview' ? (
              <input
                required
                value={step.url}
                onChange={(e) => updateStep(i, { url: e.target.value })}
                placeholder="/pricing"
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
            ) : (
              <input
                required
                value={(step as { type: 'custom'; eventName: string }).eventName}
                onChange={(e) => updateStep(i, { eventName: e.target.value })}
                placeholder="signup_click"
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
            )}
            {steps.length > 2 && (
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="shrink-0 text-gray-600 hover:text-red-400 transition"
                aria-label="Remove step"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {steps.length < 10 && (
          <button
            type="button"
            onClick={addStep}
            className="mt-1 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add step
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {saving ? 'Creating…' : 'Create funnel'}
        </button>
      </div>
    </form>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function FunnelsPage() {
  return <Suspense><FunnelsPageInner /></Suspense>;
}

function FunnelsPageInner() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [funnels, setFunnels] = useState<FunnelWithResults[]>([]);
  const [loadingFunnels, setLoadingFunnels] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function fetchFunnels(pid: string) {
    setLoadingFunnels(true);
    try {
      const res = await fetch(`/api/projects/${pid}/funnels`);
      const data = await res.json();
      const list: Funnel[] = data.funnels ?? [];
      setFunnels(list.map((f) => ({ ...f, results: [], loading: false })));
    } catch {
      setFunnels([]);
    } finally {
      setLoadingFunnels(false);
    }
  }

  useEffect(() => {
    if (!projectId) return;
    fetchFunnels(projectId);
  }, [projectId]);

  // When user opens a funnel, fetch results
  async function fetchResults(funnelId: string) {
    if (!projectId) return;
    setFunnels((fs) =>
      fs.map((f) => (f.id === funnelId ? { ...f, loading: true } : f))
    );
    try {
      const res = await fetch(
        `/api/projects/${projectId}/funnels/${funnelId}?from=${from}&to=${to}`
      );
      const data = await res.json();
      setFunnels((fs) =>
        fs.map((f) =>
          f.id === funnelId ? { ...f, results: data.results ?? [], loading: false } : f
        )
      );
    } catch {
      setFunnels((fs) =>
        fs.map((f) => (f.id === funnelId ? { ...f, loading: false } : f))
      );
    }
  }

  async function deleteFunnel(funnelId: string) {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/funnels/${funnelId}`, { method: 'DELETE' });
    setFunnels((fs) => fs.filter((f) => f.id !== funnelId));
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <ProjectSwitcher currentProjectId={projectId} onSelect={setProjectId} />
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {/* Heading */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Funnels</h1>
          <p className="mt-1 text-sm text-gray-400">
            Track multi-step conversion journeys and identify where users drop off.
          </p>
        </div>
        {projectId && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
          >
            {showCreate ? 'Cancel' : 'New funnel'}
          </button>
        )}
      </div>

      {!projectId ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
          <p className="text-sm text-gray-500">Select a project to manage funnels.</p>
        </div>
      ) : (
        <>
          {showCreate && (
            <CreateFunnelForm
              projectId={projectId}
              onCreated={() => {
                setShowCreate(false);
                fetchFunnels(projectId);
              }}
            />
          )}

          {loadingFunnels ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-800" />
              ))}
            </div>
          ) : funnels.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-700 bg-gray-900">
              <p className="text-sm text-gray-500">No funnels yet.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs text-blue-400 hover:text-blue-300 transition"
              >
                Create your first funnel
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {funnels.map((funnel) => (
                <FunnelCard
                  key={funnel.id}
                  funnel={funnel}
                  from={from}
                  to={to}
                  onDelete={() => deleteFunnel(funnel.id)}
                  onExpand={fetchResults}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
