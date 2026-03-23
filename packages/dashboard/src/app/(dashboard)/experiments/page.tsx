'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ProjectSwitcher } from '@/components/layout/ProjectSwitcher';

// ── Types ──────────────────────────────────────────────────────────────────

interface Variant {
  key: string;
  weight: number;
  description?: string;
}

interface Goal {
  name: string;
  goal_type: 'pageview' | 'custom_event' | 'click';
  target: string;
  is_primary?: boolean;
}

interface Experiment {
  id: string;
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

type StatusFilter = 'all' | 'draft' | 'running' | 'paused' | 'completed';

// ── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Experiment['status'] }) {
  const colors: Record<Experiment['status'], string> = {
    draft: 'bg-gray-500/10 text-gray-400',
    running: 'bg-green-500/10 text-green-400',
    paused: 'bg-yellow-500/10 text-yellow-400',
    completed: 'bg-blue-500/10 text-blue-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status}
    </span>
  );
}

// ── Slug Helper ────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Create Experiment Form ─────────────────────────────────────────────────

function CreateExperimentForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);

  // Step 1: Basics
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyManual, setKeyManual] = useState(false);
  const [description, setDescription] = useState('');
  const [hypothesis, setHypothesis] = useState('');

  // Step 2: Variants
  const [variants, setVariants] = useState<Variant[]>([
    { key: 'control', weight: 50, description: 'Original version' },
    { key: 'treatment', weight: 50, description: '' },
  ]);

  // Step 3: Goals
  const [goals, setGoals] = useState<Goal[]>([
    { name: 'Primary conversion', goal_type: 'pageview', target: '', is_primary: true },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate key from name
  useEffect(() => {
    if (!keyManual) {
      setKey(slugify(name));
    }
  }, [name, keyManual]);

  function addVariant() {
    setVariants((v) => [...v, { key: '', weight: 0, description: '' }]);
  }

  function removeVariant(i: number) {
    if (i === 0) return; // Can't remove control
    setVariants((v) => v.filter((_, idx) => idx !== i));
  }

  function updateVariant(i: number, patch: Partial<Variant>) {
    setVariants((v) => v.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }

  function addGoal() {
    setGoals((g) => [...g, { name: '', goal_type: 'custom_event', target: '', is_primary: false }]);
  }

  function removeGoal(i: number) {
    setGoals((g) => g.filter((_, idx) => idx !== i));
  }

  function updateGoal(i: number, patch: Partial<Goal>) {
    setGoals((g) => g.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }

  function setPrimaryGoal(i: number) {
    setGoals((g) => g.map((item, idx) => ({ ...item, is_primary: idx === i })));
  }

  async function handleSubmit() {
    setError('');
    setSaving(true);
    try {
      // Create experiment
      const res = await fetch(`/api/projects/${projectId}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          name,
          description,
          hypothesis,
          variants,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create experiment');
        setSaving(false);
        return;
      }

      const experimentId = data.experiment?.id ?? data.id;

      // Create goals
      for (const goal of goals) {
        if (!goal.name || !goal.target) continue;
        await fetch(`/api/projects/${projectId}/experiments/${experimentId}/goals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(goal),
        });
      }

      onCreated();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  const variantWeightSum = variants.reduce((s, v) => s + v.weight, 0);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">New Experiment</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-gray-200 transition"
        >
          Cancel
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {['Basics', 'Variants', 'Goals', 'Review'].map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i + 1)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              step === i + 1
                ? 'bg-blue-600 text-white'
                : step > i + 1
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'bg-gray-800 text-gray-500'
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      {/* Step 1: Basics */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Green CTA Button Test"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Key</label>
            <input
              required
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyManual(true);
              }}
              placeholder="green-cta-button-test"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">Auto-generated from name. Edit to customize.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you testing?"
              rows={2}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Hypothesis</label>
            <textarea
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="e.g. Changing the CTA color to green will increase signup conversions by 10%"
              rows={2}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none resize-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!name || !key}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
            >
              Next: Variants
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Variants */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            Define the variants for your experiment. The first variant is always the control.
            Weights must sum to 100%.
          </p>

          {variants.map((v, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-300">
                  {i === 0 ? 'Control' : `Treatment ${i}`}
                </span>
                {i > 0 && (
                  <button
                    onClick={() => removeVariant(i)}
                    className="text-xs text-gray-600 hover:text-red-400 transition"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  required
                  value={v.key}
                  onChange={(e) => updateVariant(i, { key: e.target.value })}
                  placeholder="variant-key"
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={v.weight}
                    onChange={(e) => updateVariant(i, { weight: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                  <span className="text-xs text-gray-500">%</span>
                </div>
              </div>
              <input
                value={v.description ?? ''}
                onChange={(e) => updateVariant(i, { description: e.target.value })}
                placeholder="Description (optional)"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ))}

          {/* Traffic split bar */}
          <div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-800 flex">
              {variants.map((v, i) => (
                <div
                  key={i}
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${variantWeightSum > 0 ? (v.weight / variantWeightSum) * 100 : 0}%`,
                    backgroundColor: ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'][i % 6],
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex flex-wrap gap-3">
                {variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'][i % 6],
                      }}
                    />
                    {v.key || `Variant ${i}`}: {v.weight}%
                  </div>
                ))}
              </div>
              <span className={`text-xs font-medium ${variantWeightSum === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
                Total: {variantWeightSum}%
              </span>
            </div>
          </div>

          <button
            onClick={addVariant}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add treatment variant
          </button>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 transition"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={variantWeightSum !== 100}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
            >
              Next: Goals
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Goals */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            Define what you are measuring. Mark one goal as primary for statistical significance calculation.
          </p>

          {goals.map((g, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPrimaryGoal(i)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                      g.is_primary
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {g.is_primary ? 'Primary' : 'Set as primary'}
                  </button>
                </div>
                {goals.length > 1 && (
                  <button
                    onClick={() => removeGoal(i)}
                    className="text-xs text-gray-600 hover:text-red-400 transition"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={g.name}
                  onChange={(e) => updateGoal(i, { name: e.target.value })}
                  placeholder="Goal name"
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                />
                <select
                  value={g.goal_type}
                  onChange={(e) => updateGoal(i, { goal_type: e.target.value as Goal['goal_type'] })}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-xs text-gray-300 focus:outline-none"
                >
                  <option value="pageview">Pageview</option>
                  <option value="custom_event">Custom Event</option>
                  <option value="click">Click</option>
                </select>
              </div>
              <input
                value={g.target}
                onChange={(e) => updateGoal(i, { target: e.target.value })}
                placeholder={
                  g.goal_type === 'pageview'
                    ? 'URL pattern (e.g. /thank-you*)'
                    : g.goal_type === 'custom_event'
                      ? 'Event name (e.g. signup_completed)'
                      : 'CSS selector (e.g. .cta-button)'
                }
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ))}

          <button
            onClick={addGoal}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add goal
          </button>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 transition"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
            >
              Next: Review
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-400">Name</p>
              <p className="text-sm text-white">{name}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400">Key</p>
              <p className="font-mono text-sm text-gray-300">{key}</p>
            </div>
            {hypothesis && (
              <div>
                <p className="text-xs font-medium text-gray-400">Hypothesis</p>
                <p className="text-sm text-gray-300">{hypothesis}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Variants</p>
              <div className="space-y-1">
                {variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'][i % 6],
                      }}
                    />
                    <span className="font-mono text-gray-300">{v.key}</span>
                    <span className="text-gray-500">({v.weight}%)</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Goals</p>
              <div className="space-y-1">
                {goals.map((g, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-300">{g.name || 'Unnamed goal'}</span>
                    <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">
                      {g.goal_type}
                    </span>
                    {g.is_primary && (
                      <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-xs text-blue-400">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(3)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 transition"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {saving ? 'Creating...' : 'Create Experiment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Experiment Card ────────────────────────────────────────────────────────

function ExperimentCard({ experiment }: { experiment: Experiment }) {
  return (
    <Link
      href={`/experiments/${experiment.id}`}
      className="block rounded-xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">{experiment.name}</h3>
            <StatusBadge status={experiment.status} />
          </div>
          <code className="mt-0.5 block text-xs text-gray-500">{experiment.key}</code>
          {experiment.hypothesis && (
            <p className="mt-1 text-xs text-gray-400 line-clamp-1">{experiment.hypothesis}</p>
          )}
        </div>
        {experiment.winner_variant && (
          <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
            Winner: {experiment.winner_variant}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
        <span>{experiment.variants.length} variants</span>
        <span>Created {new Date(experiment.created_at).toLocaleDateString()}</span>
        {experiment.started_at && (
          <span>Started {new Date(experiment.started_at).toLocaleDateString()}</span>
        )}
      </div>

      {/* Variant split bar */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800 flex">
        {experiment.variants.map((v, i) => (
          <div
            key={i}
            className="h-full"
            style={{
              width: `${v.weight}%`,
              backgroundColor: ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'][i % 6],
            }}
          />
        ))}
      </div>
    </Link>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ExperimentsPage() {
  return (
    <Suspense>
      <ExperimentsPageInner />
    </Suspense>
  );
}

function ExperimentsPageInner() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  async function fetchExperiments(pid: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${pid}/experiments`);
      const data = await res.json();
      setExperiments(data.experiments ?? []);
    } catch {
      setExperiments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!projectId) return;
    fetchExperiments(projectId);
  }, [projectId]);

  const filteredExperiments =
    statusFilter === 'all'
      ? experiments
      : experiments.filter((e) => e.status === statusFilter);

  const statusTabs: { label: string; value: StatusFilter; count: number }[] = [
    { label: 'All', value: 'all', count: experiments.length },
    { label: 'Draft', value: 'draft', count: experiments.filter((e) => e.status === 'draft').length },
    { label: 'Running', value: 'running', count: experiments.filter((e) => e.status === 'running').length },
    { label: 'Paused', value: 'paused', count: experiments.filter((e) => e.status === 'paused').length },
    { label: 'Completed', value: 'completed', count: experiments.filter((e) => e.status === 'completed').length },
  ];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <ProjectSwitcher currentProjectId={projectId} onSelect={setProjectId} />
        </div>
      </div>

      {/* Heading */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Experiments</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create and manage A/B tests with statistical analysis and per-variant heatmaps.
          </p>
        </div>
        {projectId && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
          >
            {showCreate ? 'Cancel' : 'New experiment'}
          </button>
        )}
      </div>

      {!projectId ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
          <p className="text-sm text-gray-500">Select a project to manage experiments.</p>
        </div>
      ) : (
        <>
          {showCreate && (
            <CreateExperimentForm
              projectId={projectId}
              onCreated={() => {
                setShowCreate(false);
                fetchExperiments(projectId);
              }}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {/* Status filter tabs */}
          {!showCreate && experiments.length > 0 && (
            <div className="flex flex-wrap gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
              {statusTabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    statusFilter === tab.value
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-1.5 text-gray-500">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-800" />
              ))}
            </div>
          ) : filteredExperiments.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-700 bg-gray-900">
              <p className="text-sm text-gray-500">
                {experiments.length === 0
                  ? 'No experiments yet.'
                  : `No ${statusFilter} experiments.`}
              </p>
              {experiments.length === 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
                >
                  Create your first experiment
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredExperiments.map((exp) => (
                <ExperimentCard key={exp.id} experiment={exp} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
