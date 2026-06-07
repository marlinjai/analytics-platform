import { describe, it, expect } from 'vitest';
import { parseClickHouseStatements, shouldRecordMigration } from '@/lib/run-migrations';

// Regression coverage for the breakdown-route HTTP 500.
//
// The /api/stats/browsers and /api/stats/os routes 500 with UNKNOWN_IDENTIFIER
// when the analytics.events table is missing the `browser`/`os` columns. Those
// columns are added by 002-clickhouse.sql. A prior fix renamed the migration so
// the runner picks it up, but the runner still recorded a ClickHouse migration
// as "applied" even when CLICKHOUSE_URL was unset and it never ran — so the
// columns were never added and the routes kept 500ing forever.

describe('shouldRecordMigration', () => {
  it('records Postgres migrations unconditionally (they always run)', () => {
    expect(shouldRecordMigration('002-postgres.sql', true)).toBe(true);
    expect(shouldRecordMigration('002-postgres.sql', false)).toBe(true);
  });

  it('records a ClickHouse migration only when it actually ran against ClickHouse', () => {
    expect(shouldRecordMigration('002-clickhouse.sql', true)).toBe(true);
  });

  it('does NOT record a ClickHouse migration that was skipped (CLICKHOUSE_URL unset)', () => {
    // This is the bug: recording here permanently skips the browser/os ALTER on
    // every future boot, leaving the breakdown routes 500ing.
    expect(shouldRecordMigration('002-clickhouse.sql', false)).toBe(false);
  });
});

describe('parseClickHouseStatements', () => {
  it('strips full-line comments and yields the browser/os ALTER as one statement', () => {
    const migration002 = [
      '-- Migration 002: Add browser and OS columns derived from user-agent parsing',
      '-- Run against: analytics.events',
      '',
      'ALTER TABLE analytics.events',
      "    ADD COLUMN IF NOT EXISTS browser LowCardinality(String) DEFAULT '',",
      "    ADD COLUMN IF NOT EXISTS os      LowCardinality(String) DEFAULT '';",
      '',
    ].join('\n');

    const statements = parseClickHouseStatements(migration002);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('ALTER TABLE analytics.events');
    expect(statements[0]).toContain('ADD COLUMN IF NOT EXISTS browser');
    expect(statements[0]).toContain('ADD COLUMN IF NOT EXISTS os');
    // No leading/trailing comment cruft survives.
    expect(statements[0]).not.toContain('--');
  });

  it('splits multiple semicolon-terminated statements', () => {
    const migration = [
      '-- Migration 004',
      'ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS device_model String DEFAULT \'\';',
      '',
      'ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS input_type String DEFAULT \'\';',
    ].join('\n');

    const statements = parseClickHouseStatements(migration);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('device_model');
    expect(statements[1]).toContain('input_type');
  });

  it('returns no statements for a comment-only or empty file', () => {
    expect(parseClickHouseStatements('-- just a comment\n')).toEqual([]);
    expect(parseClickHouseStatements('')).toEqual([]);
  });
});
