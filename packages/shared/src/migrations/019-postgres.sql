-- Migration 019: retire projects.workspace_id.
--
-- The workspace-per-project ACL is gone. Migration 018 added `company_id` (the
-- auth-brain tenant a project belongs to) and every access decision now reads it:
-- the API seam, the page gate, the project list, and the GDPR erasure consumer
-- (which was repointed from `workspace_ids` to `company_id = payload.tenant_id`
-- BEFORE the vestigial workspaces were deleted, precisely so erasure would not
-- silently become a no-op).
--
-- 018 deliberately left the column in place: "retiring workspace_id is a separate
-- follow-up once no code references it." That condition now holds. A repo-wide
-- search finds no remaining read or write of `projects.workspace_id`; the only
-- surviving `workspace_id` mentions are auth-brain's own API field name (the
-- active-context body) and the published erasure payload's `workspace_ids`, which
-- other consumers still use and which is unrelated to this column.
--
-- Why drop it rather than leave it lying: the two workspaces it points at were
-- soft-deleted on 2026-07-29, so every value in this column is now a dangling
-- reference. A populated, NOT NULL, plausible-looking column is an invitation to
-- write `WHERE workspace_id = ...` and silently reinstate the model we removed.
--
-- Irreversible by design (the data is meaningless), and safe: the values are
-- recoverable from the auth-brain audit log if anyone ever needs the history.

DROP INDEX IF EXISTS idx_projects_workspace;

ALTER TABLE projects
    DROP COLUMN IF EXISTS workspace_id;
