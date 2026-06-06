-- Migration 014: Auth-brain handoff — add workspace_id, drop own auth tables.
--
-- Run AFTER scripts/migrate-to-auth-brain.ts has completed and all
-- projects.workspace_id values have been backfilled.
-- Run BEFORE deploying the new auth-brain SDK code.
--
-- This migration is intentionally two-phase within one file:
--   Phase A: add workspace_id (safe, additive)
--   Phase B: drop auth tables (destructive, only after confirming Phase A)
--
-- A NOT NULL constraint is enforced via a check so existing rows without
-- workspace_id are caught before the drop. If the migration fails here
-- it means migrate-to-auth-brain.ts did not complete cleanly.

-- Phase A: Add workspace_id to projects
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Verify every project has a workspace_id before we drop the source tables.
-- This will error and abort the migration if any project is missing it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects WHERE workspace_id IS NULL) THEN
        RAISE EXCEPTION 'Migration 014 aborted: some projects.workspace_id are NULL. '
            'Run scripts/migrate-to-auth-brain.ts to completion first.';
    END IF;
END;
$$;

-- Now enforce NOT NULL.
ALTER TABLE projects
    ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);

-- Phase B: Drop own auth tables (auth-brain owns identity from here on).
-- Order matters: foreign key dependents before the parent they reference.
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;
