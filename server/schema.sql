-- Canonical initial schema. All tables are created together on a fresh development database.

-- Schema and application semantics are versioned in source control, not via runtime data upgrades.

CREATE TABLE voltage_levels (
    id TEXT NOT NULL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive'))
, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), sort_order INTEGER NOT NULL DEFAULT 100, updated_at TEXT);

CREATE TABLE transmission_lines (
    id TEXT NOT NULL PRIMARY KEY,
    line_code TEXT NOT NULL UNIQUE CHECK (length(trim(line_code)) > 0),
    voltage_level_id TEXT NOT NULL REFERENCES voltage_levels(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, line_kind TEXT NOT NULL DEFAULT 'main' CHECK(line_kind IN ('main','branch')), parent_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT, junction_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT, setup_status TEXT NOT NULL DEFAULT 'ready' CHECK(setup_status IN ('draft','ready')), erection_type TEXT NOT NULL DEFAULT '');

CREATE TABLE physical_towers (
    id TEXT NOT NULL PRIMARY KEY,
    tower_code TEXT NOT NULL UNIQUE CHECK (length(trim(tower_code)) > 0),
    asset_no TEXT,
    tower_type TEXT,
    longitude REAL,
    latitude REAL,
    commissioned_on TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'retired')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), model TEXT NOT NULL DEFAULT '', height_scaled INTEGER CHECK(height_scaled IS NULL OR height_scaled>0), purpose TEXT NOT NULL DEFAULT '',
    CHECK (
        (longitude IS NULL AND latitude IS NULL)
        OR (longitude IS NOT NULL AND latitude IS NOT NULL
            AND longitude BETWEEN -180 AND 180
            AND latitude BETWEEN -90 AND 90)
    )
);

CREATE TABLE logical_towers (
    id TEXT NOT NULL PRIMARY KEY,
    logical_code TEXT NOT NULL UNIQUE CHECK (length(trim(logical_code)) > 0),
    line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
    physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
    tower_no TEXT NOT NULL CHECK (length(trim(tower_no)) > 0),
    display_name TEXT,
    sort_rank INTEGER NOT NULL CHECK (sort_rank > 0),
    circuit_position TEXT,
    management_department TEXT NOT NULL DEFAULT '',
    maintenance_team TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'inactive')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (status <> 'active' OR physical_tower_id IS NOT NULL)
);

CREATE TABLE line_source_aliases (
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 source_name TEXT NOT NULL,
 source_kind TEXT NOT NULL,
 PRIMARY KEY(line_id,source_name,source_kind)
);
CREATE TABLE pms_import_issues (
 id TEXT PRIMARY KEY,
 entity_type TEXT NOT NULL,
 source_name TEXT NOT NULL,
 source_row INTEGER NOT NULL,
 issue TEXT NOT NULL,
 details_json TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(entity_type,source_name,source_row,issue)
);
CREATE TABLE pms_import_runs (
 id TEXT PRIMARY KEY,
 source_fingerprint TEXT NOT NULL UNIQUE,
 source_description TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);

CREATE TABLE line_name_history (
    id TEXT NOT NULL PRIMARY KEY,
    line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    changed_by TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (line_id, valid_from)
);

CREATE TABLE logical_tower_name_history (
    id TEXT NOT NULL PRIMARY KEY,
    logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
    tower_no TEXT NOT NULL CHECK (length(trim(tower_no)) > 0),
    display_name TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    changed_by TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (logical_tower_id, valid_from)
);

CREATE TABLE logical_tower_physical_history (
    id TEXT NOT NULL PRIMARY KEY,
    logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
    physical_tower_id TEXT NOT NULL REFERENCES physical_towers(id) ON DELETE RESTRICT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    change_kind TEXT NOT NULL
        CHECK (change_kind IN ('initial', 'correction', 'replacement')),
    changed_by TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (logical_tower_id, valid_from)
);

CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','verifier','viewer')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL);

CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT, created_at TEXT NOT NULL);

CREATE TABLE dictionary_types (id TEXT PRIMARY KEY, title TEXT NOT NULL);

CREATE TABLE dictionary_items (
 id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES dictionary_types(id), code TEXT NOT NULL, name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), sort_order INTEGER NOT NULL DEFAULT 100,
 version INTEGER NOT NULL DEFAULT 1, work_target_type TEXT CHECK(work_target_type IN ('line','physical','both')),
 default_unit_id TEXT REFERENCES dictionary_items(id), default_quantity_scaled INTEGER,
 completion_standard TEXT, fields_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL,
 UNIQUE(type_id,code), CHECK(default_quantity_scaled IS NULL OR default_quantity_scaled>0));

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
 target_object TEXT NOT NULL, quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id), unit_version INTEGER NOT NULL, unit_snapshot TEXT NOT NULL,
 completion_standard TEXT NOT NULL, problem_description TEXT NOT NULL,
 priority_id TEXT REFERENCES dictionary_items(id), priority_snapshot TEXT, expected_on TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','returned','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, confirmed_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, custom_fields_json TEXT NOT NULL DEFAULT '{}', field_definitions_json TEXT NOT NULL DEFAULT '[]', location_kind TEXT NOT NULL DEFAULT 'tower' CHECK(location_kind IN ('tower','span')), location_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT, span_id TEXT REFERENCES line_spans(id) ON DELETE RESTRICT, span_version INTEGER, span_snapshot_json TEXT);

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

CREATE TABLE allowed_ips (
 id TEXT PRIMARY KEY, ip TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL
);

CREATE TABLE frameworks (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 fiscal_year INTEGER NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2100),
 limit_fen INTEGER NOT NULL CHECK(limit_fen>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE agreements (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
 framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, limit_fen INTEGER NOT NULL CHECK(limit_fen>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE projects (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
 agreement_id TEXT REFERENCES agreements(id) ON DELETE RESTRICT,
 category_id TEXT REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'reserve' CHECK(status IN ('reserve','stocked','approved','closed')),
 version INTEGER NOT NULL DEFAULT 1,
 estimate_fen INTEGER, approved_budget_fen INTEGER,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, preliminary_estimate_fen INTEGER
 CHECK(preliminary_estimate_fen IS NULL OR preliminary_estimate_fen>0), preliminary_estimate_basis TEXT, preliminary_estimate_at TEXT, preliminary_estimate_by TEXT REFERENCES users(id),
 CHECK(estimate_fen IS NULL OR estimate_fen>=0),
 CHECK(approved_budget_fen IS NULL OR approved_budget_fen>=0),
 CHECK(status NOT IN ('approved','closed') OR agreement_id IS NOT NULL)
);

-- Reference prices are advisory estimates, never authoritative settlement tariffs.
-- Catalog identity is stable; each quote revision is immutable evidence.
CREATE TABLE reference_price_catalog (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 voltage_level_id TEXT REFERENCES voltage_levels(id) ON DELETE RESTRICT,
 plan_type TEXT NOT NULL CHECK(plan_type IN ('outage','non_outage','both')),
 specification TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE reference_price_versions (
 id TEXT PRIMARY KEY,
 catalog_id TEXT NOT NULL REFERENCES reference_price_catalog(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 unit_price_fen INTEGER NOT NULL CHECK(unit_price_fen>0),
 price_source TEXT NOT NULL, price_date TEXT NOT NULL,
 tax_mode TEXT NOT NULL CHECK(tax_mode IN ('inclusive','exclusive','none')),
 effective_on TEXT NOT NULL, basis TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 UNIQUE(catalog_id,version_no)
);

CREATE TABLE project_demand_scopes (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 demand_version INTEGER NOT NULL CHECK(demand_version>0),
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 unit_price_fen INTEGER CHECK(unit_price_fen>=0),
 price_source TEXT,
 price_date TEXT,
 tax_mode TEXT CHECK(tax_mode IN ('inclusive','exclusive','none')),
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demand_snapshot_json TEXT,
 reference_price_version_id TEXT REFERENCES reference_price_versions(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
 UNIQUE(project_id,demand_id)
);

CREATE TABLE project_stage_events (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 stage TEXT NOT NULL CHECK(stage IN ('stocked','approved')),
 project_version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL,
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 UNIQUE(project_id,stage)
);

CREATE TABLE executions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 number TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 plan_type TEXT NOT NULL CHECK(plan_type IN ('outage','non_outage')),
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','finished','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, planned_on TEXT,
 started_at TEXT, finished_at TEXT, close_reason TEXT,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approval_version_id TEXT REFERENCES project_approval_versions(id),
 UNIQUE(project_id,number)
);

CREATE TABLE execution_items (
 id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 planned_quantity_scaled INTEGER NOT NULL CHECK(planned_quantity_scaled>0),
 actual_physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL, scope_snapshot_json TEXT, UNIQUE(execution_id,project_scope_id)
);

CREATE TABLE completion_records (
 id TEXT PRIMARY KEY, execution_item_id TEXT NOT NULL REFERENCES execution_items(id) ON DELETE RESTRICT,
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 occurred_on TEXT NOT NULL, evidence TEXT NOT NULL, confirmed_by TEXT NOT NULL REFERENCES users(id),
 confirmed_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL
);

CREATE TABLE line_spans (
 id TEXT PRIMARY KEY,
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 start_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 end_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 -- No persisted length: derive from endpoint coordinate pairs at query time.
 status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(start_tower_id<>end_tower_id)
);

CREATE TABLE ledger_requests (
 request_key TEXT PRIMARY KEY,actor_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);

CREATE TABLE demand_duplicate_reviews (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES demand_batches(id) ON DELETE RESTRICT,
 matched_demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 new_demand_id TEXT REFERENCES demands(id) ON DELETE RESTRICT,
 decision TEXT NOT NULL CHECK(decision IN ('separate','link')),
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL
);

CREATE TABLE batch_demand_sources (
 batch_id TEXT NOT NULL REFERENCES demand_batches(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 source_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 PRIMARY KEY(batch_id,demand_id,source_id)
);

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

CREATE INDEX idx_lines_voltage ON transmission_lines(voltage_level_id);

CREATE INDEX idx_logical_towers_physical ON logical_towers(physical_tower_id);

CREATE INDEX idx_logical_towers_name ON logical_towers(line_id, tower_no);

CREATE UNIQUE INDEX uq_logical_towers_active_order
    ON logical_towers(line_id, sort_rank) WHERE status = 'active';

CREATE UNIQUE INDEX uq_line_name_current
    ON line_name_history(line_id) WHERE valid_to IS NULL;

CREATE UNIQUE INDEX uq_logical_name_current
    ON logical_tower_name_history(logical_tower_id) WHERE valid_to IS NULL;

CREATE UNIQUE INDEX uq_logical_physical_current
    ON logical_tower_physical_history(logical_tower_id) WHERE valid_to IS NULL;

CREATE INDEX idx_physical_history_lookup
    ON logical_tower_physical_history(physical_tower_id, valid_from, valid_to);

CREATE INDEX idx_audit_entity ON audit_events(entity,entity_id,created_at);

CREATE INDEX idx_demands_status ON demands(status,created_at);

CREATE INDEX idx_demands_tower ON demands(logical_tower_id,operation_id,status);

CREATE INDEX idx_agreement_framework ON agreements(framework_id);

CREATE INDEX idx_projects_agreement ON projects(agreement_id,status);
CREATE INDEX idx_projects_framework ON projects(framework_id,status);
CREATE INDEX idx_executions_plan_type ON executions(project_id,plan_type,status);

CREATE INDEX idx_reference_catalog_operation ON reference_price_catalog(operation_id,unit_id,status);
CREATE INDEX idx_reference_scope_version ON project_demand_scopes(reference_price_version_id);

CREATE INDEX idx_project_scope_demand ON project_demand_scopes(demand_id);

CREATE INDEX idx_execution_project ON executions(project_id,status);

CREATE INDEX idx_execution_scope ON execution_items(project_scope_id);

CREATE INDEX idx_completion_item ON completion_records(execution_item_id);

CREATE INDEX idx_line_parent ON transmission_lines(parent_line_id);

CREATE UNIQUE INDEX uq_current_span_pair ON line_spans(line_id,min(start_tower_id,end_tower_id),max(start_tower_id,end_tower_id)) WHERE status<>'retired';

CREATE INDEX idx_span_end ON line_spans(end_tower_id);

CREATE INDEX idx_span_start ON line_spans(start_tower_id);

CREATE INDEX idx_demand_location_line ON demands(location_line_id);

CREATE INDEX idx_demand_span ON demands(span_id);

CREATE INDEX idx_duplicate_review_batch ON demand_duplicate_reviews(batch_id);

CREATE INDEX idx_project_changes ON project_change_orders(project_id,status);

CREATE TRIGGER immutable_reference_price_update BEFORE UPDATE ON reference_price_versions
 BEGIN SELECT RAISE(ABORT,'历史参考单价版本不可修改'); END;
CREATE TRIGGER immutable_reference_price_delete BEFORE DELETE ON reference_price_versions
 BEGIN SELECT RAISE(ABORT,'历史参考单价版本不可删除'); END;

CREATE TRIGGER frozen_scope_snapshot BEFORE UPDATE OF demand_snapshot_json ON project_demand_scopes
 WHEN (SELECT status FROM projects WHERE id=OLD.project_id)!='reserve' AND NEW.demand_snapshot_json IS NOT OLD.demand_snapshot_json
 BEGIN SELECT RAISE(ABORT,'入库需求快照不可改写'); END;

CREATE TRIGGER valid_branch_insert BEFORE INSERT ON transmission_lines BEGIN
 SELECT CASE WHEN NEW.line_kind='main' AND (NEW.parent_line_id IS NOT NULL OR NEW.junction_tower_id IS NOT NULL) THEN RAISE(ABORT,'主线不能设置上级线路或接入杆塔') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND (NEW.parent_line_id IS NULL AND NEW.setup_status<>'draft' OR NEW.parent_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transmission_lines WHERE id=NEW.parent_line_id AND line_kind='main')) THEN RAISE(ABORT,'支线必须归属主线') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NEW.status='active' AND NEW.setup_status='ready' AND NOT EXISTS(SELECT 1 FROM logical_towers WHERE id=NEW.junction_tower_id AND line_id=NEW.parent_line_id AND status='active') THEN RAISE(ABORT,'支线接入杆塔无效') END;
END;

CREATE TRIGGER valid_branch_update BEFORE UPDATE ON transmission_lines BEGIN
 SELECT CASE WHEN NEW.line_kind='main' AND (NEW.parent_line_id IS NOT NULL OR NEW.junction_tower_id IS NOT NULL) THEN RAISE(ABORT,'主线不能设置上级线路或接入杆塔') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND (NEW.parent_line_id IS NULL AND NEW.setup_status<>'draft' OR NEW.parent_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transmission_lines WHERE id=NEW.parent_line_id AND line_kind='main' AND id<>NEW.id)) THEN RAISE(ABORT,'支线必须归属主线') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NEW.status='active' AND NEW.setup_status='ready' AND NOT EXISTS(SELECT 1 FROM logical_towers WHERE id=NEW.junction_tower_id AND line_id=NEW.parent_line_id AND status='active') THEN RAISE(ABORT,'支线接入杆塔无效') END;
END;

-- Approved versions and confirmed execution facts are append-only business evidence.
CREATE TRIGGER immutable_approval_version_update
BEFORE UPDATE ON project_approval_versions
BEGIN SELECT RAISE(ABORT,'已批准版本不可修改'); END;

CREATE TRIGGER immutable_approval_version_delete
BEFORE DELETE ON project_approval_versions
BEGIN SELECT RAISE(ABORT,'已批准版本不可删除'); END;

CREATE TRIGGER immutable_completion_update
BEFORE UPDATE ON completion_records
BEGIN SELECT RAISE(ABORT,'实际完成记录不可覆盖，请走冲销流程'); END;

CREATE TRIGGER immutable_completion_delete
BEFORE DELETE ON completion_records
BEGIN SELECT RAISE(ABORT,'实际完成记录不可删除'); END;

CREATE TRIGGER immutable_audit_update
BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'审计事件不可覆盖'); END;

CREATE TRIGGER immutable_audit_delete
BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'审计事件不可删除'); END;

-- Explicit settlement facts: independent of work completion and never inferred from a plan.
-- Positive payment and compensating reversal are append-only. Financial approval
-- remains an external process: this module records documented results only.
CREATE TABLE project_settlement_entries (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 -- NULL means project-level payment that has not been explicitly allocated to a maintenance plan.
 execution_item_id TEXT REFERENCES execution_items(id) ON DELETE RESTRICT,
 settlement_no TEXT NOT NULL UNIQUE,
 entry_kind TEXT NOT NULL CHECK(entry_kind IN ('payment','reversal')),
 settlement_type TEXT CHECK(settlement_type IN ('advance','progress','final')),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
 reversal_of TEXT REFERENCES project_settlement_entries(id) ON DELETE RESTRICT,
 occurred_on TEXT NOT NULL,
 evidence TEXT NOT NULL,
 recorded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 CHECK((entry_kind='payment' AND reversal_of IS NULL AND settlement_type IS NOT NULL)
       OR (entry_kind='reversal' AND reversal_of IS NOT NULL AND settlement_type IS NULL))
);
CREATE INDEX idx_settlement_project ON project_settlement_entries(project_id,occurred_on);
CREATE INDEX idx_settlement_scope ON project_settlement_entries(project_scope_id);
CREATE INDEX idx_settlement_execution_item ON project_settlement_entries(execution_item_id,occurred_on);
CREATE INDEX idx_settlement_reverse ON project_settlement_entries(reversal_of);

CREATE TRIGGER immutable_settlement_update
BEFORE UPDATE ON project_settlement_entries
BEGIN SELECT RAISE(ABORT,'原始结算事实不可修改，请通过凭证更正处理'); END;
CREATE TRIGGER immutable_settlement_delete
BEFORE DELETE ON project_settlement_entries
BEGIN SELECT RAISE(ABORT,'原始结算事实不可删除，请通过凭证撤销处理'); END;

-- R01: append-only maintenance of voucher facts. Original ownership never changes.
CREATE TABLE settlement_commands (
 id TEXT PRIMARY KEY,
 request_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES project_settlement_entries(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('correct','void')),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE settlement_revisions (
 id TEXT PRIMARY KEY,
 entry_id TEXT NOT NULL REFERENCES project_settlement_entries(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=2),
 command_id TEXT NOT NULL REFERENCES settlement_commands(id) DEFERRABLE INITIALLY DEFERRED,
 action TEXT NOT NULL CHECK(action IN ('correct','void')),
 status TEXT NOT NULL CHECK(status IN ('active','voided')),
 settlement_no TEXT NOT NULL,
 settlement_type TEXT CHECK(settlement_type IN ('advance','progress','final')),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
 occurred_on TEXT NOT NULL,
 evidence TEXT NOT NULL,
 reason TEXT NOT NULL,
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at TEXT NOT NULL,
 UNIQUE(entry_id,version),
 CHECK((action='correct' AND status='active') OR (action='void' AND status='voided'))
);
CREATE INDEX idx_settlement_revision_number ON settlement_revisions(settlement_no);
CREATE TRIGGER immutable_settlement_revision_update BEFORE UPDATE ON settlement_revisions
BEGIN SELECT RAISE(ABORT,'凭证更正历史不可修改'); END;
CREATE TRIGGER immutable_settlement_revision_delete BEFORE DELETE ON settlement_revisions
BEGIN SELECT RAISE(ABORT,'凭证更正历史不可删除'); END;
CREATE TRIGGER immutable_settlement_command_update BEFORE UPDATE ON settlement_commands
BEGIN SELECT RAISE(ABORT,'凭证操作历史不可修改'); END;
CREATE TRIGGER immutable_settlement_command_delete BEFORE DELETE ON settlement_commands
BEGIN SELECT RAISE(ABORT,'凭证操作历史不可删除'); END;
CREATE VIEW settlement_current AS
SELECT e.id,e.project_id,e.project_scope_id,e.approval_version_id,e.execution_item_id,
 e.entry_kind,e.reversal_of,e.recorded_by,e.created_at,
 COALESCE(r.version,1) AS version,COALESCE(r.status,'active') AS status,
 COALESCE(r.settlement_no,e.settlement_no) AS settlement_no,
 CASE WHEN r.id IS NULL THEN e.settlement_type ELSE r.settlement_type END AS settlement_type,
 COALESCE(r.amount_fen,e.amount_fen) AS amount_fen,
 COALESCE(r.occurred_on,e.occurred_on) AS occurred_on,
 COALESCE(r.evidence,e.evidence) AS evidence,
 COALESCE(r.changed_at,e.created_at) AS updated_at
FROM project_settlement_entries e LEFT JOIN settlement_revisions r
 ON r.entry_id=e.id AND r.version=(SELECT MAX(v.version) FROM settlement_revisions v WHERE v.entry_id=e.id);
-- Single accounting projection used by all limits and management rollups.
CREATE VIEW effective_settlement_entries AS SELECT * FROM settlement_current WHERE status='active';

-- Explicitly confirmed plan allocations; estimates, settlements and payments remain separate.
CREATE TABLE plan_budget_drafts (
 id TEXT PRIMARY KEY,
 execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('set','release')),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
 basis TEXT NOT NULL CHECK(length(trim(basis))>0),
 base_budget_version INTEGER NOT NULL CHECK(base_budget_version>=0),
 project_approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 status TEXT NOT NULL CHECK(status IN ('draft','confirmed','deleted')),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL,
 CHECK((kind='set' AND amount_fen>0) OR (kind='release' AND amount_fen=0))
);
CREATE INDEX idx_plan_budget_drafts_plan ON plan_budget_drafts(execution_id,status);
CREATE TRIGGER immutable_confirmed_budget_draft BEFORE UPDATE ON plan_budget_drafts
WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'已确认或已删除的预算草稿保留历史，请另建调整草稿'); END;
CREATE TRIGGER preserve_budget_draft_delete BEFORE DELETE ON plan_budget_drafts
BEGIN SELECT RAISE(ABORT,'预算草稿请通过删除流程处理'); END;
CREATE TABLE plan_budget_versions (
 id TEXT PRIMARY KEY,
 execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
 proposal_id TEXT NOT NULL UNIQUE REFERENCES plan_budget_drafts(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 kind TEXT NOT NULL CHECK(kind IN ('set','release')),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
 previous_amount_fen INTEGER,
 basis TEXT NOT NULL,
 project_approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 project_budget_fen INTEGER NOT NULL,
 confirmed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 confirmed_at TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 UNIQUE(execution_id,version_no),
 CHECK((kind='set' AND amount_fen>0) OR (kind='release' AND amount_fen=0))
);
CREATE TRIGGER immutable_plan_budget_version_update BEFORE UPDATE ON plan_budget_versions
BEGIN SELECT RAISE(ABORT,'预算核定历史不可覆盖，请编制调整草稿'); END;
CREATE TRIGGER immutable_plan_budget_version_delete BEFORE DELETE ON plan_budget_versions
BEGIN SELECT RAISE(ABORT,'预算核定历史不可清除，请明确撤销当前预算'); END;
CREATE VIEW plan_budget_current AS SELECT v.* FROM plan_budget_versions v
 WHERE v.version_no=(SELECT MAX(h.version_no) FROM plan_budget_versions h WHERE h.execution_id=v.execution_id);

-- R02: preserve original implementation confirmations and append their corrections.
CREATE TABLE completion_commands (
 id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES completion_records(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('correct','void')),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE completion_revisions (
 id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES completion_records(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=2),
 command_id TEXT NOT NULL REFERENCES completion_commands(id) DEFERRABLE INITIALLY DEFERRED,
 action TEXT NOT NULL CHECK(action IN ('correct','void')),
 status TEXT NOT NULL CHECK(status IN ('active','voided')),
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),occurred_on TEXT NOT NULL,evidence TEXT NOT NULL,
 reason TEXT NOT NULL,changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,changed_at TEXT NOT NULL,
 UNIQUE(record_id,version),CHECK((action='correct' AND status='active') OR (action='void' AND status='voided'))
);
CREATE TRIGGER immutable_completion_revision_update BEFORE UPDATE ON completion_revisions
BEGIN SELECT RAISE(ABORT,'完成记录更正历史不可覆盖'); END;
CREATE TRIGGER immutable_completion_revision_delete BEFORE DELETE ON completion_revisions
BEGIN SELECT RAISE(ABORT,'完成记录更正历史不可清除'); END;
CREATE TRIGGER immutable_completion_command_update BEFORE UPDATE ON completion_commands
BEGIN SELECT RAISE(ABORT,'完成记录处理历史不可覆盖'); END;
CREATE TRIGGER immutable_completion_command_delete BEFORE DELETE ON completion_commands
BEGIN SELECT RAISE(ABORT,'完成记录处理历史不可清除'); END;
CREATE VIEW completion_current AS
SELECT c.id,c.execution_item_id,c.confirmed_by,c.confirmed_at,c.idempotency_key,c.payload_hash,
 COALESCE(r.version,1) AS version,COALESCE(r.status,'active') AS status,
 COALESCE(r.quantity_scaled,c.quantity_scaled) AS quantity_scaled,
 COALESCE(r.occurred_on,c.occurred_on) AS occurred_on,COALESCE(r.evidence,c.evidence) AS evidence,
 COALESCE(r.changed_at,c.confirmed_at) AS updated_at
FROM completion_records c LEFT JOIN completion_revisions r
 ON r.record_id=c.id AND r.version=(SELECT MAX(h.version) FROM completion_revisions h WHERE h.record_id=c.id);
CREATE VIEW effective_completion_records AS SELECT * FROM completion_current WHERE status='active';

-- Confirmed actual costs are independent of budget allocations and settlements.
CREATE TABLE cost_entries (
 id TEXT PRIMARY KEY,execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,created_at TEXT NOT NULL
);
CREATE TABLE cost_drafts (
 id TEXT PRIMARY KEY,execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
 entry_id TEXT REFERENCES cost_entries(id) ON DELETE RESTRICT,base_version INTEGER NOT NULL CHECK(base_version>=0),
 kind TEXT NOT NULL CHECK(kind IN ('record','void')),category_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 name TEXT NOT NULL,occurred_on TEXT NOT NULL,amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
 evidence TEXT NOT NULL,reason TEXT NOT NULL,allocations_json TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),status TEXT NOT NULL CHECK(status IN ('draft','confirmed','deleted')),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,created_at TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,updated_at TEXT NOT NULL
);
CREATE INDEX idx_cost_drafts_plan ON cost_drafts(execution_id,status);
CREATE TRIGGER immutable_cost_draft_update BEFORE UPDATE ON cost_drafts WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'已确认或已删除的费用草稿不可覆盖'); END;
CREATE TRIGGER preserve_cost_draft_delete BEFORE DELETE ON cost_drafts
BEGIN SELECT RAISE(ABORT,'费用草稿请通过删除流程处理'); END;
CREATE TABLE cost_versions (
 id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES cost_entries(id) ON DELETE RESTRICT,
 draft_id TEXT NOT NULL UNIQUE REFERENCES cost_drafts(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),status TEXT NOT NULL CHECK(status IN ('active','voided')),
 category_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,category_snapshot_json TEXT NOT NULL,
 name TEXT NOT NULL,occurred_on TEXT NOT NULL,amount_fen INTEGER NOT NULL CHECK(amount_fen>0),evidence TEXT NOT NULL,reason TEXT NOT NULL,
 confirmed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,confirmed_at TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,UNIQUE(entry_id,version_no)
);
CREATE TABLE cost_allocations (
 id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES cost_versions(id) ON DELETE RESTRICT,
 execution_item_id TEXT NOT NULL REFERENCES execution_items(id) ON DELETE RESTRICT,
 amount_fen INTEGER NOT NULL CHECK(amount_fen>0),UNIQUE(version_id,execution_item_id)
);
CREATE TRIGGER immutable_cost_version_update BEFORE UPDATE ON cost_versions
BEGIN SELECT RAISE(ABORT,'已确认费用不可覆盖，请编制更正草稿'); END;
CREATE TRIGGER immutable_cost_version_delete BEFORE DELETE ON cost_versions
BEGIN SELECT RAISE(ABORT,'已确认费用不可清除，请明确撤销'); END;
CREATE TRIGGER immutable_cost_allocation_update BEFORE UPDATE ON cost_allocations
BEGIN SELECT RAISE(ABORT,'历史费用分摊不可覆盖'); END;
CREATE TRIGGER immutable_cost_allocation_delete BEFORE DELETE ON cost_allocations
BEGIN SELECT RAISE(ABORT,'历史费用分摊不可清除'); END;
CREATE VIEW cost_current AS SELECT v.*,e.execution_id FROM cost_versions v JOIN cost_entries e ON e.id=v.entry_id
 WHERE v.version_no=(SELECT MAX(h.version_no) FROM cost_versions h WHERE h.entry_id=v.entry_id);
CREATE VIEW effective_cost_allocations AS SELECT a.*,v.entry_id,v.execution_id FROM cost_allocations a
 JOIN cost_current v ON v.id=a.version_id WHERE v.status='active';
CREATE TABLE cost_reconciliation_versions (
 id TEXT PRIMARY KEY,record_id TEXT NOT NULL,version_no INTEGER NOT NULL CHECK(version_no>0),
 status TEXT NOT NULL CHECK(status IN ('active','voided')),
 cost_entry_id TEXT NOT NULL REFERENCES cost_entries(id) ON DELETE RESTRICT,
 cost_version_id TEXT NOT NULL REFERENCES cost_versions(id) ON DELETE RESTRICT,
 settlement_entry_id TEXT NOT NULL REFERENCES project_settlement_entries(id) ON DELETE RESTRICT,
 settlement_version INTEGER NOT NULL CHECK(settlement_version>0),
 execution_item_id TEXT NOT NULL REFERENCES execution_items(id) ON DELETE RESTRICT,
 expense_amount_fen INTEGER NOT NULL CHECK(expense_amount_fen>0),settled_amount_fen INTEGER NOT NULL CHECK(settled_amount_fen>=0),
 is_final INTEGER NOT NULL CHECK(is_final IN (0,1)),evidence TEXT NOT NULL,
 confirmed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,confirmed_at TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,UNIQUE(record_id,version_no)
);
CREATE INDEX idx_cost_match_entry ON cost_reconciliation_versions(cost_entry_id);
CREATE INDEX idx_cost_match_settlement ON cost_reconciliation_versions(settlement_entry_id);
CREATE TRIGGER immutable_cost_reconciliation_update BEFORE UPDATE ON cost_reconciliation_versions
BEGIN SELECT RAISE(ABORT,'费用结算核对历史不可覆盖'); END;
CREATE TRIGGER immutable_cost_reconciliation_delete BEFORE DELETE ON cost_reconciliation_versions
BEGIN SELECT RAISE(ABORT,'费用结算核对历史不可清除'); END;
CREATE VIEW cost_reconciliation_current AS SELECT v.* FROM cost_reconciliation_versions v
 WHERE v.version_no=(SELECT MAX(h.version_no) FROM cost_reconciliation_versions h WHERE h.record_id=v.record_id);
