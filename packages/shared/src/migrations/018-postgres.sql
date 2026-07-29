-- Migration 018: a project belongs to a COMPANY (auth-brain tenant), not a
-- workspace.
--
-- Analytics used to mint one auth-brain workspace per project and use workspace
-- membership as a per-project ACL. That leaked an app domain object into the
-- identity service and did not scale. Access is now COMPANY (tenant) membership;
-- an in-app role matrix decides what a company role may do to a project.
--
-- This migration is ADDITIVE and does NOT drop workspace_id: nothing reads
-- company access yet at migration time, and retiring workspace_id is a separate
-- follow-up once no code references it. Same phased, guarded shape as 014.
--
-- Idempotent: the column add is IF NOT EXISTS, the backfill is keyed on the two
-- known (stable, exact) workspace_ids and is a no-op on re-run, and the index is
-- IF NOT EXISTS.

-- Phase A: add company_id (additive, safe).
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS company_id UUID;

-- Phase B: backfill the two production projects onto the Lola Stories company.
-- Keyed on workspace_id (their ids are stable and exact) — NOT on name/domain,
-- which are mutable. Both live projects belong to the same company.
UPDATE projects
    SET company_id = '019f6a89-ea4a-75d4-90ff-4e809491647e'
    WHERE workspace_id = '019ee142-44af-786d-9366-a705b7607f86'
      AND company_id IS NULL;

UPDATE projects
    SET company_id = '019f6a89-ea4a-75d4-90ff-4e809491647e'
    WHERE workspace_id = '019ee142-453c-702c-9e6e-cba872eadcca'
      AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);

-- Phase C: every project must resolve to a company or it is unreachable (the
-- access decision denies a NULL/unknown company_id, exactly as it does today for
-- a NULL workspace_id). Abort loudly rather than silently strand a project.
-- Same guard shape as migration 014's workspace_id SET NOT NULL.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects WHERE company_id IS NULL) THEN
        RAISE EXCEPTION 'Migration 018 aborted: some projects.company_id are NULL. '
            'Backfill each remaining project to its owning company (auth-brain '
            'tenant uuid) before this migration can SET NOT NULL.';
    END IF;
END;
$$;

ALTER TABLE projects
    ALTER COLUMN company_id SET NOT NULL;
