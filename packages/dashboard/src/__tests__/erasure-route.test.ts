/**
 * Integration tests for POST /api/internal/erasure.
 *
 * The route/handler are driven with an in-memory ErasureStore fake that models the
 * WORKSPACE-scoped analytics data (projects keyed by workspace_id + their cascaded
 * child rows, the ClickHouse events keyed by project_id, the account_api_keys keyed
 * by user_id, and the erasure_events idempotency ledger). No live Postgres/ClickHouse.
 *
 * Covered: signature valid/invalid/missing/env-missing, malformed payload, the
 * tenant.erased cascade + cross-workspace isolation (two workspaces erased, one
 * untouched), replay no-op, partial-failure retry, and the user.erased key deletion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { ErasureWebhookPayload } from '@marlinjai/auth-brain-shared';
import type { ErasureStore, ErasureLedgerRecord } from '@/lib/erasure/store';
import { ERASURE_SIGNATURE_HEADER, ERASURE_SECRET_ENV } from '@/lib/erasure/signature';
import { POST } from '@/app/api/internal/erasure/route';
import { setErasureStoreOverride } from '@/lib/erasure/store';
import type { NextRequest } from 'next/server';

const SECRET = 'erasure-shared-secret-0123456789';

const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WS_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROJ_A = '11111111-1111-4111-8111-111111111111';
const PROJ_B = '22222222-2222-4222-8222-222222222222';
const PROJ_C = '33333333-3333-4333-8333-333333333333';
const USER_1 = '99999999-9999-4999-8999-999999999999';
const USER_2 = '88888888-8888-4888-8888-888888888888';

interface Project { id: string; workspaceId: string }
interface Scoped { id: string; projectId: string }
interface ApiKey { id: string; userId: string }

/** In-memory store modelling the cascade + idempotency ledger. */
class FakeStore implements ErasureStore {
  ledger = new Map<string, { kind: string; completedAt: Date | null }>();
  projects: Project[] = [];
  experiments: Scoped[] = [];
  flags: Scoped[] = [];
  funnels: Scoped[] = [];
  settings: Scoped[] = [];
  goals: Scoped[] = [];
  clickhouseEvents = new Map<string, number>(); // projectId -> event count
  accountApiKeys: ApiKey[] = [];

  /** Records every project id a ClickHouse purge mutation was issued for, in order. */
  purgeCalls: string[] = [];
  /** When set, the NEXT purge call throws (simulates a ClickHouse failure). */
  failNextPurge = false;

  seedWorkspace(workspaceId: string, projectId: string, tag: string) {
    this.projects.push({ id: projectId, workspaceId });
    this.experiments.push({ id: `exp-${tag}`, projectId });
    this.flags.push({ id: `flag-${tag}`, projectId });
    this.funnels.push({ id: `funnel-${tag}`, projectId });
    this.settings.push({ id: `setting-${tag}`, projectId });
    this.goals.push({ id: `goal-${tag}`, projectId });
    this.clickhouseEvents.set(projectId, 100);
  }

  async findEvent(eventId: string): Promise<ErasureLedgerRecord | null> {
    const row = this.ledger.get(eventId);
    return row ? { completedAt: row.completedAt } : null;
  }

  async recordEvent(eventId: string, kind: string): Promise<void> {
    if (!this.ledger.has(eventId)) this.ledger.set(eventId, { kind, completedAt: null });
  }

  async completeEvent(eventId: string): Promise<void> {
    const row = this.ledger.get(eventId);
    if (row) row.completedAt = new Date('2026-07-27T00:00:00.000Z');
  }

  async findProjectIdsByWorkspaces(workspaceIds: string[]): Promise<string[]> {
    return this.projects.filter((p) => workspaceIds.includes(p.workspaceId)).map((p) => p.id);
  }

  async purgeClickHouseForProject(projectId: string): Promise<void> {
    if (this.failNextPurge) {
      this.failNextPurge = false;
      throw new Error('clickhouse backend down');
    }
    this.purgeCalls.push(projectId);
    this.clickhouseEvents.delete(projectId);
  }

  async deleteProjects(projectIds: string[]): Promise<void> {
    const set = new Set(projectIds);
    this.projects = this.projects.filter((p) => !set.has(p.id));
    // Model ON DELETE CASCADE for every project-scoped table.
    const drop = (rows: Scoped[]) => rows.filter((r) => !set.has(r.projectId));
    this.experiments = drop(this.experiments);
    this.flags = drop(this.flags);
    this.funnels = drop(this.funnels);
    this.settings = drop(this.settings);
    this.goals = drop(this.goals);
  }

  async deleteAccountApiKeysForUser(userId: string): Promise<number> {
    const before = this.accountApiKeys.length;
    this.accountApiKeys = this.accountApiKeys.filter((k) => k.userId !== userId);
    return before - this.accountApiKeys.length;
  }

  // Test helpers.
  hasProject(id: string) { return this.projects.some((p) => p.id === id); }
  childCountFor(id: string) {
    return [this.experiments, this.flags, this.funnels, this.settings, this.goals]
      .reduce((n, rows) => n + rows.filter((r) => r.projectId === id).length, 0);
  }
}

let store: FakeStore;

beforeEach(() => {
  process.env[ERASURE_SECRET_ENV] = SECRET;
  store = new FakeStore();
  store.seedWorkspace(WS_A, PROJ_A, 'A');
  store.seedWorkspace(WS_B, PROJ_B, 'B');
  store.seedWorkspace(WS_C, PROJ_C, 'C');
  store.accountApiKeys.push({ id: 'k1', userId: USER_1 }, { id: 'k2', userId: USER_1 }, { id: 'k3', userId: USER_2 });
  setErasureStoreOverride(store);
});

afterEach(() => {
  setErasureStoreOverride(undefined);
  delete process.env[ERASURE_SECRET_ENV];
});

/** POST a payload signed the auth-brain way (hex HMAC-SHA256 over the raw body). */
function postErasure(
  payload: unknown,
  opts: { secret?: string; signature?: string; omitHeader?: boolean } = {},
) {
  const body = JSON.stringify(payload);
  const sig = opts.signature ?? createHmac('sha256', opts.secret ?? SECRET).update(body).digest('hex');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.omitHeader) headers[ERASURE_SIGNATURE_HEADER] = sig;
  const req = new Request('http://localhost/api/internal/erasure', { method: 'POST', headers, body });
  return POST(req as unknown as NextRequest);
}

function tenantErased(workspaceIds: string[], eventId: string): ErasureWebhookPayload {
  return {
    event_id: eventId,
    kind: 'tenant.erased',
    user_id: USER_1,
    tenant_id: 'ten_1',
    workspace_ids: workspaceIds,
    requested_at: '2026-07-25T10:00:00.000Z',
  };
}

describe('POST /api/internal/erasure - signature gate', () => {
  it('rejects a wrong-secret signature with 401 and deletes nothing', async () => {
    const res = await postErasure(tenantErased([WS_A], 'evt-401'), { secret: 'the-wrong-but-long-secret' });
    expect(res.status).toBe(401);
    expect(store.purgeCalls).toHaveLength(0);
    expect(store.hasProject(PROJ_A)).toBe(true);
    expect(await store.findEvent('evt-401')).toBeNull();
  });

  it('rejects a missing signature header with 401', async () => {
    const res = await postErasure(tenantErased([WS_A], 'evt-nohdr'), { omitHeader: true });
    expect(res.status).toBe(401);
    expect(store.hasProject(PROJ_A)).toBe(true);
  });

  it('fails closed with 500 when the secret env is missing', async () => {
    delete process.env[ERASURE_SECRET_ENV];
    const res = await postErasure(tenantErased([WS_A], 'evt-noenv'));
    expect(res.status).toBe(500);
    expect(store.hasProject(PROJ_A)).toBe(true);
  });

  it('rejects a malformed payload with 400 (valid signature, bad body)', async () => {
    const res = await postErasure({ kind: 'tenant.erased' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/internal/erasure - tenant.erased cascade + isolation', () => {
  it('erases two workspaces (projects + cascaded rows + ClickHouse events) and leaves the third untouched', async () => {
    const res = await postErasure(tenantErased([WS_A, WS_B], 'evt-cascade'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, outcome: 'completed' });

    // Erased workspaces: projects + all cascaded child rows gone.
    expect(store.hasProject(PROJ_A)).toBe(false);
    expect(store.hasProject(PROJ_B)).toBe(false);
    expect(store.childCountFor(PROJ_A)).toBe(0);
    expect(store.childCountFor(PROJ_B)).toBe(0);

    // A ClickHouse mutation was issued for exactly the two erased projects.
    expect([...store.purgeCalls].sort()).toEqual([PROJ_A, PROJ_B].sort());
    expect(store.clickhouseEvents.has(PROJ_A)).toBe(false);
    expect(store.clickhouseEvents.has(PROJ_B)).toBe(false);

    // Isolation: the untouched workspace keeps its project, children, and events.
    expect(store.hasProject(PROJ_C)).toBe(true);
    expect(store.childCountFor(PROJ_C)).toBe(5);
    expect(store.clickhouseEvents.get(PROJ_C)).toBe(100);
    expect(store.purgeCalls).not.toContain(PROJ_C);

    // Ledger recorded + completed.
    const evt = await store.findEvent('evt-cascade');
    expect(evt?.completedAt).not.toBeNull();
  });

  it('replays a completed event as a 200 no-op (no re-deletion)', async () => {
    const first = await postErasure(tenantErased([WS_A], 'evt-replay'));
    expect(first.status).toBe(200);
    expect(store.purgeCalls).toEqual([PROJ_A]);

    const replay = await postErasure(tenantErased([WS_A], 'evt-replay'));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ outcome: 'noop' });
    // No further ClickHouse mutations on replay.
    expect(store.purgeCalls).toEqual([PROJ_A]);
  });

  it('acks an empty workspace_ids as a completed no-op (never a delete-everything)', async () => {
    const res = await postErasure(tenantErased([], 'evt-empty'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ outcome: 'completed' });
    expect(store.purgeCalls).toHaveLength(0);
    expect(store.projects).toHaveLength(3);
  });
});

describe('POST /api/internal/erasure - partial failure + retry', () => {
  it('a ClickHouse failure returns 5xx, leaves the event incomplete and rows intact, and a retry completes it', async () => {
    store.failNextPurge = true;
    const fail = await postErasure(tenantErased([WS_A], 'evt-retry'));
    expect(fail.status).toBe(500);

    // ClickHouse-first ordering: the Postgres rows must remain, and the event must
    // NOT be marked complete.
    expect(store.hasProject(PROJ_A)).toBe(true);
    expect(store.childCountFor(PROJ_A)).toBe(5);
    const incomplete = await store.findEvent('evt-retry');
    expect(incomplete).not.toBeNull();
    expect(incomplete?.completedAt).toBeNull();

    // Retry: ClickHouse now succeeds -> remaining deletions complete and ack 200.
    const retry = await postErasure(tenantErased([WS_A], 'evt-retry'));
    expect(retry.status).toBe(200);
    expect(store.hasProject(PROJ_A)).toBe(false);
    expect(store.childCountFor(PROJ_A)).toBe(0);
    const done = await store.findEvent('evt-retry');
    expect(done?.completedAt).not.toBeNull();
  });
});

describe('POST /api/internal/erasure - user.erased', () => {
  it("deletes only the erased user's account API keys, leaves others + all project data untouched", async () => {
    const payload: ErasureWebhookPayload = {
      event_id: 'evt-user',
      kind: 'user.erased',
      user_id: USER_1,
      requested_at: '2026-07-25T10:00:00.000Z',
    };
    const res = await postErasure(payload);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ outcome: 'completed' });

    // USER_1's two keys gone; USER_2's key remains.
    expect(store.accountApiKeys.map((k) => k.id).sort()).toEqual(['k3']);
    // No project data touched, no ClickHouse mutations.
    expect(store.purgeCalls).toHaveLength(0);
    expect(store.projects).toHaveLength(3);

    const evt = await store.findEvent('evt-user');
    expect(evt?.completedAt).not.toBeNull();
  });
});
