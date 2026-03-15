import { describe, it, expect } from 'vitest';
import {
  trackerEventSchema,
  eventBatchSchema,
  eventTypeSchema,
  deviceTypeSchema,
  dateRangeSchema,
  statsQuerySchema,
  heatmapQuerySchema,
  sessionListQuerySchema,
  replayQuerySchema,
  createProjectSchema,
  createApiKeySchema,
} from '../schemas.js';

const validUuid = '550e8400-e29b-41d4-a716-446655440000';

const validTrackerEvent = {
  type: 'pageview' as const,
  projectId: validUuid,
  sessionId: 'abc-123',
  timestamp: Date.now(),
  url: 'https://example.com/page',
};

describe('eventTypeSchema', () => {
  it('accepts valid event types', () => {
    for (const t of ['pageview', 'click', 'scroll', 'custom', 'session_start', 'session_end', 'replay_chunk']) {
      expect(eventTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects invalid event types', () => {
    expect(() => eventTypeSchema.parse('invalid')).toThrow();
    expect(() => eventTypeSchema.parse('')).toThrow();
  });
});

describe('deviceTypeSchema', () => {
  it('accepts valid device types', () => {
    for (const d of ['mobile', 'tablet', 'desktop']) {
      expect(deviceTypeSchema.parse(d)).toBe(d);
    }
  });

  it('rejects invalid device types', () => {
    expect(() => deviceTypeSchema.parse('watch')).toThrow();
  });
});

describe('dateRangeSchema', () => {
  it('accepts valid ISO datetime strings', () => {
    const result = dateRangeSchema.parse({
      from: '2025-01-01T00:00:00Z',
      to: '2025-01-31T23:59:59Z',
    });
    expect(result.from).toBe('2025-01-01T00:00:00Z');
  });

  it('rejects non-datetime strings', () => {
    expect(() => dateRangeSchema.parse({ from: 'not-a-date', to: '2025-01-01T00:00:00Z' })).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => dateRangeSchema.parse({ from: '2025-01-01T00:00:00Z' })).toThrow();
  });
});

describe('trackerEventSchema', () => {
  it('accepts a minimal valid pageview event', () => {
    const result = trackerEventSchema.parse(validTrackerEvent);
    expect(result.type).toBe('pageview');
    expect(result.projectId).toBe(validUuid);
  });

  it('accepts a fully populated click event', () => {
    const result = trackerEventSchema.parse({
      ...validTrackerEvent,
      type: 'click',
      x: 100,
      y: 200,
      selector: 'button.submit',
      screenWidth: 1920,
      screenHeight: 1080,
      deviceType: 'desktop',
      userAgent: 'Mozilla/5.0',
      referrer: 'https://google.com',
    });
    expect(result.type).toBe('click');
    expect(result.x).toBe(100);
  });

  it('accepts a scroll event with scrollDepth', () => {
    const result = trackerEventSchema.parse({
      ...validTrackerEvent,
      type: 'scroll',
      scrollDepth: 75,
    });
    expect(result.scrollDepth).toBe(75);
  });

  it('accepts a custom event with eventName and properties', () => {
    const result = trackerEventSchema.parse({
      ...validTrackerEvent,
      type: 'custom',
      eventName: 'signup',
      properties: { plan: 'pro', value: 99 },
    });
    expect(result.eventName).toBe('signup');
  });

  it('accepts a replay_chunk event', () => {
    const result = trackerEventSchema.parse({
      ...validTrackerEvent,
      type: 'replay_chunk',
      replayChunk: [{ type: 0, data: {} }, { type: 3, data: {} }],
    });
    expect(result.replayChunk).toHaveLength(2);
  });

  it('rejects invalid projectId (not UUID)', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, projectId: 'not-a-uuid' })
    ).toThrow();
  });

  it('rejects empty sessionId', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, sessionId: '' })
    ).toThrow();
  });

  it('rejects negative timestamp', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, timestamp: -1 })
    ).toThrow();
  });

  it('rejects invalid URL', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, url: 'not-a-url' })
    ).toThrow();
  });

  it('rejects scrollDepth > 100', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, type: 'scroll', scrollDepth: 150 })
    ).toThrow();
  });

  it('rejects scrollDepth < 0', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, type: 'scroll', scrollDepth: -5 })
    ).toThrow();
  });

  it('rejects title longer than 512 chars', () => {
    expect(() =>
      trackerEventSchema.parse({ ...validTrackerEvent, title: 'x'.repeat(513) })
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => trackerEventSchema.parse({})).toThrow();
    expect(() => trackerEventSchema.parse({ type: 'pageview' })).toThrow();
  });
});

describe('eventBatchSchema', () => {
  it('accepts a batch of 1 event', () => {
    const result = eventBatchSchema.parse([validTrackerEvent]);
    expect(result).toHaveLength(1);
  });

  it('accepts a batch at max size (50)', () => {
    const batch = Array.from({ length: 50 }, () => validTrackerEvent);
    const result = eventBatchSchema.parse(batch);
    expect(result).toHaveLength(50);
  });

  it('rejects an empty batch', () => {
    expect(() => eventBatchSchema.parse([])).toThrow();
  });

  it('rejects a batch exceeding max size', () => {
    const batch = Array.from({ length: 51 }, () => validTrackerEvent);
    expect(() => eventBatchSchema.parse(batch)).toThrow();
  });

  it('rejects a batch with invalid events', () => {
    expect(() => eventBatchSchema.parse([{ type: 'invalid' }])).toThrow();
  });
});

describe('statsQuerySchema', () => {
  it('accepts valid stats query', () => {
    const result = statsQuerySchema.parse({
      projectId: validUuid,
      dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
    });
    expect(result.projectId).toBe(validUuid);
  });

  it('accepts optional interval', () => {
    const result = statsQuerySchema.parse({
      projectId: validUuid,
      dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
      interval: 'day',
    });
    expect(result.interval).toBe('day');
  });

  it('rejects invalid interval', () => {
    expect(() =>
      statsQuerySchema.parse({
        projectId: validUuid,
        dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
        interval: 'second',
      })
    ).toThrow();
  });
});

describe('heatmapQuerySchema', () => {
  it('accepts valid heatmap query', () => {
    const result = heatmapQuerySchema.parse({
      projectId: validUuid,
      url: 'https://example.com/page',
      dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
    });
    expect(result.url).toBe('https://example.com/page');
  });

  it('accepts optional deviceType', () => {
    const result = heatmapQuerySchema.parse({
      projectId: validUuid,
      url: 'https://example.com',
      dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
      deviceType: 'mobile',
    });
    expect(result.deviceType).toBe('mobile');
  });
});

describe('sessionListQuerySchema', () => {
  it('accepts valid session list query with defaults', () => {
    const result = sessionListQuerySchema.parse({
      projectId: validUuid,
      dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
    });
    expect(result.limit).toBe(50);
  });

  it('accepts custom limit and cursor', () => {
    const result = sessionListQuerySchema.parse({
      projectId: validUuid,
      dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
      cursor: 'abc123',
      limit: 25,
    });
    expect(result.limit).toBe(25);
    expect(result.cursor).toBe('abc123');
  });

  it('rejects limit > 100', () => {
    expect(() =>
      sessionListQuerySchema.parse({
        projectId: validUuid,
        dateRange: { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z' },
        limit: 200,
      })
    ).toThrow();
  });
});

describe('replayQuerySchema', () => {
  it('accepts valid replay query', () => {
    const result = replayQuerySchema.parse({
      projectId: validUuid,
      sessionId: 'session-abc',
    });
    expect(result.sessionId).toBe('session-abc');
  });

  it('rejects empty sessionId', () => {
    expect(() =>
      replayQuerySchema.parse({ projectId: validUuid, sessionId: '' })
    ).toThrow();
  });
});

describe('createProjectSchema', () => {
  it('accepts valid project creation', () => {
    const result = createProjectSchema.parse({ name: 'My App', domain: 'myapp.com' });
    expect(result.name).toBe('My App');
  });

  it('rejects empty name', () => {
    expect(() => createProjectSchema.parse({ name: '', domain: 'myapp.com' })).toThrow();
  });

  it('rejects name longer than 128 chars', () => {
    expect(() => createProjectSchema.parse({ name: 'x'.repeat(129), domain: 'myapp.com' })).toThrow();
  });
});

describe('createApiKeySchema', () => {
  it('accepts valid API key creation', () => {
    const result = createApiKeySchema.parse({
      projectId: validUuid,
      label: 'Production',
      environment: 'live',
    });
    expect(result.environment).toBe('live');
  });

  it('rejects invalid environment', () => {
    expect(() =>
      createApiKeySchema.parse({
        projectId: validUuid,
        label: 'Test',
        environment: 'staging',
      })
    ).toThrow();
  });
});
