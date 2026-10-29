-- Immutable project approval versions and prospective change orders.
-- This migration intentionally does not modify any existing approved scope.
CREATE TABLE project_approval_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>=1),
 snapshot_json TEXT NOT NULL,
 approved_budget_fen INTEGER NOT NULL CHECK(approved_budget_fen>=0),
 approved_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,version_no)
);
CREATE TABLE project_change_orders (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 code TEXT NOT NULL UNIQUE,
 base_approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 proposal_json TEXT NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 decided_by TEXT REFERENCES users(id),decided_at TEXT,decision_reason TEXT
);
CREATE INDEX idx_project_changes ON project_change_orders(project_id,status);
ALTER TABLE executions ADD COLUMN approval_version_id TEXT REFERENCES project_approval_versions(id);
ALTER TABLE execution_items ADD COLUMN scope_snapshot_json TEXT;
