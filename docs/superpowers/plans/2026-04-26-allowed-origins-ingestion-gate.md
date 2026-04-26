---
title: Allowed Origins Ingestion Gate
type: plan
status: draft
date: 2026-04-26
tags: [ingestion, security, cors, projects]
summary: Per-project allowed origins list. Tracker initializes everywhere (so flags/experiments work in dev/staging), but /api/collect silently drops events whose Origin doesn't match.
---

# Allowed Origins Ingestion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single project be initialized in any environment (localhost, staging, prod) while only collecting events from explicitly allowlisted origins. Flags, experiments, and replay configuration continue to work everywhere; ingestion is silently dropped from non-prod origins.

**Architecture:** Add `allowed_origins TEXT[]` to the `projects` table. `/api/collect` matches the `Origin` header (with `Referer` fallback) against that list using exact-host or `*.example.com` wildcard rules. Mismatches return `204` with `accepted: 0, dropped: N` so the SDK doesn't retry. The public config endpoint (`/api/projects/{id}/config`) stays wide open. CORS echoes the request origin only when it matches; otherwise it's omitted, giving defense in depth in the browser. Empty `allowed_origins` = legacy "allow all" behavior so existing projects don't break.

**Tech Stack:** Next.js 15 API routes, Postgres (`postgres-js`), Zod, Vitest, TypeScript.

---

## File Structure

**Create:**
- `packages/shared/src/migrations/013-postgres.sql` — adds `allowed_origins TEXT[]` column
- `packages/dashboard/src/lib/origin-match.ts` — pure origin-matching helper
- `packages/dashboard/src/__tests__/origin-match.test.ts` — unit tests for matcher
- `packages/dashboard/src/__tests__/collect-origin-gate.test.ts` — ingestion drop test

**Modify:**
- `packages/shared/src/postgres-ddl.ts` — keep DDL in sync with migration
- `packages/shared/src/types.ts` — extend `Project` type
- `packages/shared/src/schemas.ts` — extend `createProjectSchema` and add `updateProjectSchema`
- `packages/dashboard/src/app/api/collect/route.ts` — load project, match origin, gate insert + scope CORS
- `packages/dashboard/src/app/api/projects/route.ts` — accept `allowedOrigins` on create
- `packages/dashboard/src/app/api/projects/[projectId]/route.ts` — accept `allowedOrigins` on update
- `packages/dashboard/src/app/(dashboard)/settings/page.tsx` — UI editor for the list
- `packages/dashboard/CLAUDE.md` (or `CLAUDE.md` root) — document the new behavior

---

## Task 1: Postgres migration for `allowed_origins`

**Files:**
- Create: `packages/shared/src/migrations/013-postgres.sql`
- Modify: `packages/shared/src/postgres-ddl.ts:22-30`

- [ ] **Step 1: Write the migration**

Create `packages/shared/src/migrations/013-postgres.sql`:

```sql
-- Migration 013: Per-project allowed origins for ingestion gating.
-- Empty array = legacy behavior (allow events from any origin).
-- Populated array = only events whose Origin/Referer matches are accepted.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_projects_allowed_origins
    ON projects USING GIN (allowed_origins);
```

- [ ] **Step 2: Update DDL constant to mirror the migration**

Edit `packages/shared/src/postgres-ddl.ts` `CREATE_PROJECTS_TABLE` to:

```ts
export const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    domain          TEXT NOT NULL,
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
```

- [ ] **Step 3: Apply the migration**

Run: `bash scripts/migrate.sh`
Expected: log line `[migrate] Applying 013-postgres.sql ... done` and exit 0.

Verify: `docker compose exec postgres psql -U analytics -d analytics -c "\d projects"` should list `allowed_origins | text[]`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/migrations/013-postgres.sql packages/shared/src/postgres-ddl.ts
git commit -m "feat(db): add allowed_origins column to projects"
```

---

## Task 2: Extend shared types and schemas

**Files:**
- Modify: `packages/shared/src/types.ts:118-125` (the `Project` interface around line 120)
- Modify: `packages/shared/src/schemas.ts:117-122`

- [ ] **Step 1: Add `allowedOrigins` to the `Project` type**

In `packages/shared/src/types.ts`, locate the existing `Project` interface (search for `domain: string;` near line 120) and add:

```ts
export interface Project {
  id: string;
  name: string;
  domain: string;
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
}
```

(Keep any other existing fields. Only add `allowedOrigins: string[]`.)

- [ ] **Step 2: Extend `createProjectSchema` and add `updateProjectSchema`**

In `packages/shared/src/schemas.ts`, replace the `createProjectSchema` block:

```ts
const allowedOriginEntrySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^(https?:\/\/)?(\*\.)?[a-zA-Z0-9.-]+(:\d+)?$/,
    'Must be a hostname like example.com, *.example.com, or http://localhost:3000'
  );

export const createProjectSchema = z.object({
  name: z.string().min(1).max(128),
  domain: z.string().min(1).max(256),
  allowedOrigins: z.array(allowedOriginEntrySchema).max(20).default([]),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  domain: z.string().min(1).max(256).optional(),
  allowedOrigins: z.array(allowedOriginEntrySchema).max(20).optional(),
});
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @analytics-platform/shared typecheck`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/schemas.ts
git commit -m "feat(shared): expose allowedOrigins in Project type and schemas"
```

---

## Task 3: Origin matcher helper (TDD)

**Files:**
- Create: `packages/dashboard/src/lib/origin-match.ts`
- Test: `packages/dashboard/src/__tests__/origin-match.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/src/__tests__/origin-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { originIsAllowed, normalizeOriginEntry } from '@/lib/origin-match';

describe('originIsAllowed', () => {
  it('allows everything when the list is empty (legacy projects)', () => {
    expect(originIsAllowed('https://anything.com', [])).toBe(true);
    expect(originIsAllowed(null, [])).toBe(true);
  });

  it('rejects when list is non-empty but origin is missing', () => {
    expect(originIsAllowed(null, ['example.com'])).toBe(false);
  });

  it('matches exact host (scheme and port ignored)', () => {
    expect(originIsAllowed('https://example.com', ['example.com'])).toBe(true);
    expect(originIsAllowed('http://example.com:8080', ['example.com'])).toBe(true);
    expect(originIsAllowed('https://other.com', ['example.com'])).toBe(false);
  });

  it('matches wildcard subdomains', () => {
    expect(originIsAllowed('https://app.lolastories.com', ['*.lolastories.com'])).toBe(true);
    expect(originIsAllowed('https://lolastories.com', ['*.lolastories.com'])).toBe(false);
    expect(originIsAllowed('https://a.b.lolastories.com', ['*.lolastories.com'])).toBe(true);
    expect(originIsAllowed('https://lolastories.com.evil.com', ['*.lolastories.com'])).toBe(false);
  });

  it('supports localhost with port', () => {
    expect(originIsAllowed('http://localhost:3000', ['localhost'])).toBe(true);
    expect(originIsAllowed('http://localhost:3100', ['localhost:3100'])).toBe(true);
    expect(originIsAllowed('http://localhost:9999', ['localhost:3100'])).toBe(false);
  });

  it('rejects malformed origins', () => {
    expect(originIsAllowed('not-a-url', ['example.com'])).toBe(false);
    expect(originIsAllowed('', ['example.com'])).toBe(false);
  });
});

describe('normalizeOriginEntry', () => {
  it('strips scheme and trailing slash', () => {
    expect(normalizeOriginEntry('https://example.com/')).toBe('example.com');
    expect(normalizeOriginEntry('http://example.com')).toBe('example.com');
  });

  it('preserves host:port', () => {
    expect(normalizeOriginEntry('http://localhost:3000')).toBe('localhost:3000');
  });

  it('preserves wildcard prefix', () => {
    expect(normalizeOriginEntry('*.example.com')).toBe('*.example.com');
    expect(normalizeOriginEntry('https://*.example.com')).toBe('*.example.com');
  });

  it('lowercases the host', () => {
    expect(normalizeOriginEntry('HTTPS://Example.COM')).toBe('example.com');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- packages/dashboard/src/__tests__/origin-match.test.ts`
Expected: FAIL with "Failed to resolve import '@/lib/origin-match'".

- [ ] **Step 3: Implement the matcher**

Create `packages/dashboard/src/lib/origin-match.ts`:

```ts
/**
 * Allowed-origin matching for ingestion gating.
 *
 * Entries are stored as `host`, `host:port`, or `*.host` (no scheme, lowercase).
 * `normalizeOriginEntry` strips schemes/trailing slashes for storage.
 * `originIsAllowed` parses the request Origin/Referer and matches it.
 *
 * Empty allowlist means "no restriction" so legacy projects keep working.
 */

export function normalizeOriginEntry(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/\/.*$/, '');
  return value;
}

function parseOriginHost(origin: string): { host: string; port: string | null } | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || null,
    };
  } catch {
    return null;
  }
}

function matchEntry(entry: string, host: string, port: string | null): boolean {
  const normalized = normalizeOriginEntry(entry);
  const [entryHost, entryPort] = normalized.includes(':') && !normalized.startsWith('*.')
    ? normalized.split(':')
    : [normalized, null];

  if (entryPort && entryPort !== port) return false;

  if (entryHost.startsWith('*.')) {
    const suffix = entryHost.slice(2);
    return host.endsWith('.' + suffix);
  }

  return host === entryHost;
}

export function originIsAllowed(
  origin: string | null | undefined,
  allowedOrigins: string[]
): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;

  const parsed = parseOriginHost(origin);
  if (!parsed) return false;

  return allowedOrigins.some((entry) => matchEntry(entry, parsed.host, parsed.port));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- packages/dashboard/src/__tests__/origin-match.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/origin-match.ts packages/dashboard/src/__tests__/origin-match.test.ts
git commit -m "feat(dashboard): add origin-match helper with wildcard support"
```

---

## Task 4: Gate `/api/collect` on `allowed_origins`

**Files:**
- Modify: `packages/dashboard/src/app/api/collect/route.ts`
- Test: `packages/dashboard/src/__tests__/collect-origin-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/__tests__/collect-origin-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api-key', () => ({
  validateApiKey: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/lib/clickhouse', () => ({
  insertEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/enrich', () => ({
  enrichEvents: vi.fn(async (events: unknown[]) => events),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/snapshot-store', () => ({
  maybeStoreSnapshot: vi.fn(),
}));

import { validateApiKey } from '@/lib/api-key';
import { getDb } from '@/lib/db';
import { insertEvents } from '@/lib/clickhouse';
import { POST } from '@/app/api/collect/route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

function buildRequest(origin: string | null, body: unknown): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-api-key': 'ap_live_test',
  });
  if (origin) headers.set('origin', origin);
  return new Request('http://localhost/api/collect', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    type: 'pageview',
    timestamp: new Date().toISOString(),
    sessionId: 'sess-1',
    visitorId: 'vis-1',
    url: 'https://app.lolastories.com/',
    referrer: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    kind: 'project',
    projectId: PROJECT_ID,
    keyId: 'key-1',
    prefix: 'ap_live_',
  });
});

describe('POST /api/collect — origin gating', () => {
  it('drops events whose Origin is not in allowed_origins', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(
      // tagged template fn that returns the project row
      Object.assign(
        async () => [{ allowed_origins: ['app.lolastories.com'] }],
        {}
      )
    );

    const req = buildRequest('http://localhost:3000', [makeEvent()]);
    const res = await POST(req as never);

    expect(res.status).toBe(204);
    const body = res.body ? await res.json() : null;
    if (body) {
      expect(body.dropped).toBe(1);
      expect(body.accepted).toBe(0);
    }
    expect(insertEvents).not.toHaveBeenCalled();
  });

  it('accepts events whose Origin matches allowed_origins', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(
      Object.assign(
        async () => [{ allowed_origins: ['app.lolastories.com'] }],
        {}
      )
    );

    const req = buildRequest('https://app.lolastories.com', [makeEvent()]);
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(insertEvents).toHaveBeenCalledTimes(1);
  });

  it('accepts events from any origin when allowed_origins is empty', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(
      Object.assign(async () => [{ allowed_origins: [] }], {})
    );

    const req = buildRequest('http://localhost:3000', [makeEvent()]);
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(insertEvents).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm test -- packages/dashboard/src/__tests__/collect-origin-gate.test.ts`
Expected: FAIL — drop test fails because the route still inserts unconditionally.

- [ ] **Step 3: Update `/api/collect` to load project + gate**

Edit `packages/dashboard/src/app/api/collect/route.ts`. Replace the file with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { eventBatchSchema } from '@analytics-platform/shared';
import { validateApiKey } from '@/lib/api-key';
import { enrichEvents } from '@/lib/enrich';
import { insertEvents } from '@/lib/clickhouse';
import { checkRateLimit } from '@/lib/rate-limit';
import { maybeStoreSnapshot } from '@/lib/snapshot-store';
import { getDb } from '@/lib/db';
import { originIsAllowed } from '@/lib/origin-match';

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

function corsHeaders(origin: string | null, allowedOrigins: string[]) {
  const echo =
    origin && (allowedOrigins.length === 0 || originIsAllowed(origin, allowedOrigins))
      ? origin
      : null;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, X-API-Key',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
  if (echo) headers['Access-Control-Allow-Origin'] = echo;
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  // No project context yet on preflight — be permissive on OPTIONS itself; the
  // POST will decide whether to drop. Browsers still honor the POST response.
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, X-API-Key',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const requestOrigin = origin ?? referer;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing x-api-key header' },
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }

  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return NextResponse.json(
      { error: 'Invalid or revoked API key' },
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }
  if (keyInfo.kind !== 'project') {
    return NextResponse.json(
      { error: 'Account keys cannot be used for event ingestion. Use a project key (ap_live_ or ap_test_).' },
      { status: 403, headers: corsHeaders(origin, []) }
    );
  }

  // Load the project's allowed_origins for both gating and CORS
  const db = getDb();
  const projectRows = await db`
    SELECT allowed_origins FROM projects WHERE id = ${keyInfo.projectId}
  `;
  const allowedOrigins: string[] = projectRows[0]?.allowed_origins ?? [];
  const cors = corsHeaders(origin, allowedOrigins);

  if (!checkRateLimit(keyInfo.keyId)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: cors });
  }

  let body: unknown;
  try {
    const encoding = request.headers.get('content-encoding');
    if (encoding === 'gzip') {
      const buf = Buffer.from(await request.arrayBuffer());
      try {
        const decompressed = gunzipSync(buf);
        body = JSON.parse(decompressed.toString('utf-8'));
      } catch {
        body = JSON.parse(buf.toString('utf-8'));
      }
    } else {
      body = await request.json();
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const parsed = eventBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400, headers: cors }
    );
  }

  const events = parsed.data;

  const invalidEvents = events.filter((e) => e.projectId !== keyInfo.projectId);
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      { error: 'Event projectId does not match API key project' },
      { status: 403, headers: cors }
    );
  }

  // Origin gate: silently drop events from non-allowed origins.
  // 204 + dropped count tells the SDK "we got the request, no need to retry"
  // without triggering visible errors in the user's app console.
  if (!originIsAllowed(requestOrigin, allowedOrigins)) {
    return NextResponse.json(
      { ok: true, accepted: 0, dropped: events.length, reason: 'origin_not_allowed' },
      { status: 204, headers: cors }
    );
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? '0.0.0.0';

  const enriched = await enrichEvents(events, ip, keyInfo.prefix);

  try {
    await insertEvents(enriched);
  } catch (err) {
    console.error('ClickHouse insert error:', err);
    return NextResponse.json({ error: 'Failed to store events' }, { status: 500, headers: cors });
  }

  for (const event of enriched) {
    if (
      event.type === 'replay_chunk' &&
      event.pageHash &&
      event.replayChunk?.length
    ) {
      maybeStoreSnapshot(
        event.projectId,
        event.url,
        event.pageHash,
        event.replayChunk
      ).catch(() => {});
    }
  }

  return NextResponse.json(
    { ok: true, accepted: enriched.length, dropped: 0 },
    { headers: cors }
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- packages/dashboard/src/__tests__/collect-origin-gate.test.ts`
Expected: PASS, 3/3 tests green.

- [ ] **Step 5: Run full dashboard test suite to catch regressions**

Run: `pnpm test -- --run`
Expected: PASS, no regressions in `collect.test.ts` or other ingestion tests.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/app/api/collect/route.ts packages/dashboard/src/__tests__/collect-origin-gate.test.ts
git commit -m "feat(api): gate /api/collect on per-project allowed_origins"
```

---

## Task 5: Accept `allowedOrigins` in project create + update APIs

**Files:**
- Modify: `packages/dashboard/src/app/api/projects/route.ts`
- Modify: `packages/dashboard/src/app/api/projects/[projectId]/route.ts`

- [ ] **Step 1: Update create endpoint**

In `packages/dashboard/src/app/api/projects/route.ts`, find the POST handler that calls `createProjectSchema.parse(body)` and inserts the row. Change the insert to include `allowed_origins`:

```ts
const { name, domain, allowedOrigins } = parsed.data;

const [project] = await db`
  INSERT INTO projects (name, domain, allowed_origins)
  VALUES (${name}, ${domain}, ${allowedOrigins})
  RETURNING *
`;
```

(Use the existing variable for the parsed schema result. `allowedOrigins` already defaults to `[]` in the schema.)

- [ ] **Step 2: Update PUT/PATCH endpoint**

In `packages/dashboard/src/app/api/projects/[projectId]/route.ts`, replace the `updateProject` function body. Validate input with `updateProjectSchema` (imported from `@analytics-platform/shared`) and add `allowed_origins`:

```ts
import { updateProjectSchema } from '@analytics-platform/shared';

async function updateProject(request: NextRequest, params: Promise<{ projectId: string }>) {
  const { projectId } = await params;
  const authResult = await authenticateRequest(request, projectId, ['owner', 'admin']);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const rawBody = await request.json();
  const parsed = updateProjectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { name, domain, allowedOrigins } = parsed.data;

  const db = getDb();
  const [project] = await db`
    UPDATE projects
    SET name = COALESCE(${name ?? null}, name),
        domain = COALESCE(${domain ?? null}, domain),
        allowed_origins = COALESCE(${allowedOrigins ?? null}, allowed_origins),
        updated_at = now()
    WHERE id = ${projectId}
    RETURNING *
  `;

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ project });
}
```

- [ ] **Step 3: Manual smoke test against dev DB**

Run: `pnpm dev:local` then in another shell:

```bash
curl -X PATCH http://localhost:3100/api/projects/<PROJECT_UUID> \
  -H "Content-Type: application/json" \
  -H "x-api-key: <ACCOUNT_KEY>" \
  -d '{"allowedOrigins":["app.lolastories.com","*.lolastories.com"]}'
```

Expected: response includes `"allowed_origins":["app.lolastories.com","*.lolastories.com"]`.

Verify in DB: `SELECT allowed_origins FROM projects WHERE id='<UUID>';` returns the same array.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app/api/projects/route.ts packages/dashboard/src/app/api/projects/[projectId]/route.ts
git commit -m "feat(api): accept allowedOrigins on project create and update"
```

---

## Task 6: Settings UI — edit allowed origins list

**Files:**
- Modify: `packages/dashboard/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Read the current settings page to find the project section**

Run: `grep -n "domain\|project.name\|<input" packages/dashboard/src/app/(dashboard)/settings/page.tsx | head -30`

Locate the block where the project's `name` and `domain` are displayed/edited (around the previously-found `<p>{project.domain}</p>` near line 595). Use the existing form patterns in that file — do not introduce a new styling system.

- [ ] **Step 2: Add `allowedOrigins` editor**

Just below the existing domain field, add a textarea bound to local state. One origin per line. On save, send `PATCH /api/projects/<id>` with `{ allowedOrigins: lines }`.

```tsx
{/* Allowed origins */}
<div className="space-y-2">
  <label htmlFor="allowed-origins" className="text-sm font-medium text-gray-200">
    Allowed origins
  </label>
  <p className="text-xs text-gray-400">
    One per line. Supports exact hosts (<code>app.example.com</code>),
    wildcard subdomains (<code>*.example.com</code>), and dev hosts
    (<code>localhost:3000</code>). Leave empty to accept events from any origin.
  </p>
  <textarea
    id="allowed-origins"
    rows={4}
    className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100"
    value={allowedOriginsText}
    onChange={(e) => setAllowedOriginsText(e.target.value)}
    placeholder={'app.example.com\n*.example.com'}
  />
  <button
    type="button"
    onClick={saveAllowedOrigins}
    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
  >
    Save allowed origins
  </button>
  {allowedOriginsStatus && (
    <p className="text-xs text-gray-400">{allowedOriginsStatus}</p>
  )}
</div>
```

State and handler at the top of the component (next to existing project state):

```tsx
const [allowedOriginsText, setAllowedOriginsText] = useState<string>(
  (project.allowedOrigins ?? []).join('\n')
);
const [allowedOriginsStatus, setAllowedOriginsStatus] = useState<string>('');

async function saveAllowedOrigins() {
  const lines = allowedOriginsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  setAllowedOriginsStatus('Saving...');
  const res = await fetch(`/api/projects/${project.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowedOrigins: lines }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    setAllowedOriginsStatus(`Error: ${data.error ?? res.statusText}`);
    return;
  }
  setAllowedOriginsStatus('Saved.');
  setTimeout(() => setAllowedOriginsStatus(''), 2000);
}
```

(If the page already uses a different fetch wrapper or status pattern, follow that pattern instead.)

- [ ] **Step 3: Update the local Project type used in this page**

Search for the `interface Project` declaration in `settings/page.tsx` (line ~38) and add `allowedOrigins: string[];`.

- [ ] **Step 4: Manual UI test**

Run: `pnpm dev:local`
Open: `http://localhost:3100/settings`
Steps:
  1. Add `app.lolastories.com` to allowed origins, save.
  2. Reload, confirm value persists.
  3. Hit `/api/collect` from a non-listed origin — confirm `dropped: 1` in the response payload (use curl with `Origin: http://evil.com`).
  4. Hit `/api/collect` from `app.lolastories.com` — confirm `accepted: 1`.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(dashboard): allow editing allowed_origins from project settings"
```

---

## Task 7: Document the behavior

**Files:**
- Modify: `packages/dashboard/CLAUDE.md` (or root `CLAUDE.md` if no package-level file exists — pick the same one referenced in existing docs)

- [ ] **Step 1: Add a section under "Architecture"**

Add this paragraph next to the existing "API Key Format" section:

```markdown
### Allowed Origins (Ingestion Gate)

Each project carries an `allowed_origins TEXT[]` column (`packages/shared/src/postgres-ddl.ts`). When non-empty, `/api/collect` matches the request `Origin` (or `Referer` fallback) against the list using `originIsAllowed()` (`packages/dashboard/src/lib/origin-match.ts`). Mismatches are silently dropped (HTTP 204, `dropped: N`) so dev/staging environments can call `init()` for flag and experiment evaluation without polluting prod analytics. Empty list = legacy "allow all" behavior. The `/api/projects/{id}/config` endpoint is intentionally not gated: tracker config must load everywhere for variants to render correctly.
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/CLAUDE.md
git commit -m "docs: explain allowed_origins ingestion gate"
```

---

## Self-Review Checklist (run before claiming done)

- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm test -- --run` passes
- [ ] Migration 013 applies cleanly on a fresh DB (`bash scripts/setup.sh` from a clean docker volume)
- [ ] Settings page round-trips an `allowed_origins` value
- [ ] curl from an off-list origin returns `dropped: 1` and does not insert into ClickHouse (verify with `SELECT count() FROM analytics.events WHERE timestamp > now() - INTERVAL 1 MINUTE`)
- [ ] curl from an on-list origin returns `accepted: 1` and inserts
- [ ] CORS header is omitted (not `*`) when origin is non-allowed and list is non-empty
- [ ] The lola-stories landing can call `init()` in localhost without polluting the prod project's events

---

## Out of Scope

Explicitly **not** part of this plan:

- Dashboard view of "dropped events" telemetry (would require a counter or audit log)
- Per-environment project key splitting (`ap_test_` vs `ap_live_` enforcement) — the existing key prefixes still flow through unchanged
- Migrating the existing `domain` column to be derived from `allowed_origins[0]` — kept as a separate "primary domain" label for now
- Rate-limit changes
