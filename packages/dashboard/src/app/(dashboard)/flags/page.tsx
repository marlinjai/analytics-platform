'use client';

import { Suspense, useEffect, useState } from 'react';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';
import { CodeSnippet } from '@/components/ui/CodeSnippet';

// ── Types ──────────────────────────────────────────────────────────────────

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rollout_percentage: number;
  variants: { key: string; weight: number }[] | null;
  created_at: string;
}

// ── Toggle Switch ──────────────────────────────────────────────────────────

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
        enabled ? 'bg-green-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// ── Slug Helper ────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Create Flag Dialog ─────────────────────────────────────────────────────

function CreateFlagForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: (flag: FeatureFlag) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyManual, setKeyManual] = useState(false);
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rollout, setRollout] = useState(100);
  const [useVariants, setUseVariants] = useState(false);
  const [variants, setVariants] = useState<{ key: string; weight: number }[]>([
    { key: 'control', weight: 50 },
    { key: 'treatment', weight: 50 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdFlag, setCreatedFlag] = useState<FeatureFlag | null>(null);

  // Auto-generate key from name
  useEffect(() => {
    if (!keyManual) {
      setKey(slugify(name));
    }
  }, [name, keyManual]);

  function addVariant() {
    setVariants((v) => [...v, { key: '', weight: 0 }]);
  }

  function removeVariant(i: number) {
    setVariants((v) => v.filter((_, idx) => idx !== i));
  }

  function updateVariant(i: number, patch: Partial<{ key: string; weight: number }>) {
    setVariants((v) =>
      v.map((item, idx) => (idx === i ? { ...item, ...patch } : item)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        key,
        name,
        description,
        enabled,
        rollout_percentage: rollout,
      };
      if (useVariants && variants.length >= 2) {
        body.variants = variants;
      }
      const res = await fetch(`/api/projects/${projectId}/flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create flag');
        return;
      }
      setCreatedFlag(data.flag ?? data);
      onCreated(data.flag ?? data);
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  const variantWeightSum = variants.reduce((s, v) => s + v.weight, 0);

  if (createdFlag) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Flag Created</h3>
          <button
            onClick={onCancel}
            className="text-xs text-gray-400 hover:text-gray-200 transition"
          >
            Close
          </button>
        </div>
        <p className="text-sm text-gray-300">
          <span className="font-medium text-white">{createdFlag.name}</span> ({createdFlag.key}) is ready to use.
        </p>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <p className="mb-2 text-sm font-semibold text-gray-200">Integration snippet</p>
          <p className="mb-3 text-xs text-gray-400">
            Use this in your application code to check the flag:
          </p>
          <CodeSnippet
            tabs={[
              {
                label: 'React',
                language: 'jsx',
                code: `import { useLumitraFlag } from '@marlinjai/analytics-react';\n\nfunction MyComponent() {\n  const enabled = useLumitraFlag('${createdFlag.key}');\n\n  if (!enabled) return null;\n\n  return <>{/* New feature */}</>;\n}`,
              },
              {
                label: 'Vanilla JS',
                language: 'js',
                code: `import { getTracker } from '@marlinjai/analytics-tracker';\n\nconst tracker = getTracker();\nawait tracker.ready();\nconst enabled = tracker.getFlag('${createdFlag.key}');\n\nif (enabled) {\n  // new feature code\n}`,
              },
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">New Feature Flag</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-gray-200 transition"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      {/* Name */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-400">Name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. New Checkout Flow"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Key */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-400">Key</label>
        <input
          required
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setKeyManual(true);
          }}
          placeholder="new-checkout-flow"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          Auto-generated from name. Edit to customize.
        </p>
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-400">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this flag control?"
          rows={2}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none resize-none"
        />
      </div>

      {/* Enabled + Rollout */}
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <ToggleSwitch enabled={enabled} onChange={() => setEnabled((v) => !v)} />
          <span className="text-sm text-gray-300">{enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-400">Rollout %</label>
          <input
            type="range"
            min={0}
            max={100}
            value={rollout}
            onChange={(e) => setRollout(Number(e.target.value))}
            className="w-32 accent-blue-600"
          />
          <span className="w-10 text-right text-sm font-medium text-gray-200">{rollout}%</span>
        </div>
      </div>

      {/* Multivariate variants */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => setUseVariants((v) => !v)}
            className="text-xs text-blue-400 hover:text-blue-300 transition"
          >
            {useVariants ? 'Remove variants (simple on/off)' : '+ Add multivariate variants'}
          </button>
        </div>
        {useVariants && (
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  required
                  value={v.key}
                  onChange={(e) => updateVariant(i, { key: e.target.value })}
                  placeholder="variant-key"
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                />
                <div className="flex items-center gap-1">
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
                {variants.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    className="shrink-0 text-gray-600 hover:text-red-400 transition"
                    aria-label="Remove variant"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {/* Weight bar */}
            <div className="h-2 overflow-hidden rounded-full bg-gray-800 flex">
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
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addVariant}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add variant
              </button>
              <span className={`text-xs ${variantWeightSum === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
                Total: {variantWeightSum}%
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {saving ? 'Creating...' : 'Create flag'}
        </button>
      </div>
    </form>
  );
}

// ── Flag Row ───────────────────────────────────────────────────────────────

function FlagRow({
  flag,
  projectId,
  onToggle,
  onDelete,
}: {
  flag: FeatureFlag;
  projectId: string;
  onToggle: (flag: FeatureFlag) => void;
  onDelete: (flagId: string) => void;
}) {
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/flags/${flag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !flag.enabled }),
      });
      if (res.ok) {
        onToggle({ ...flag, enabled: !flag.enabled });
      }
    } catch {
      // silently ignore
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete flag "${flag.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/flags/${flag.id}`, {
        method: 'DELETE',
      });
      if (res.ok || res.status === 204) {
        onDelete(flag.id);
      }
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-800/50 px-4 py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-100">{flag.name}</p>
          <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">{flag.key}</code>
        </div>
        {flag.description && (
          <p className="mt-0.5 text-xs text-gray-500 truncate">{flag.description}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Rollout {flag.rollout_percentage}%
          {flag.variants && flag.variants.length > 0 && (
            <> &middot; {flag.variants.length} variants</>
          )}
          &middot; Created {new Date(flag.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <ToggleSwitch
          enabled={flag.enabled}
          onChange={handleToggle}
          disabled={toggling}
        />
        <button
          onClick={handleDelete}
          className="rounded px-3 py-1 text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 transition"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function FlagsPage() {
  return (
    <Suspense>
      <FlagsPageInner />
    </Suspense>
  );
}

function FlagsPageInner() {
  const projectId = useCurrentProjectId();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function fetchFlags(pid: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${pid}/flags`);
      const data = await res.json();
      setFlags(data.flags ?? []);
    } catch {
      setFlags([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!projectId) return;
    fetchFlags(projectId);
  }, [projectId]);

  function handleToggle(updated: FeatureFlag) {
    setFlags((fs) => fs.map((f) => (f.id === updated.id ? updated : f)));
  }

  function handleDelete(flagId: string) {
    setFlags((fs) => fs.filter((f) => f.id !== flagId));
  }

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Feature Flags</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage feature rollouts, kill switches, and multivariate flags.
          </p>
        </div>
        {projectId && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
          >
            {showCreate ? 'Cancel' : 'New flag'}
          </button>
        )}
      </div>

      {!projectId ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
          <p className="text-sm text-gray-500">Select a project to manage feature flags.</p>
        </div>
      ) : (
        <>
          {showCreate && (
            <CreateFlagForm
              projectId={projectId}
              onCreated={(flag) => {
                setFlags((fs) => [flag, ...fs]);
              }}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-800" />
              ))}
            </div>
          ) : flags.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-700 bg-gray-900">
              <p className="text-sm text-gray-500">No feature flags yet.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs text-blue-400 hover:text-blue-300 transition"
              >
                Create your first flag
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900">
              {flags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  projectId={projectId}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
