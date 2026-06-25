'use client';

import { useCallback, useEffect, useState } from 'react';

type Framework = 'nextjs' | 'react' | 'html';

interface Props {
  onReady: (projectId: string) => void;
}

// ---------------------------------------------------------------------------
// Step 1 — create project
// ---------------------------------------------------------------------------
interface Step1Props {
  onCreated: (projectId: string) => void;
}

function StepCreateProject({ onCreated }: Step1Props) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
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
      onCreated(data.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ob-project-name" className="mb-1 block text-sm font-medium text-gray-100">
          Project name
        </label>
        <input
          id="ob-project-name"
          type="text"
          placeholder="My Website"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          required
        />
      </div>
      <div>
        <label htmlFor="ob-project-domain" className="mb-1 block text-sm font-medium text-gray-100">
          Domain
        </label>
        <input
          id="ob-project-domain"
          type="text"
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          required
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {submitting ? 'Creating...' : 'Create project & continue'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — install tracker
// ---------------------------------------------------------------------------
const FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: 'nextjs', label: 'Next.js' },
  { id: 'react', label: 'React' },
  { id: 'html', label: 'HTML' },
];

function buildSnippet(framework: Framework, projectId: string): string {
  const base = `import { init } from 'https://analytics.lumitra.co/sdk/tracker.js';
init({
  projectId: '${projectId}',
  endpoint: 'https://analytics.lumitra.co/api/collect',
});`;

  if (framework === 'nextjs') {
    return `// app/layout.tsx (or pages/_app.tsx)
'use client';
import { useEffect } from 'react';

export default function RootLayout({ children }) {
  useEffect(() => {
    ${base}
  }, []);
  return <html><body>{children}</body></html>;
}`;
  }

  if (framework === 'react') {
    return `// In your root component (e.g. App.tsx)
import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    ${base}
  }, []);
  return <YourApp />;
}`;
  }

  // html
  return `<!-- Add before </body> -->
<script type="module">
  ${base}
</script>`;
}

interface Step2Props {
  projectId: string;
  onContinue: () => void;
}

function StepInstallTracker({ projectId, onContinue }: Step2Props) {
  const [framework, setFramework] = useState<Framework>('nextjs');
  const [copied, setCopied] = useState(false);

  const snippet = buildSnippet(framework, projectId);

  async function handleCopy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Framework tabs */}
      <div className="flex gap-2">
        {FRAMEWORKS.map((fw) => (
          <button
            key={fw.id}
            onClick={() => setFramework(fw.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              framework === fw.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {fw.label}
          </button>
        ))}
      </div>

      {/* Code block */}
      <div className="relative rounded-lg border border-gray-700 bg-gray-950">
        <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-gray-300">{snippet}</pre>
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 transition"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <button
        onClick={onContinue}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition"
      >
        I&apos;ve installed the tracker
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — waiting for first event
// ---------------------------------------------------------------------------
interface Step3Props {
  projectId: string;
  onReady: (projectId: string) => void;
}

function StepWaitingForEvent({ projectId, onReady }: Step3Props) {
  const [checking, setChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(
        `/api/stats?projectId=${projectId}&from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date().toISOString()}`
      );
      if (res.ok) {
        const data = await res.json();
        const hasData =
          data.overview?.pageviews > 0 || (data.timeseries?.length ?? 0) > 0;
        if (hasData) {
          onReady(projectId);
          return;
        }
      }
    } catch {
      // network error — ignore, will retry
    } finally {
      setChecking(false);
      setAttempts((n) => n + 1);
    }
  }, [projectId, onReady]);

  // Auto-poll every 10 seconds
  useEffect(() => {
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [check]);

  return (
    <div className="space-y-4 text-center">
      {/* Animated pulse indicator */}
      <div className="flex items-center justify-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500" />
        </span>
        <span className="text-sm text-gray-300">
          {checking ? 'Checking for events…' : 'Waiting for first event…'}
        </span>
      </div>

      <p className="text-xs text-gray-500">
        Visit your website with the tracker installed and this page will
        automatically advance. Checked {attempts} {attempts === 1 ? 'time' : 'times'} so far.
      </p>

      <button
        onClick={check}
        disabled={checking}
        className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition"
      >
        {checking ? 'Checking…' : 'Check now'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Onboarding component
// ---------------------------------------------------------------------------
type Step = 1 | 2 | 3;

export function Onboarding({ onReady }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [projectId, setProjectId] = useState<string | null>(null);

  const STEPS = [
    { n: 1, label: 'Create project' },
    { n: 2, label: 'Install tracker' },
    { n: 3, label: 'First event' },
  ];

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-8">
        {/* Step indicator */}
        <ol className="mb-8 flex items-center gap-0">
          {STEPS.map((s, idx) => {
            const done = step > s.n;
            const active = step === s.n;
            return (
              <li key={s.n} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
                      done
                        ? 'bg-green-500 text-white'
                        : active
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-500'
                    }`}
                  >
                    {done ? '✓' : s.n}
                  </span>
                  <span
                    className={`text-[10px] font-medium whitespace-nowrap ${
                      active ? 'text-gray-200' : done ? 'text-green-400' : 'text-gray-600'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`mx-1 mb-5 h-px flex-1 transition ${done ? 'bg-green-500' : 'bg-gray-800'}`}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* Step content */}
        {step === 1 && (
          <>
            <h2 className="mb-2 text-xl font-semibold text-gray-100">Create your first project</h2>
            <p className="mb-6 text-sm text-gray-400">
              A project represents a website or app you want to track.
            </p>
            <StepCreateProject
              onCreated={(id) => {
                setProjectId(id);
                setStep(2);
              }}
            />
          </>
        )}

        {step === 2 && projectId && (
          <>
            <h2 className="mb-2 text-xl font-semibold text-gray-100">Install the tracker</h2>
            <p className="mb-6 text-sm text-gray-400">
              Add the snippet to your website to start collecting events.
            </p>
            <StepInstallTracker
              projectId={projectId}
              onContinue={() => setStep(3)}
            />
          </>
        )}

        {step === 3 && projectId && (
          <>
            <h2 className="mb-2 text-xl font-semibold text-gray-100">Waiting for first event</h2>
            <p className="mb-6 text-sm text-gray-400">
              This page polls automatically. Visit your website to trigger an event.
            </p>
            <StepWaitingForEvent projectId={projectId} onReady={onReady} />
          </>
        )}
      </div>
    </div>
  );
}
