/**
 * Postgres DDL for the analytics platform.
 *
 * Manages: projects, API keys, users, and memberships.
 * ClickHouse handles all event data — Postgres is for config & auth only.
 */

export const CREATE_EXTENSIONS = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
`;

export const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    name        TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const CREATE_MEMBERSHIPS_TABLE = `
CREATE TABLE IF NOT EXISTS memberships (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);
`;

export const CREATE_API_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL,
    prefix      TEXT NOT NULL CHECK (prefix LIKE 'ap_live_%' OR prefix LIKE 'ap_test_%'),
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
`;

export const CREATE_TEST_LINKS_TABLE = `
CREATE TABLE IF NOT EXISTS test_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    variant     TEXT NOT NULL,
    language    TEXT NOT NULL DEFAULT 'de',
    target_url  TEXT NOT NULL,
    auto_consent BOOLEAN NOT NULL DEFAULT true,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_links_project ON test_links(project_id);
CREATE INDEX IF NOT EXISTS idx_test_links_code ON test_links(code);
`;

export const CREATE_PAGE_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS page_snapshots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    page_hash   TEXT NOT NULL,
    snapshot    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, url, page_hash)
);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_lookup
    ON page_snapshots(project_id, url);
`;

/** All DDL statements in execution order. */
export const ALL_DDL = [
  CREATE_EXTENSIONS,
  CREATE_USERS_TABLE,
  CREATE_PROJECTS_TABLE,
  CREATE_MEMBERSHIPS_TABLE,
  CREATE_API_KEYS_TABLE,
  CREATE_TEST_LINKS_TABLE,
  CREATE_PAGE_SNAPSHOTS_TABLE,
] as const;
