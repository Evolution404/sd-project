-- One approved project can contain many independent execution batches.
CREATE TABLE executions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 number TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','finished','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, planned_on TEXT,
 started_at TEXT, finished_at TEXT, close_reason TEXT,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,number)
);
CREATE INDEX idx_execution_project ON executions(project_id,status);
CREATE TABLE execution_items (
 id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 planned_quantity_milli INTEGER NOT NULL CHECK(planned_quantity_milli>0),
 actual_physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL, UNIQUE(execution_id,project_scope_id)
);
CREATE INDEX idx_execution_scope ON execution_items(project_scope_id);
CREATE TABLE completion_records (
 id TEXT PRIMARY KEY, execution_item_id TEXT NOT NULL REFERENCES execution_items(id) ON DELETE RESTRICT,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 occurred_on TEXT NOT NULL, evidence TEXT NOT NULL, confirmed_by TEXT NOT NULL REFERENCES users(id),
 confirmed_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL
);
CREATE INDEX idx_completion_item ON completion_records(execution_item_id);
