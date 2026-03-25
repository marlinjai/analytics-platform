'use client';

import { useEffect, useState } from 'react';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';

interface TestLink {
  id: string;
  code: string;
  label: string;
  variant: string;
  language: string;
  target_url: string;
  auto_consent: boolean;
  active: boolean;
  created_at: string;
}

const VARIANT_OPTIONS = [
  { value: 'expanded', label: 'Expanded (v2)' },
  { value: 'condensed', label: 'Condensed (v2)' },
  { value: 'screens', label: 'Screens (Classic)' },
  { value: 'voice-chat', label: 'Voice Chat' },
];

const LANGUAGE_OPTIONS = [
  { value: 'de', label: 'German' },
  { value: 'en', label: 'English' },
];

export default function TestLinksPage() {
  const projectId = useCurrentProjectId();
  const [links, setLinks] = useState<TestLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState('');
  const [variant, setVariant] = useState('expanded');
  const [language, setLanguage] = useState('de');
  const [targetUrl, setTargetUrl] = useState('https://app.lolastories.com');

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/test-links`)
      .then((r) => r.json())
      .then((d) => setLinks(d.links || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !label.trim()) return;
    setCreating(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/test-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, variant, language, targetUrl }),
      });
      const data = await res.json();
      if (data.link) {
        setLinks((prev) => [data.link, ...prev]);
        setLabel('');
        setShowForm(false);
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!projectId || !confirm('Delete this test link?')) return;
    await fetch(`/api/projects/${projectId}/test-links?id=${id}`, { method: 'DELETE' });
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  const getFullUrl = (link: TestLink) => {
    const base = link.target_url.replace(/\/$/, '');
    return `${base}/join/${link.code}`;
  };

  const copyToClipboard = (link: TestLink) => {
    navigator.clipboard.writeText(getFullUrl(link));
    setCopied(link.id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!projectId) {
    return (
      <div className="p-8 text-gray-400">
        Select a project to manage test links.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Test Links</h1>
          <p className="mt-1 text-sm text-gray-400">
            Generate invite links for beta testers. Each link pre-configures the onboarding flow
            and language, and enables full session replay tracking.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Create Link
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-8 rounded-xl border border-gray-700 bg-gray-800/50 p-6"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-300">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Beta Group A — Parents with toddlers"
                required
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Onboarding Flow
              </label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              >
                {VARIANT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-300">Target App URL</label>
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://app.lolastories.com"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !label.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Link'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 py-16 text-center">
          <p className="text-gray-400">No test links yet. Create one to start inviting beta testers.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-4 rounded-xl border border-gray-700 bg-gray-800/50 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{link.label}</span>
                  <span className="rounded-full bg-blue-900/50 px-2 py-0.5 text-xs font-medium text-blue-400">
                    {VARIANT_OPTIONS.find((o) => o.value === link.variant)?.label || link.variant}
                  </span>
                  <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300">
                    {link.language.toUpperCase()}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-sm text-gray-400">
                  {getFullUrl(link)}
                </div>
              </div>
              <button
                onClick={() => copyToClipboard(link)}
                className="shrink-0 rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                {copied === link.id ? 'Copied!' : 'Copy Link'}
              </button>
              <button
                onClick={() => handleDelete(link.id)}
                className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-red-900/30 hover:text-red-400"
                title="Delete"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
