'use client';

import { useState } from 'react';

interface Props {
  projectId: string;
}

export function NoData({ projectId }: Props) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateKey() {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Default', environment: 'live' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to generate API key');
      }

      const data = await res.json();
      setApiKey(data.key?.key ?? data.key ?? data.apiKey ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  }

  const snippet = `<script src="https://unpkg.com/@marlinjai/analytics-tracker"></script>
<script>
  AnalyticsTracker.init({
    projectId: '${projectId}',
    apiKey: '${apiKey ?? 'YOUR_API_KEY'}',
    endpoint: '${typeof window !== 'undefined' ? window.location.origin : ''}/api/collect',
  });
</script>`;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-8">
        <h2 className="mb-2 text-xl font-semibold text-gray-100">
          Waiting for first event
        </h2>
        <p className="mb-6 text-sm text-gray-400">
          Add the tracker snippet to your website to start collecting analytics
          data.
        </p>

        {!apiKey && (
          <div className="mb-6">
            <button
              onClick={generateKey}
              disabled={generating}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate API key'}
            </button>
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          </div>
        )}

        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">
              Integration snippet
            </span>
            <button
              onClick={() => navigator.clipboard?.writeText(snippet)}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Copy
            </button>
          </div>
          <pre className="overflow-x-auto text-xs leading-relaxed text-gray-300">
            <code>{snippet}</code>
          </pre>
        </div>

        {apiKey && (
          <p className="mt-4 text-xs text-gray-400">
            Your API key:{' '}
            <code className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-200">
              {apiKey}
            </code>
          </p>
        )}
      </div>
    </div>
  );
}
