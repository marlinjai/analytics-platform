'use client';

import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import type { Project } from '@analytics-platform/shared';

// ── Shared project state via localStorage ────────────────────────────────────

const STORAGE_KEY = 'ap_current_project';
const EVENT_NAME = 'ap-project-changed';

function getStoredProjectId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredProjectId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: id }));
}

/** Subscribe to project changes from any component. */
export function useCurrentProjectId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) cb(); };
      const onCustom = () => cb();
      window.addEventListener('storage', onStorage);
      window.addEventListener(EVENT_NAME, onCustom);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(EVENT_NAME, onCustom);
      };
    },
    getStoredProjectId,
    () => null, // server snapshot
  );
}

// ── ProjectSwitcher component ────────────────────────────────────────────────

export function ProjectSwitcher() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const currentProjectId = useCurrentProjectId();

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        const list: Project[] = data.projects ?? [];
        setProjects(list);
        setLoaded(true);
        if (list.length > 0 && !getStoredProjectId()) {
          setStoredProjectId(list[0]!.id);
        }
      })
      .catch(() => setLoaded(true));
  }, []);

  function handleSelect(id: string) {
    setStoredProjectId(id);
  }

  function openDialog() {
    setShowCreate(true);
    setName('');
    setDomain('');
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    setShowCreate(false);
    dialogRef.current?.close();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), domain: domain.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to create project');
      }
      const data = await res.json();
      setProjects((prev) => [data.project, ...prev]);
      setStoredProjectId(data.project.id);
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="flex gap-2">
      <select
        value={currentProjectId ?? ''}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <button
        onClick={openDialog}
        title="Create new project"
        className="flex-shrink-0 rounded-lg border border-gray-700 bg-gray-800 px-2.5 text-gray-400 hover:bg-gray-700 hover:text-gray-100 transition"
      >
        +
      </button>

      <dialog
        ref={dialogRef}
        onClose={closeDialog}
        className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 text-gray-100 backdrop:bg-black/60"
      >
        {showCreate && (
          <>
            <h3 className="mb-1 text-lg font-semibold">New project</h3>
            <p className="mb-5 text-sm text-gray-400">
              Add a website or app to track.
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="new-project-name" className="mb-1 block text-sm font-medium">
                  Project name
                </label>
                <input
                  id="new-project-name"
                  type="text"
                  placeholder="My Website"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="new-project-domain" className="mb-1 block text-sm font-medium">
                  Domain
                </label>
                <input
                  id="new-project-domain"
                  type="text"
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium hover:bg-gray-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </>
        )}
      </dialog>
    </div>
  );
}
