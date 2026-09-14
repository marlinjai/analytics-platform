import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The Docker HEALTHCHECK (packages/dashboard/Dockerfile) polls GET /api/health
// every 15s. Regression guard for the ECONNRESET leak: an un-drained
// ClickHouse ResultSet left the socket open past idle timeout and logged
// "socket was closed before the response was fully read" on the next poll.
// The route must fully read the result (calling ResultSet.json()), not just
// await the query() call.

const jsonMock = vi.fn(async () => [{ 1: 1 }]);
const queryMock = vi.fn(async () => ({ json: jsonMock }));

vi.mock('@/lib/db', () => ({
  getDb: () => Object.assign(async () => [{ 1: 1 }], { unsafe: vi.fn() }),
}));

vi.mock('@/lib/clickhouse', () => ({
  getClickHouse: () => ({ query: queryMock }),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('drains the ClickHouse result stream (calls ResultSet.json())', async () => {
    const request = new NextRequest('http://localhost/api/health');
    const response = await GET(request);
    const body = await response.json();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'SELECT 1' })
    );
    expect(jsonMock).toHaveBeenCalledTimes(1);
    expect(body.checks.clickhouse).toBe('ok');
  });

  it('reports clickhouse as errored when the query rejects, without throwing', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    const request = new NextRequest('http://localhost/api/health');
    const response = await GET(request);
    const body = await response.json();

    expect(body.checks.clickhouse).toBe('error');
    expect(response.status).toBe(200);
  });
});
