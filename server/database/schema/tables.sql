-- Canonical database V2 table definitions. Do not edit any generated runtime database.

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

-- Ordinary selectable dictionary values only; job operations are first-class.
CREATE TABLE dictionary_items (
 id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES dictionary_types(id), code TEXT NOT NULL, name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), sort_order INTEGER NOT NULL DEFAULT 100,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fields_json)),
 updated_at TEXT NOT NULL, UNIQUE(type_id,code), CHECK(type_id<>'operation')
);

CREATE TABLE dictionary_item_versions (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES dictionary_items(id), version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, UNIQUE(item_id,version));

-- Operations have their own identity, lifecycle and history, not a dictionary row.
CREATE TABLE operations (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(length(trim(code))>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 sort_order INTEGER NOT NULL DEFAULT 100, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 work_target_type TEXT NOT NULL CHECK(work_target_type IN ('line','physical')),
 default_unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 default_quantity_scaled INTEGER CHECK(default_quantity_scaled IS NULL OR default_quantity_scaled>0),
 completion_standard TEXT,
 fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fields_json)),
 allow_tower INTEGER NOT NULL CHECK(allow_tower IN (0,1)),
 allow_span INTEGER NOT NULL CHECK(allow_span IN (0,1)),
 default_location_kind TEXT NOT NULL CHECK(default_location_kind IN ('tower','span')),
 default_target_object TEXT NOT NULL DEFAULT '',
 entry_hint TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 CHECK(allow_tower+allow_span>=1),
 CHECK(default_location_kind='tower' AND allow_tower=1 OR default_location_kind='span' AND allow_span=1),
 CHECK(work_target_type='line' OR allow_span=0)
);

CREATE TABLE operation_versions (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 changed_by TEXT NOT NULL REFERENCES users(id),changed_at TEXT NOT NULL,
 UNIQUE(operation_id,version)
);

CREATE TABLE source_records (
 id TEXT PRIMARY KEY, type_id TEXT REFERENCES dictionary_items(id), type_snapshot TEXT, proposed_by TEXT,
 discovered_on TEXT, description TEXT, external_ref TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);

CREATE TABLE demand_batches (
 id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
 version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT UNIQUE, payload_sha256 TEXT,
 source_id TEXT REFERENCES source_records(id), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE demands (
 id TEXT PRIMARY KEY, demand_no TEXT NOT NULL UNIQUE, batch_id TEXT REFERENCES demand_batches(id),
 -- Only one locator is authoritative: tower, physical tower, or span.
 logical_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT,
 physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 observed_physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 line_name_snapshot TEXT NOT NULL, tower_no_snapshot TEXT NOT NULL, physical_code_snapshot TEXT,
 work_target_type TEXT NOT NULL CHECK(work_target_type IN ('line','physical')),
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT, operation_version INTEGER NOT NULL, operation_snapshot TEXT NOT NULL,
 target_object TEXT NOT NULL, quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id), unit_version INTEGER NOT NULL, unit_snapshot TEXT NOT NULL,
 completion_standard TEXT NOT NULL, problem_description TEXT NOT NULL,
 priority_id TEXT REFERENCES dictionary_items(id), priority_snapshot TEXT, expected_on TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','returned','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, confirmed_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, custom_fields_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_fields_json)),
 field_definitions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(field_definitions_json)),
 -- Generated only for read/UI; never user-entered or stored twice.
 location_kind TEXT GENERATED ALWAYS AS (CASE WHEN span_id IS NULL THEN 'tower' ELSE 'span' END) VIRTUAL,
 -- For a shared physical tower, the contextual line is a separate business fact
 -- used only to select voltage and reference price; it is auto-captured from UI.
 context_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 span_id TEXT REFERENCES line_spans(id) ON DELETE RESTRICT,
 span_version INTEGER, span_snapshot_json TEXT,
 CHECK((span_id IS NULL AND span_version IS NULL AND span_snapshot_json IS NULL)
    OR (span_id IS NOT NULL AND span_version>0 AND span_snapshot_json IS NOT NULL AND json_valid(span_snapshot_json))),
 CHECK(
  (work_target_type='line' AND logical_tower_id IS NOT NULL
   AND physical_tower_id IS NULL AND span_id IS NULL AND context_line_id IS NULL)
  OR
  (work_target_type='line' AND span_id IS NOT NULL
   AND logical_tower_id IS NULL AND physical_tower_id IS NULL
   AND observed_physical_tower_id IS NULL AND context_line_id IS NULL)
  OR
  (work_target_type='physical' AND physical_tower_id IS NOT NULL
   AND logical_tower_id IS NULL AND span_id IS NULL
   AND observed_physical_tower_id IS NULL)
  ),
 FOREIGN KEY(operation_id,operation_version) REFERENCES operation_versions(operation_id,version)
);

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
 id TEXT PRIMARY KEY,
 demand_id TEXT REFERENCES demands(id) ON DELETE RESTRICT,
 source_id TEXT REFERENCES source_records(id) ON DELETE RESTRICT,
 storage_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL CHECK(length(trim(filename))>0),
 mime TEXT, bytes INTEGER NOT NULL CHECK(bytes>0),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TEXT NOT NULL,
 CHECK((demand_id IS NOT NULL AND source_id IS NULL) OR
       (source_id IS NOT NULL AND demand_id IS NULL)));

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
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,framework_id)
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
 CHECK(status NOT IN ('approved','closed') OR agreement_id IS NOT NULL),
 FOREIGN KEY(agreement_id,framework_id) REFERENCES agreements(id,framework_id) ON DELETE RESTRICT
);

CREATE TABLE reference_price_catalog (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT ON DELETE RESTRICT,
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

CREATE TABLE project_settlement_entries (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,

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
