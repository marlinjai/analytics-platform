-- Migration 014: Auth-brain handoff. Add workspace_id, drop own-identity tables.
--
-- Run AFTER packages/dashboard/scripts/migrate-to-auth-brain.mjs has completed and
-- every projects.workspace_id is backfilled. Safe to run at the cutover deploy boot.
--
-- Two phases in one file:
--   Phase A: add workspace_id (additive, safe)
--   Phase B: hand identity to auth-brain (drop the NextAuth / own-identity tables)
--
-- Idempotent: every drop is IF EXISTS and the FK removal is guarded, so a re-run is
-- a no-op. account_api_keys is PRESERVED (its keys carry live integrations such as
-- lola-stories): only its FK to the dropped users table is removed. The key owner's
-- user_id is remapped to the auth-brain user id by the operator / migration script
-- (a data step, environment-specific), NOT here.

-- Phase A: Add workspace_id to projects
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Every project must have a workspace_id before we drop the source tables.
-- Aborts (and rolls back) if the migration script has not completed.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects WHERE workspace_id IS NULL) THEN
        RAISE EXCEPTION 'Migration 014 aborted: some projects.workspace_id are NULL. '
            'Run packages/dashboard/scripts/migrate-to-auth-brain.mjs to completion first.';
    END IF;
END;
$$;

ALTER TABLE projects
    ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);

-- Phase B: auth-brain owns identity from here on.
-- Preserve account_api_keys (live keys) by removing ONLY their FK to users, so the
-- DROP TABLE users below cannot fail and the keys survive the cutover.
DO $$
DECLARE fk text;
BEGIN
    FOR fk IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'account_api_keys'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'users'
    LOOP
        EXECUTE format('ALTER TABLE account_api_keys DROP CONSTRAINT %I', fk);
    END LOOP;
END;
$$;

-- Drop the NextAuth / own-identity tables (FK-order: dependents before users).
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS cli_device_codes;
DROP TABLE IF EXISTS verification_tokens;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;
