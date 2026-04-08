import { describe, it, expect } from 'vitest';
import {
  CREATE_DATABASE,
  CREATE_EVENTS_TABLE,
  CREATE_PAGEVIEWS_MV,
  CREATE_HEATMAP_SELECTORS_MV,
  CREATE_SESSIONS_MV,
  ALL_DDL,
} from '../clickhouse-ddl.js';
import {
  CREATE_EXTENSIONS,
  CREATE_USERS_TABLE,
  CREATE_PROJECTS_TABLE,
  CREATE_MEMBERSHIPS_TABLE,
  CREATE_API_KEYS_TABLE,
  CREATE_TEST_LINKS_TABLE,
  ALL_DDL as PG_ALL_DDL,
} from '../postgres-ddl.js';

describe('ClickHouse DDL', () => {
  it('CREATE_DATABASE is non-empty and creates analytics database', () => {
    expect(CREATE_DATABASE.trim()).toBeTruthy();
    expect(CREATE_DATABASE).toContain('CREATE DATABASE');
    expect(CREATE_DATABASE).toContain('analytics');
  });

  it('CREATE_EVENTS_TABLE creates the events table', () => {
    expect(CREATE_EVENTS_TABLE.trim()).toBeTruthy();
    expect(CREATE_EVENTS_TABLE).toContain('analytics.events');
    expect(CREATE_EVENTS_TABLE).toContain('MergeTree');
    expect(CREATE_EVENTS_TABLE).toContain('project_id');
    expect(CREATE_EVENTS_TABLE).toContain('session_id');
    expect(CREATE_EVENTS_TABLE).toContain('event_id');
    expect(CREATE_EVENTS_TABLE).toContain('ip_hash');
    expect(CREATE_EVENTS_TABLE).toContain('replay_chunk');
  });

  it('CREATE_PAGEVIEWS_MV creates the pageviews materialized view', () => {
    expect(CREATE_PAGEVIEWS_MV.trim()).toBeTruthy();
    expect(CREATE_PAGEVIEWS_MV).toContain('pageviews_hourly_mv');
    expect(CREATE_PAGEVIEWS_MV).toContain('SummingMergeTree');
    expect(CREATE_PAGEVIEWS_MV).toContain('pageviews');
    expect(CREATE_PAGEVIEWS_MV).toContain('visitors');
  });

  it('CREATE_SESSIONS_MV creates the sessions materialized view', () => {
    expect(CREATE_SESSIONS_MV.trim()).toBeTruthy();
    expect(CREATE_SESSIONS_MV).toContain('sessions_summary_mv');
    expect(CREATE_SESSIONS_MV).toContain('AggregatingMergeTree');
    expect(CREATE_SESSIONS_MV).toContain('started_at');
    expect(CREATE_SESSIONS_MV).toContain('ended_at');
  });

  it('ALL_DDL contains all 5 statements in order', () => {
    expect(ALL_DDL).toHaveLength(5);
    expect(ALL_DDL[0]).toBe(CREATE_DATABASE);
    expect(ALL_DDL[1]).toBe(CREATE_EVENTS_TABLE);
    expect(ALL_DDL[2]).toBe(CREATE_PAGEVIEWS_MV);
    expect(ALL_DDL[3]).toBe(CREATE_HEATMAP_SELECTORS_MV);
    expect(ALL_DDL[4]).toBe(CREATE_SESSIONS_MV);
  });
});

describe('Postgres DDL', () => {
  it('CREATE_EXTENSIONS enables pgcrypto', () => {
    expect(CREATE_EXTENSIONS.trim()).toBeTruthy();
    expect(CREATE_EXTENSIONS).toContain('pgcrypto');
  });

  it('CREATE_USERS_TABLE creates users table', () => {
    expect(CREATE_USERS_TABLE.trim()).toBeTruthy();
    expect(CREATE_USERS_TABLE).toContain('users');
    expect(CREATE_USERS_TABLE).toContain('email');
    expect(CREATE_USERS_TABLE).toContain('gen_random_uuid');
  });

  it('CREATE_PROJECTS_TABLE creates projects table', () => {
    expect(CREATE_PROJECTS_TABLE.trim()).toBeTruthy();
    expect(CREATE_PROJECTS_TABLE).toContain('projects');
    expect(CREATE_PROJECTS_TABLE).toContain('domain');
  });

  it('CREATE_MEMBERSHIPS_TABLE creates memberships table with FK constraints', () => {
    expect(CREATE_MEMBERSHIPS_TABLE.trim()).toBeTruthy();
    expect(CREATE_MEMBERSHIPS_TABLE).toContain('memberships');
    expect(CREATE_MEMBERSHIPS_TABLE).toContain('REFERENCES users');
    expect(CREATE_MEMBERSHIPS_TABLE).toContain('REFERENCES projects');
    expect(CREATE_MEMBERSHIPS_TABLE).toContain("'owner'");
    expect(CREATE_MEMBERSHIPS_TABLE).toContain("'admin'");
    expect(CREATE_MEMBERSHIPS_TABLE).toContain("'viewer'");
  });

  it('CREATE_API_KEYS_TABLE creates api_keys table with indexes', () => {
    expect(CREATE_API_KEYS_TABLE.trim()).toBeTruthy();
    expect(CREATE_API_KEYS_TABLE).toContain('api_keys');
    expect(CREATE_API_KEYS_TABLE).toContain('key_hash');
    expect(CREATE_API_KEYS_TABLE).toContain('revoked_at');
    expect(CREATE_API_KEYS_TABLE).toContain('idx_api_keys_hash');
    expect(CREATE_API_KEYS_TABLE).toContain('idx_api_keys_project');
  });

  it('PG_ALL_DDL contains all 6 statements in order', () => {
    expect(PG_ALL_DDL).toHaveLength(6);
    expect(PG_ALL_DDL[0]).toBe(CREATE_EXTENSIONS);
    expect(PG_ALL_DDL[1]).toBe(CREATE_USERS_TABLE);
    expect(PG_ALL_DDL[2]).toBe(CREATE_PROJECTS_TABLE);
    expect(PG_ALL_DDL[3]).toBe(CREATE_MEMBERSHIPS_TABLE);
    expect(PG_ALL_DDL[4]).toBe(CREATE_API_KEYS_TABLE);
    expect(PG_ALL_DDL[5]).toBe(CREATE_TEST_LINKS_TABLE);
  });
});
