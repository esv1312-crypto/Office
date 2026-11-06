-- Organization identity and membership boundary for Studio control-plane access.
-- Apply after migrations 001-005 to a dedicated Studio database only.
-- Identity-provider subject IDs are stored as actor_id; this migration does not
-- create users, sessions, passwords, or authenticate requests.

CREATE TABLE IF NOT EXISTS studio.organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio.organization_memberships (
  organization_id TEXT NOT NULL REFERENCES studio.organizations(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'observer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, actor_id)
);

CREATE INDEX IF NOT EXISTS studio_memberships_actor_status_idx
  ON studio.organization_memberships(actor_id, status, organization_id);

ALTER TABLE studio.projects
  ADD CONSTRAINT studio_projects_organization_fk
  FOREIGN KEY (organization_id) REFERENCES studio.organizations(id) ON DELETE RESTRICT;

ALTER TABLE studio.specialists
  ADD CONSTRAINT studio_specialists_organization_fk
  FOREIGN KEY (organization_id) REFERENCES studio.organizations(id) ON DELETE RESTRICT;
