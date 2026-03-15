# Phase 5: Polish & Reliability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add error boundaries, empty states, settings page, and E2E integration tests to make the dashboard production-ready.

**Architecture:** Four independent workstreams that can be implemented in parallel. All work is in the dashboard package except E2E tests which span the full stack.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, vitest, ClickHouse, PostgreSQL

---

## Task 1: Error Boundary Pages

**Files:**
- Create: `packages/dashboard/src/app/global-error.tsx`
- Create: `packages/dashboard/src/app/not-found.tsx`
- Create: `packages/dashboard/src/app/(dashboard)/error.tsx`

**Context:**
- Root layout: `packages/dashboard/src/app/layout.tsx` — uses `bg-gray-950 text-gray-100 antialiased`
- Dashboard layout: `packages/dashboard/src/app/(dashboard)/layout.tsx` — wraps children with Sidebar
- Currently NO error/not-found pages exist — crashes show raw React errors (`useInsertionEffect`)

### Steps

- [ ] **Step 1: Create `global-error.tsx`**

This is the last-resort error boundary. It must include its own `<html>` and `<body>` tags since it replaces the root layout.

```tsx
// packages/dashboard/src/app/global-error.tsx
'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-100 antialiased">
        <div className="text-center">
          <h1 className="text-4xl font-bold">Something went wrong</h1>
          <p className="mt-4 text-gray-400">An unexpected error occurred.</p>
          <button
            onClick={reset}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create `not-found.tsx`**

```tsx
// packages/dashboard/src/app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-100">404</h1>
        <p className="mt-4 text-lg text-gray-400">Page not found</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create `(dashboard)/error.tsx`**

This catches errors within dashboard pages (inside the sidebar layout).

```tsx
// packages/dashboard/src/app/(dashboard)/error.tsx
'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">Something went wrong</h2>
        <p className="mt-2 text-sm text-gray-400">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app/global-error.tsx packages/dashboard/src/app/not-found.tsx packages/dashboard/src/app/(dashboard)/error.tsx
git commit -m "feat(dashboard): add error boundary and not-found pages"
```

---

## Task 2: Dashboard Empty States

**Files:**
- Create: `packages/dashboard/src/components/empty-states/NoProjects.tsx`
- Create: `packages/dashboard/src/components/empty-states/NoData.tsx`
- Modify: `packages/dashboard/src/app/(dashboard)/page.tsx` — add empty states when no projects or no data
- Modify: `packages/dashboard/src/components/layout/ProjectSwitcher.tsx` — expose empty state

**Context:**
- ProjectSwitcher fetches `/api/projects` and auto-selects the first project. If no projects exist, the dropdown is empty and nothing loads.
- StatsCards shows "0" when stats is null. TimeseriesChart and TopPagesTable show nothing.
- `POST /api/projects` requires `{ name: string, domain: string }` and returns the created project.

### Steps

- [ ] **Step 1: Create `NoProjects.tsx`**

Shown when user has zero projects. Inline form to create first project.

```tsx
// packages/dashboard/src/components/empty-states/NoProjects.tsx
'use client';

import { useState } from 'react';

interface Props {
  onCreated: (projectId: string) => void;
}

export function NoProjects({ onCreated }: Props) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create project');
        return;
      }

      const data = await res.json();
      onCreated(data.project.id);
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        <h2 className="text-xl font-bold text-gray-100">Create your first project</h2>
        <p className="mt-2 text-sm text-gray-400">
          A project represents a website or app you want to track.
        </p>

        <form onSubmit={handleCreate} className="mt-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-300">
              Project name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Website"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="domain" className="block text-sm font-medium text-gray-300">
              Domain
            </label>
            <input
              id="domain"
              type="text"
              required
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={creating}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create project'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `NoData.tsx`**

Shown when a project exists but has no events yet. Shows tracker integration snippet.

```tsx
// packages/dashboard/src/components/empty-states/NoData.tsx
'use client';

import { useState } from 'react';

interface Props {
  projectId: string;
}

export function NoData({ projectId }: Props) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const generateKey = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Default', environment: 'live' }),
      });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.key);
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const snippet = `<script src="https://unpkg.com/@marlinjai/analytics-tracker"></script>
<script>
  AnalyticsTracker.init({
    projectId: '${projectId}',
    apiKey: '${apiKey || 'YOUR_API_KEY'}',
    endpoint: '${typeof window !== 'undefined' ? window.location.origin : ''}/api/collect',
  });
</script>`;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-8">
        <h2 className="text-xl font-bold text-gray-100">Waiting for first event</h2>
        <p className="mt-2 text-sm text-gray-400">
          Add the tracker to your website to start collecting analytics.
        </p>

        {!apiKey && (
          <button
            onClick={generateKey}
            disabled={generating}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate API key'}
          </button>
        )}

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-gray-400">
            Add this snippet before {'</body>'}:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-300">
            {snippet}
          </pre>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update overview page with empty states**

Modify `packages/dashboard/src/app/(dashboard)/page.tsx`:
- Track whether projects list is empty (from ProjectSwitcher callback)
- Show `NoProjects` when no projects exist
- Show `NoData` when project exists but stats are all zeros and timeseries is empty
- Show normal dashboard otherwise

The ProjectSwitcher already fetches projects. Add an `onEmpty` callback prop:

Update ProjectSwitcher to call `onEmpty?.()` when projects list is empty:
```tsx
// In ProjectSwitcher, add to Props:
onEmpty?: () => void;

// In the useEffect fetch callback, after setProjects:
if (data.projects?.length === 0) {
  onEmpty?.();
}
```

Update OverviewPage to use empty states:
```tsx
// Add state:
const [hasProjects, setHasProjects] = useState<boolean | null>(null);

// In JSX, conditionally render:
if (hasProjects === false) return <NoProjects onCreated={(id) => { setProjectId(id); setHasProjects(true); }} />;
if (!loading && projectId && stats && stats.pageviews === 0 && timeseries.length === 0) return <NoData projectId={projectId} />;
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/empty-states/ packages/dashboard/src/app/(dashboard)/page.tsx packages/dashboard/src/components/layout/ProjectSwitcher.tsx
git commit -m "feat(dashboard): add empty states for no projects and no data"
```

---

## Task 3: Settings Page

**Files:**
- Create: `packages/dashboard/src/app/(dashboard)/settings/page.tsx`
- Modify: `packages/dashboard/src/components/layout/Sidebar.tsx` — add Settings nav item

**Context:**
- Sidebar has `navItems` array with href/label/icon objects, using SVG path data for icons.
- API endpoints already exist: `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/[projectId]`, `GET/POST /api/projects/[projectId]/keys`, `DELETE /api/projects/[projectId]/keys/[keyId]`
- Auth session available via `useSession()` from next-auth/react or server-side `auth()`

### Steps

- [ ] **Step 1: Add Settings to Sidebar**

Add to `navItems` array in `packages/dashboard/src/components/layout/Sidebar.tsx`:

```tsx
{ href: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
```

- [ ] **Step 2: Create Settings page**

Create `packages/dashboard/src/app/(dashboard)/settings/page.tsx` with three sections:
1. **Profile** — display email and name (read-only for now, from session)
2. **Projects** — list projects with delete button (owner only)
3. **API Keys** — per-project key list with create/revoke

```tsx
// packages/dashboard/src/app/(dashboard)/settings/page.tsx
'use client';

import { useEffect, useState } from 'react';

interface Project {
  id: string;
  name: string;
  domain: string;
  created_at: string;
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
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        setProjects(data.projects ?? []);
        if (data.projects?.length > 0) setSelectedProject(data.projects[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    fetch(`/api/projects/${selectedProject}/keys`)
      .then((r) => r.json())
      .then((data) => setKeys(data.keys ?? []))
      .catch(() => {});
  }, [selectedProject]);

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project and all its data?')) return;
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedProject === id) setSelectedProject(null);
    }
  };

  const createKey = async () => {
    if (!selectedProject || !newKeyLabel.trim()) return;
    const res = await fetch(`/api/projects/${selectedProject}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newKeyLabel, environment: 'live' }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewKeyResult(data.key);
      setNewKeyLabel('');
      // Refresh keys list
      const keysRes = await fetch(`/api/projects/${selectedProject}/keys`);
      if (keysRes.ok) {
        const keysData = await keysRes.json();
        setKeys(keysData.keys ?? []);
      }
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!selectedProject || !confirm('Revoke this API key?')) return;
    const res = await fetch(`/api/projects/${selectedProject}/keys/${keyId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, revoked_at: new Date().toISOString() } : k));
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-100">Settings</h1>

      {/* Projects Section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-gray-100">Projects</h2>
        <div className="mt-4 divide-y divide-gray-800">
          {projects.length === 0 && (
            <p className="py-4 text-sm text-gray-400">No projects yet.</p>
          )}
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">{p.name}</p>
                <p className="text-xs text-gray-400">{p.domain}</p>
              </div>
              <button
                onClick={() => deleteProject(p.id)}
                className="rounded px-3 py-1 text-xs text-red-400 hover:bg-gray-800"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* API Keys Section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-gray-100">API Keys</h2>

        {projects.length > 0 && (
          <select
            value={selectedProject ?? ''}
            onChange={(e) => { setSelectedProject(e.target.value); setNewKeyResult(null); }}
            className="mt-3 w-full max-w-xs rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {newKeyResult && (
          <div className="mt-4 rounded-lg border border-yellow-800 bg-yellow-950 p-4">
            <p className="text-xs font-medium text-yellow-200">
              Copy this key now — it won't be shown again:
            </p>
            <code className="mt-1 block break-all text-sm text-yellow-100">{newKeyResult}</code>
          </div>
        )}

        <div className="mt-4 divide-y divide-gray-800">
          {keys.length === 0 && selectedProject && (
            <p className="py-4 text-sm text-gray-400">No API keys for this project.</p>
          )}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-100">
                  {k.label}
                  {k.revoked_at && <span className="ml-2 text-xs text-red-400">(revoked)</span>}
                </p>
                <p className="text-xs text-gray-400">
                  {k.prefix}*** &middot; Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                </p>
              </div>
              {!k.revoked_at && (
                <button
                  onClick={() => revokeKey(k.id)}
                  className="rounded px-3 py-1 text-xs text-red-400 hover:bg-gray-800"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>

        {selectedProject && (
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder="Key label"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={createKey}
              disabled={!newKeyLabel.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Create key
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/app/(dashboard)/settings/ packages/dashboard/src/components/layout/Sidebar.tsx
git commit -m "feat(dashboard): add settings page with project and API key management"
```

---

## Task 4: E2E Integration Test

**Files:**
- Create: `packages/dashboard/src/__tests__/e2e-pipeline.test.ts`

**Context:**
- Vitest config at root: `vitest.config.ts` with `{ test: { globals: true, environment: 'node' } }`
- PostgreSQL: `postgres://analytics:analytics_dev@localhost:5432/analytics`
- ClickHouse: `http://localhost:8123`, user `default`, password `clickhouse_dev`, database `analytics`
- API routes use NextAuth session for project APIs and API key header for collect endpoint
- Existing test files in `packages/shared/src/__tests__/` and `packages/tracker/src/__tests__/`
- Docker Compose must be running: `docker compose up -d postgres clickhouse`

### Steps

- [ ] **Step 1: Create E2E test file**

Test the full pipeline: create project (via direct DB) → create API key (via direct DB) → POST events to collect endpoint (HTTP) → query stats (via direct DB/ClickHouse) → verify data.

Since the dashboard runs as Next.js and we can't easily call API routes in vitest without a running server, the E2E test will:
1. Insert test data directly into PostgreSQL (project, API key)
2. Make HTTP requests to a running dev server (if available) OR test the pipeline via direct DB operations
3. Verify ClickHouse receives and aggregates correctly

```ts
// packages/dashboard/src/__tests__/e2e-pipeline.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createClient } from '@clickhouse/client';
import { randomUUID } from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://analytics:analytics_dev@localhost:5432/analytics';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || 'clickhouse_dev';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

describe('E2E Pipeline', () => {
  let sql: ReturnType<typeof postgres>;
  let ch: ReturnType<typeof createClient>;
  let projectId: string;
  let apiKey: string;
  let keyHash: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL, { max: 1 });
    ch = createClient({
      url: CLICKHOUSE_URL,
      username: 'default',
      password: CLICKHOUSE_PASSWORD,
      database: 'analytics',
    });

    // Create test project directly in Postgres
    projectId = randomUUID();
    await sql`
      INSERT INTO projects (id, name, domain)
      VALUES (${projectId}, 'E2E Test Project', 'e2e-test.local')
      ON CONFLICT DO NOTHING
    `;

    // Create test API key
    const keyBytes = randomUUID().replace(/-/g, '').slice(0, 32);
    apiKey = `ap_live_${keyBytes}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(apiKey)
    );
    keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await sql`
      INSERT INTO api_keys (id, project_id, key_hash, prefix, label)
      VALUES (${randomUUID()}, ${projectId}, ${keyHash}, 'ap_live_', 'E2E Test Key')
      ON CONFLICT DO NOTHING
    `;
  });

  afterAll(async () => {
    // Cleanup test data
    await sql`DELETE FROM api_keys WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
    await sql.end();
    await ch.close();
  });

  it('should ingest events via /api/collect and store in ClickHouse', async () => {
    const sessionId = randomUUID();
    const now = Date.now();

    // Send events to collect endpoint
    const res = await fetch(`${BASE_URL}/api/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        events: [
          {
            type: 'pageview',
            projectId,
            sessionId,
            timestamp: now,
            url: 'https://e2e-test.local/',
            title: 'Home',
            screenWidth: 1920,
            screenHeight: 1080,
            deviceType: 'desktop',
          },
          {
            type: 'click',
            projectId,
            sessionId,
            timestamp: now + 1000,
            url: 'https://e2e-test.local/',
            x: 100,
            y: 200,
            selector: 'button.cta',
            screenWidth: 1920,
            screenHeight: 1080,
            deviceType: 'desktop',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(2);

    // Wait for ClickHouse to process (async insert)
    await new Promise((r) => setTimeout(r, 2000));

    // Verify events in ClickHouse
    const result = await ch.query({
      query: `SELECT count() as cnt FROM analytics.events WHERE project_id = '${projectId}'`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ cnt: string }>();
    expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(2);
  });

  it('should reject events with invalid API key', async () => {
    const res = await fetch(`${BASE_URL}/api/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'ap_live_invalid_key_here',
      },
      body: JSON.stringify({
        events: [
          {
            type: 'pageview',
            projectId,
            sessionId: randomUUID(),
            timestamp: Date.now(),
            url: 'https://e2e-test.local/',
          },
        ],
      }),
    });

    expect(res.status).toBe(401);
  });

  it('should reject empty event batch', async () => {
    const res = await fetch(`${BASE_URL}/api/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ events: [] }),
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Verify tests run**

Requires Docker Compose databases running + dev server running:
```bash
docker compose up -d postgres clickhouse
# In another terminal: pnpm dev
pnpm test packages/dashboard/src/__tests__/e2e-pipeline.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/__tests__/e2e-pipeline.test.ts
git commit -m "test: add E2E pipeline integration test"
```
