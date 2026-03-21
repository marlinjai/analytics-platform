'use client';

import { useEffect, useState, useCallback } from 'react';

interface Project {
  id: string;
  name: string;
  domain: string;
}

interface ApiKey {
  id: string;
  prefix: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export default function SettingsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);

  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyEnvironment, setNewKeyEnvironment] = useState<'live' | 'test'>('live');
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Fetch keys when selected project changes
  const fetchKeys = useCallback(async (projectId: string) => {
    if (!projectId) {
      setKeys([]);
      return;
    }
    setLoadingKeys(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/keys`);
      if (!res.ok) throw new Error('Failed to fetch keys');
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      setKeys([]);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    setRevealedKey(null);
    fetchKeys(selectedProjectId);
  }, [selectedProjectId, fetchKeys]);

  // Delete project
  async function handleDeleteProject(project: Project) {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProjectId === project.id) {
        setSelectedProjectId('');
        setKeys([]);
      }
    }
  }

  // Revoke key
  async function handleRevokeKey(keyId: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    const res = await fetch(`/api/projects/${selectedProjectId}/keys/${keyId}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      fetchKeys(selectedProjectId);
    }
  }

  // Create key
  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId || !newKeyLabel.trim()) return;
    setCreatingKey(true);
    setRevealedKey(null);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel.trim(), environment: newKeyEnvironment }),
      });
      if (!res.ok) throw new Error('Failed to create key');
      const data = await res.json();
      setRevealedKey(data.key.fullKey);
      setNewKeyLabel('');
      fetchKeys(selectedProjectId);
    } catch {
      // ignore
    } finally {
      setCreatingKey(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-2xl font-bold text-gray-100">Settings</h1>

      {/* Projects section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Projects</h2>

        {loadingProjects ? (
          <p className="text-sm text-gray-400">Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-400">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-gray-100">{project.name}</p>
                  <p className="text-xs text-gray-400">{project.domain}</p>
                </div>
                <button
                  onClick={() => handleDeleteProject(project)}
                  className="rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* API Keys section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">API Keys</h2>

        {/* Project selector */}
        <div className="mb-4">
          <label htmlFor="project-select" className="mb-1 block text-sm text-gray-400">
            Select project
          </label>
          <select
            id="project-select"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">— Choose a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {selectedProjectId && (
          <>
            {/* Key list */}
            {loadingKeys ? (
              <p className="text-sm text-gray-400">Loading keys...</p>
            ) : keys.filter((k) => !k.revoked_at).length === 0 && !showRevoked ? (
              <p className="mb-4 text-sm text-gray-400">No active API keys for this project.</p>
            ) : (
              <ul className="mb-4 divide-y divide-gray-800">
                {keys
                  .filter((k) => showRevoked || !k.revoked_at)
                  .map((key) => {
                    const isRevoked = !!key.revoked_at;
                    return (
                      <li key={key.id} className={`flex items-center justify-between py-3 ${isRevoked ? 'opacity-50' : ''}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-100">
                            {key.label}
                            {isRevoked && (
                              <span className="ml-2 rounded bg-red-400/10 px-1.5 py-0.5 text-xs text-red-400">
                                Revoked
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400">
                            {key.prefix}*** &middot; Created{' '}
                            {new Date(key.created_at).toLocaleDateString()}
                            {key.last_used_at && (
                              <> &middot; Last used {new Date(key.last_used_at).toLocaleDateString()}</>
                            )}
                          </p>
                        </div>
                        {!isRevoked && (
                          <button
                            onClick={() => handleRevokeKey(key.id)}
                            className="shrink-0 rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
            {keys.some((k) => !!k.revoked_at) && (
              <button
                onClick={() => setShowRevoked((v) => !v)}
                className="mb-4 text-xs text-gray-500 hover:text-gray-300 transition"
              >
                {showRevoked ? 'Hide revoked keys' : `Show revoked keys (${keys.filter((k) => !!k.revoked_at).length})`}
              </button>
            )}

            {/* Revealed key + integration guide */}
            {revealedKey && (
              <div className="mb-4 space-y-4">
                <div className="rounded-lg border border-yellow-600/50 bg-yellow-500/10 p-4">
                  <p className="mb-2 text-sm font-semibold text-yellow-300">
                    Copy this key now — it won&apos;t be shown again
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="block flex-1 break-all rounded bg-gray-800 px-3 py-2 text-sm text-gray-100">
                      {revealedKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(revealedKey)}
                      className="shrink-0 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600 transition"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                  <p className="mb-2 text-sm font-semibold text-gray-200">Quick setup</p>
                  <p className="mb-3 text-xs text-gray-400">
                    Add this snippet to your website&apos;s {'<head>'} or before {'</body>'}:
                  </p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
{`<script type="module">
  import { init } from 'https://analytics.lumitra.co/tracker.js';
  init({
    projectId: '${selectedProjectId}',
    endpoint: 'https://analytics.lumitra.co/api/collect',
  });
</script>`}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(`<script type="module">
  import { init } from 'https://analytics.lumitra.co/tracker.js';
  init({
    projectId: '${selectedProjectId}',
    endpoint: 'https://analytics.lumitra.co/api/collect',
  });
</script>`)}
                      className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 transition"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Create key form */}
            <form onSubmit={handleCreateKey} className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <label htmlFor="key-label" className="mb-1 block text-sm text-gray-400">
                  Label
                </label>
                <input
                  id="key-label"
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="e.g. Production"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="key-env" className="mb-1 block text-sm text-gray-400">
                  Environment
                </label>
                <select
                  id="key-env"
                  value={newKeyEnvironment}
                  onChange={(e) => setNewKeyEnvironment(e.target.value as 'live' | 'test')}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="live">Live</option>
                  <option value="test">Test</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={creatingKey || !newKeyLabel.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
              >
                {creatingKey ? 'Creating...' : 'Create key'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
