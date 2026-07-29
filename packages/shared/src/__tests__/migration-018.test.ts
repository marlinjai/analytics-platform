/**
 * Migration 018 — a project belongs to a COMPANY (auth-brain tenant).
 *
 * No live Postgres in CI, so we assert the migration SQL statically (same style
 * as ddl.test.ts): the two known production projects must be backfilled onto the
 * Lola Stories company, keyed on their stable workspace_ids; the column must end
 * up NOT NULL behind a fail-loud guard; and workspace_id must be left in place
 * (its removal is a separate follow-up).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(
  fileURLToPath(new URL('../migrations/018-postgres.sql', import.meta.url)),
  'utf-8',
);

// Verified ground truth (checked against prod): the two projects and their
// stable workspace_ids, both owned by the Lola Stories company.
const LOLA_STORIES_COMPANY = '019f6a89-ea4a-75d4-90ff-4e809491647e';
const LOLA_LANDING_WORKSPACE = '019ee142-44af-786d-9366-a705b7607f86';
const LOLA_WEB_WORKSPACE = '019ee142-453c-702c-9e6e-cba872eadcca';

describe('migration 018 — company_id on projects', () => {
  it('adds company_id additively', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS company_id UUID/);
  });

  it('backfills BOTH known projects onto the Lola Stories company, keyed on workspace_id', () => {
    for (const ws of [LOLA_LANDING_WORKSPACE, LOLA_WEB_WORKSPACE]) {
      // An UPDATE that sets company_id = <Lola Stories> WHERE workspace_id = <ws>.
      const stmt = new RegExp(
        String.raw`UPDATE projects\s+SET company_id = '${LOLA_STORIES_COMPANY}'\s+WHERE workspace_id = '${ws}'`,
      );
      expect(SQL).toMatch(stmt);
    }
  });

  it('keys the backfill on workspace_id, never on name or domain', () => {
    expect(SQL).not.toMatch(/WHERE\s+name\s*=/i);
    expect(SQL).not.toMatch(/WHERE\s+domain\s*=/i);
  });

  it('indexes company_id (mirrors idx_projects_workspace)', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_projects_company ON projects\(company_id\)/);
  });

  it('guards SET NOT NULL with a fail-loud RAISE EXCEPTION on any NULL company_id', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION/);
    expect(SQL).toMatch(/company_id IS NULL/);
    expect(SQL).toMatch(/ALTER COLUMN company_id SET NOT NULL/);
  });

  it('leaves projects.workspace_id in place (no DROP of it in this migration)', () => {
    expect(SQL).not.toMatch(/DROP COLUMN\s+workspace_id/i);
    expect(SQL).not.toMatch(/ALTER COLUMN workspace_id DROP NOT NULL/i);
  });
});
