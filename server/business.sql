CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','verifier','viewer')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT, created_at TEXT NOT NULL);
CREATE INDEX idx_audit_entity ON audit_events(entity,entity_id,created_at);
CREATE TABLE dictionary_types (id TEXT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE dictionary_items (
 id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES dictionary_types(id), code TEXT NOT NULL, name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), sort_order INTEGER NOT NULL DEFAULT 100,
 version INTEGER NOT NULL DEFAULT 1, work_target_type TEXT CHECK(work_target_type IN ('line','physical','both')),
 default_unit_id TEXT REFERENCES dictionary_items(id), default_quantity_milli INTEGER,
 completion_standard TEXT, fields_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL,
 UNIQUE(type_id,code), CHECK(default_quantity_milli IS NULL OR default_quantity_milli>0));
CREATE TABLE dictionary_item_versions (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES dictionary_items(id), version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, UNIQUE(item_id,version));
CREATE TABLE source_records (
 id TEXT PRIMARY KEY, type_id TEXT REFERENCES dictionary_items(id), type_snapshot TEXT, proposed_by TEXT,
 discovered_on TEXT, description TEXT, external_ref TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE demand_batches (
 id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
 version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT UNIQUE, payload_sha256 TEXT,
 source_id TEXT REFERENCES source_records(id), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE demands (
 id TEXT PRIMARY KEY, demand_no TEXT NOT NULL UNIQUE, batch_id TEXT REFERENCES demand_batches(id),
 logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id), observed_physical_tower_id TEXT REFERENCES physical_towers(id),
 line_name_snapshot TEXT NOT NULL, tower_no_snapshot TEXT NOT NULL, physical_code_snapshot TEXT,
 work_target_type TEXT NOT NULL CHECK(work_target_type IN ('line','physical')),
 operation_id TEXT NOT NULL REFERENCES dictionary_items(id), operation_version INTEGER NOT NULL, operation_snapshot TEXT NOT NULL,
 target_object TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id), unit_version INTEGER NOT NULL, unit_snapshot TEXT NOT NULL,
 completion_standard TEXT NOT NULL, problem_description TEXT NOT NULL,
 priority_id TEXT REFERENCES dictionary_items(id), priority_snapshot TEXT, expected_on TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','returned','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, confirmed_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_demands_status ON demands(status,created_at);
CREATE INDEX idx_demands_tower ON demands(logical_tower_id,operation_id,status);
CREATE TABLE demand_sources (
 demand_id TEXT NOT NULL REFERENCES demands(id), source_id TEXT NOT NULL REFERENCES source_records(id),
 PRIMARY KEY(demand_id,source_id));
CREATE TABLE demand_related_logical_towers (
 demand_id TEXT NOT NULL REFERENCES demands(id), logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id),
 PRIMARY KEY(demand_id,logical_tower_id));
CREATE TABLE demand_revisions (
 id TEXT PRIMARY KEY, demand_id TEXT NOT NULL REFERENCES demands(id), version INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
 reason TEXT NOT NULL, changed_by TEXT NOT NULL REFERENCES users(id), changed_at TEXT NOT NULL, UNIQUE(demand_id,version));
CREATE TABLE attachments (
 id TEXT PRIMARY KEY, owner_type TEXT NOT NULL CHECK(owner_type IN ('source','demand')),
 owner_id TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
 mime TEXT, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
