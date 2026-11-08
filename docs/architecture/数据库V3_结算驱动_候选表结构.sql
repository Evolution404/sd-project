-- PROPOSED DATABASE DESIGN ONLY, not the running Schema 112.
-- Target: Schema 113 (full immutable settlement history candidate).
-- Stable settlement business identity, whole-document snapshots, versioned
-- details, audit events and current/as-of history views.
-- No frontend/backend changes are authorized.
-- Main stable chain: annual framework -> project -> approved project scope
-- and full immutable management/profile history -> independent real cost facts
-- -> separately approved installment settlements -> audited reconciliations.
-- No independent material issue/return, work-completion, or parallel
-- cost-allocation ledger. Cost facts may exist before any settlement document.
-- Money is integer fen, quantity integer scaled by 10000.
-- Maintenance plan and plan budget entity layers deliberately absent.
-- Each span stores ONLY transmission-center custody length; NULL means unknown.
-- Database role is persistent facts and integrity; application role is workflow,
-- permissions, metrics, forecasting, alerts and visualization.
PRAGMA user_version=113;

CREATE TABLE voltage_levels (
    id TEXT NOT NULL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive'))
, sort_order INTEGER NOT NULL DEFAULT 100, updated_at TEXT CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0)))) STRICT;


CREATE TABLE transmission_lines (
    id TEXT NOT NULL PRIMARY KEY,
    line_code TEXT NOT NULL UNIQUE CHECK (length(trim(line_code)) > 0),
    voltage_level_id TEXT NOT NULL REFERENCES voltage_levels(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'retired')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0))),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    change_reason TEXT NOT NULL DEFAULT ''
, line_kind TEXT NOT NULL DEFAULT 'main' CHECK(line_kind IN ('main','branch')), parent_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT, junction_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT, setup_status TEXT NOT NULL DEFAULT 'ready' CHECK(setup_status IN ('draft','ready')), erection_type TEXT NOT NULL DEFAULT '') STRICT;


CREATE TABLE physical_towers (
    id TEXT NOT NULL PRIMARY KEY,
    tower_code TEXT NOT NULL UNIQUE CHECK (length(trim(tower_code)) > 0),
    asset_no TEXT,
    tower_type TEXT,
    longitude REAL,
    latitude REAL,
    commissioned_on TEXT CHECK(commissioned_on IS NULL OR (length(commissioned_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(commissioned_on))=commissioned_on,0))),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'retired')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0))),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    change_reason TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '', height_scaled INTEGER CHECK(height_scaled IS NULL OR height_scaled>0), purpose TEXT NOT NULL DEFAULT '',
    CHECK (
        (longitude IS NULL AND latitude IS NULL)
        OR (longitude IS NOT NULL AND latitude IS NOT NULL
            AND longitude BETWEEN -180 AND 180
            AND latitude BETWEEN -90 AND 90)
    )
) STRICT;


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
    operations_team TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'inactive', 'retired')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0))),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    change_reason TEXT NOT NULL DEFAULT '',
    CHECK (status <> 'active' OR physical_tower_id IS NOT NULL)
) STRICT;


-- Complete audited equipment history; no independent partial history
-- timelines that can contradict their current asset identity.
CREATE TABLE line_history (
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1),
 name TEXT NOT NULL,
 voltage_level_id TEXT NOT NULL REFERENCES voltage_levels(id) ON DELETE RESTRICT,
 status TEXT NOT NULL,
 line_kind TEXT NOT NULL,
 parent_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 junction_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT,
 setup_status TEXT NOT NULL,
 erection_type TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL DEFAULT '',
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(line_id,version)
) STRICT;

CREATE TABLE physical_tower_history (
 physical_tower_id TEXT NOT NULL REFERENCES physical_towers(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1),
 asset_no TEXT,tower_type TEXT,longitude REAL,latitude REAL,
 commissioned_on TEXT,model TEXT,height_scaled INTEGER,purpose TEXT,
 status TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL DEFAULT '',
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(physical_tower_id,version)
) STRICT;

CREATE TABLE logical_tower_history (
 logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1),
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 tower_no TEXT NOT NULL,display_name TEXT,sort_rank INTEGER NOT NULL,
 circuit_position TEXT,management_department TEXT NOT NULL,
 operations_team TEXT NOT NULL,status TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL DEFAULT '',
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(logical_tower_id,version)
) STRICT;

CREATE TABLE users (
 id TEXT NOT NULL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','verifier','viewer')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))) STRICT;


CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL CHECK(expires_at IS NULL OR (length(expires_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(expires_at))=expires_at,0))), created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))) STRICT;


CREATE TABLE audit_events (
 id TEXT NOT NULL PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 entity TEXT NOT NULL CHECK(length(trim(entity))>0),
 entity_id TEXT NOT NULL CHECK(length(trim(entity_id))>0),
 action TEXT NOT NULL CHECK(length(trim(action))>0),
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
 reason TEXT, created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))) STRICT;


CREATE TABLE permission_definitions (
 code TEXT NOT NULL PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title))>0)
) STRICT;
CREATE TABLE role_permissions (
 role TEXT NOT NULL CHECK(role IN ('admin','editor','verifier','viewer')),
 permission_code TEXT NOT NULL REFERENCES permission_definitions(code) ON DELETE RESTRICT,
 PRIMARY KEY(role,permission_code)
) STRICT;
INSERT INTO permission_definitions(code,title) VALUES
 ('project.stock','项目正式入库'),
 ('project.approve','项目正式立项批准'),
 ('project.close','项目结项批准'),
 ('change.approve','项目变更批准'),
 ('settlement.approve','结算正式批准'),
 ('demand.activate','需求确认'),
 ('cost.confirm','真实费用核定');
INSERT INTO role_permissions(role,permission_code) SELECT 'admin',code FROM permission_definitions;
INSERT INTO role_permissions(role,permission_code) VALUES
 ('editor','project.stock'),('verifier','project.approve'),
 ('verifier','project.close'),('verifier','change.approve'),
 ('verifier','settlement.approve'),('verifier','demand.activate'),
 ('verifier','cost.confirm');
CREATE TABLE dictionary_types (id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL) STRICT;
-- Built-in pricing factor category; actual factors are configured as normal
-- versioned dictionary entries, never as hard-coded price table columns.
INSERT INTO dictionary_types(id,title) VALUES('price_factor','参考价适用因素');


-- Ordinary selectable dictionary values only; job operations are first-class.

CREATE TABLE dictionary_items (
 id TEXT NOT NULL PRIMARY KEY,
 type_id TEXT NOT NULL REFERENCES dictionary_types(id) ON DELETE RESTRICT,
 code TEXT NOT NULL CHECK(length(trim(code))>0),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(type_id,code),CHECK(type_id<>'operation')
) STRICT;


CREATE TABLE dictionary_item_versions (
 id TEXT NOT NULL PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 sort_order INTEGER NOT NULL DEFAULT 100,
 fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fields_json)),
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at TEXT NOT NULL CHECK(changed_at IS NULL OR (length(changed_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(changed_at))=changed_at,0))),
 UNIQUE(item_id,version)
) STRICT;


-- Operations have their own identity, lifecycle and history, not a dictionary row.

CREATE TABLE operations (
 id TEXT NOT NULL PRIMARY KEY,
 code TEXT NOT NULL UNIQUE CHECK(length(trim(code))>0),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


-- Full typed operation definition; current metadata is a view, never an
-- independently mutable copy of the versioned definition.
CREATE TABLE operation_versions (
 id TEXT NOT NULL PRIMARY KEY,
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 sort_order INTEGER NOT NULL DEFAULT 100,
 work_target_type TEXT NOT NULL CHECK(work_target_type IN ('line','physical')),
 work_object_id TEXT NOT NULL REFERENCES work_objects(id) ON DELETE RESTRICT,
 default_unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 default_unit_version INTEGER NOT NULL CHECK(default_unit_version>0),
 default_quantity_scaled INTEGER CHECK(default_quantity_scaled IS NULL OR default_quantity_scaled>0),
 completion_standard TEXT,
 fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fields_json)),
 pricing_features_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(pricing_features_json) AND json_type(pricing_features_json)='array'),
 allow_tower INTEGER NOT NULL CHECK(allow_tower IN (0,1)),
 allow_span INTEGER NOT NULL CHECK(allow_span IN (0,1)),
 default_location_kind TEXT NOT NULL CHECK(default_location_kind IN ('tower','span')),
 default_target_object TEXT NOT NULL DEFAULT '',
 entry_hint TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at TEXT NOT NULL CHECK(changed_at IS NULL OR (length(changed_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(changed_at))=changed_at,0))),
 UNIQUE(operation_id,version),
 FOREIGN KEY(default_unit_id,default_unit_version)
 REFERENCES dictionary_item_versions(item_id,version) ON DELETE RESTRICT,
 CHECK(allow_tower+allow_span>=1),
 CHECK((default_location_kind='tower' AND allow_tower=1)
 OR (default_location_kind='span' AND allow_span=1)),
 CHECK(work_target_type='line' OR allow_span=0)
) STRICT;


CREATE TABLE source_records (
 id TEXT NOT NULL PRIMARY KEY, type_id TEXT REFERENCES dictionary_items(id), type_snapshot TEXT, proposed_by TEXT,
 discovered_on TEXT CHECK(discovered_on IS NULL OR (length(discovered_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(discovered_on))=discovered_on,0))), description TEXT,
 source_system TEXT NOT NULL DEFAULT 'manual'
  CHECK(source_system IN ('manual','excel','other')),
 external_record_id TEXT,
 source_file_id TEXT REFERENCES evidence_files(id) ON DELETE RESTRICT,
 worksheet_name TEXT,
 row_number INTEGER CHECK(row_number IS NULL OR row_number>0),
 source_payload_sha256 TEXT CHECK(source_payload_sha256 IS NULL OR
  (length(source_payload_sha256)=64 AND source_payload_sha256 NOT GLOB '*[^0-9a-f]*')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))) STRICT;


CREATE TABLE demand_batches (
 id TEXT NOT NULL PRIMARY KEY,
 draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 idempotency_key TEXT UNIQUE,
 payload_sha256 TEXT CHECK(payload_sha256 IS NULL OR
  (length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*')),
 source_id TEXT REFERENCES source_records(id), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))), updated_at TEXT NOT NULL CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0)))) STRICT;


CREATE TABLE demands (
 id TEXT NOT NULL PRIMARY KEY, demand_no TEXT NOT NULL UNIQUE, batch_id TEXT REFERENCES demand_batches(id),
 -- Only one locator is authoritative: tower, physical tower, or span.
 logical_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT,
 physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 observed_physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 line_name_snapshot TEXT NOT NULL, tower_no_snapshot TEXT NOT NULL, physical_code_snapshot TEXT,
 work_target_type TEXT NOT NULL CHECK(work_target_type IN ('line','physical')),
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT, operation_version INTEGER NOT NULL, operation_snapshot TEXT NOT NULL,
 work_object_id TEXT NOT NULL REFERENCES work_objects(id) ON DELETE RESTRICT,
 work_object_snapshot TEXT NOT NULL,
 target_object TEXT NOT NULL, quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id), unit_version INTEGER NOT NULL, unit_snapshot TEXT NOT NULL,
 completion_standard TEXT NOT NULL, problem_description TEXT NOT NULL,
 priority_id TEXT REFERENCES dictionary_items(id), priority_snapshot TEXT, expected_on TEXT CHECK(expected_on IS NULL OR (length(expected_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(expected_on))=expected_on,0))),
 -- Demand status and confirmation time come from demand_lifecycle_events;
 -- the current definition version comes from demand_versions. Immutable
 -- root status/version/confirmed_at/updated_at would be false duplicates.
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 custom_fields_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_fields_json)),
 field_definitions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(field_definitions_json)),
 -- The original V1 source list; after publication, demand_versions.snapshot_json
 -- becomes the immutable authoritative complete location list for each version.
 initial_work_locations_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(initial_work_locations_json)
    AND json_type(initial_work_locations_json)='array'),
 -- Generated only for read/UI; never user-entered or stored twice.
 location_kind TEXT GENERATED ALWAYS AS (CASE WHEN span_id IS NULL THEN 'tower' ELSE 'span' END) VIRTUAL,
 -- For a shared physical tower, the contextual line is a separate business fact
 -- used only to select voltage and reference price; it is auto-captured from UI.
 context_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 span_id TEXT REFERENCES line_spans(id) ON DELETE RESTRICT,
 span_version INTEGER, span_snapshot_json TEXT,
 FOREIGN KEY(span_id,span_version) REFERENCES line_span_history(span_id,version_no)
 ON DELETE RESTRICT,
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
 FOREIGN KEY(operation_id,operation_version) REFERENCES operation_versions(operation_id,version),
 FOREIGN KEY(unit_id,unit_version) REFERENCES dictionary_item_versions(item_id,version)
) STRICT;


-- Every formal demand version has a real typed identity and is immutable.
-- V1 is published automatically at demand creation; V2+ correspond to real
-- appended demand_revisions, never a made-up integer in project approval.
CREATE TABLE demand_versions (
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version>=1),
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 operation_id TEXT NOT NULL,
 operation_version INTEGER NOT NULL CHECK(operation_version>0),
 work_object_id TEXT NOT NULL REFERENCES work_objects(id) ON DELETE RESTRICT,
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 unit_version INTEGER NOT NULL CHECK(unit_version>0),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 -- Generated domain attributes provide real typed FK/CHECK integrity without
 -- storing a SECOND copy of the complete immutable definition JSON.
 target_object TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.target_object'))
 VIRTUAL CHECK(COALESCE(length(trim(target_object))>0,0)),
 problem_description TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.problem_description'))
 VIRTUAL CHECK(COALESCE(length(trim(problem_description))>0,0)),
 completion_standard TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.completion_standard'))
 VIRTUAL CHECK(COALESCE(length(trim(completion_standard))>0,0)),
 work_target_type TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.work_target_type'))
 VIRTUAL CHECK(COALESCE(work_target_type IN ('line','physical'),0)),
 logical_tower_id TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.logical_tower_id'))
 VIRTUAL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 physical_tower_id TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.physical_tower_id'))
 VIRTUAL REFERENCES physical_towers(id) ON DELETE RESTRICT,
 observed_physical_tower_id TEXT GENERATED ALWAYS AS
 (json_extract(snapshot_json,'$.observed_physical_tower_id'))
 VIRTUAL REFERENCES physical_towers(id) ON DELETE RESTRICT,
 context_line_id TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.context_line_id'))
 VIRTUAL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 span_id TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.span_id'))
 VIRTUAL REFERENCES line_spans(id) ON DELETE RESTRICT,
 span_version INTEGER GENERATED ALWAYS AS (json_extract(snapshot_json,'$.span_version'))
 VIRTUAL,
 priority_id TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.priority_id'))
 VIRTUAL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 expected_on TEXT GENERATED ALWAYS AS (json_extract(snapshot_json,'$.expected_on'))
 VIRTUAL CHECK(expected_on IS NULL OR (length(expected_on)=10 AND
 COALESCE(strftime('%Y-%m-%d',julianday(expected_on))=expected_on,0))),
 recorded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 PRIMARY KEY(demand_id,version),
 FOREIGN KEY(operation_id,operation_version)
  REFERENCES operation_versions(operation_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(unit_id,unit_version)
  REFERENCES dictionary_item_versions(item_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(span_id,span_version)
  REFERENCES line_span_history(span_id,version_no) ON DELETE RESTRICT,
 CHECK(COALESCE(json_type(snapshot_json,'$.target_object')='text'
   AND json_type(snapshot_json,'$.problem_description')='text'
   AND json_type(snapshot_json,'$.completion_standard')='text'
   AND json_type(snapshot_json,'$.work_target_type')='text',0)),
 CHECK(
  (work_target_type='line' AND logical_tower_id IS NOT NULL
   AND physical_tower_id IS NULL AND span_id IS NULL AND span_version IS NULL
   AND context_line_id IS NULL)
  OR
  (work_target_type='line' AND span_id IS NOT NULL AND span_version>0
   AND logical_tower_id IS NULL AND physical_tower_id IS NULL
   AND context_line_id IS NULL AND observed_physical_tower_id IS NULL)
  OR
  (work_target_type='physical' AND physical_tower_id IS NOT NULL
   AND logical_tower_id IS NULL AND span_id IS NULL AND span_version IS NULL
   AND observed_physical_tower_id IS NULL)),
 CHECK(json_type(snapshot_json,'$.custom_fields_json') IS NULL OR
  json_valid(json_extract(snapshot_json,'$.custom_fields_json'))),
 CHECK(json_type(snapshot_json,'$.field_definitions_json') IS NULL OR
  json_valid(json_extract(snapshot_json,'$.field_definitions_json')))
) STRICT;

-- Historical expected material list belongs to a DEMAND VERSION.
-- No material master-version table; master identity remains materials.id.
CREATE TABLE demand_material_version_items (
 demand_id TEXT NOT NULL,
 demand_version INTEGER NOT NULL CHECK(demand_version>=1),
 material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 material_version_id TEXT NOT NULL REFERENCES material_versions(id) ON DELETE RESTRICT,
 item_no INTEGER NOT NULL CHECK(item_no>0),
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 unit_snapshot TEXT NOT NULL CHECK(length(trim(unit_snapshot))>0),
 note TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(demand_id,demand_version,material_id),
 UNIQUE(demand_id,demand_version,item_no),
 FOREIGN KEY(demand_id,demand_version) REFERENCES demand_versions(demand_id,version) ON DELETE RESTRICT
) STRICT;

-- The demand's workflow status is a typed append-only event, not a
-- mutable root attribute or extra copy in the definition versions.
CREATE TABLE demand_lifecycle_events (
 id TEXT NOT NULL PRIMARY KEY,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 event_seq INTEGER NOT NULL CHECK(event_seq>0),
 from_status TEXT CHECK(from_status IN ('pending','active','returned','cancelled')),
 to_status TEXT NOT NULL CHECK(to_status IN ('pending','active','returned','cancelled')),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)=24
 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0)),
 UNIQUE(demand_id,event_seq),
 CHECK(from_status IS NULL OR from_status<>to_status)
) STRICT;

CREATE TABLE demand_sources (
 demand_id TEXT NOT NULL REFERENCES demands(id), source_id TEXT NOT NULL REFERENCES source_records(id),
 PRIMARY KEY(demand_id,source_id)) STRICT;


CREATE TABLE demand_related_logical_towers (
 demand_id TEXT NOT NULL REFERENCES demands(id), logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id),
 PRIMARY KEY(demand_id,logical_tower_id)) STRICT;


CREATE TABLE demand_revisions (
 id TEXT NOT NULL PRIMARY KEY, demand_id TEXT NOT NULL REFERENCES demands(id),
 version INTEGER NOT NULL CHECK(version>=2),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id), changed_at TEXT NOT NULL CHECK(changed_at IS NULL OR (length(changed_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(changed_at))=changed_at,0))),
 UNIQUE(demand_id,version)) STRICT;


-- One immutable, content-addressed file catalog, independent from the business
-- entity using the evidence. The physical file is stored under data/objects/.
CREATE TABLE evidence_files (
 id TEXT NOT NULL PRIMARY KEY,
 sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64
   AND sha256 NOT GLOB '*[^0-9a-f]*'),
 storage_key TEXT NOT NULL UNIQUE,
 filename TEXT NOT NULL CHECK(length(trim(filename))>0),
 mime TEXT NOT NULL DEFAULT 'application/octet-stream',
 bytes INTEGER NOT NULL CHECK(bytes>0),
 uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 CHECK(storage_key='sha256/'||substr(sha256,1,2)||'/'||sha256)
) STRICT;


-- Typed foreign keys: each link has exactly ONE owning business record.
-- No unprotected (entity_type,entity_id) strings and no repeated file blobs.
CREATE TABLE evidence_links (
 id TEXT NOT NULL PRIMARY KEY,
 file_id TEXT NOT NULL REFERENCES evidence_files(id) ON DELETE RESTRICT,
 material_version_id TEXT REFERENCES material_versions(id) ON DELETE RESTRICT,
 source_id TEXT REFERENCES source_records(id) ON DELETE RESTRICT,
 demand_id TEXT REFERENCES demands(id) ON DELETE RESTRICT,
 demand_revision_id TEXT REFERENCES demand_revisions(id) ON DELETE RESTRICT,
 -- Typed composite identity of the exact published demand definition.
 demand_version_demand_id TEXT,
 demand_version_no INTEGER,
 -- Typed composite identity of one material in one published demand version.
 demand_material_demand_id TEXT,
 demand_material_version_no INTEGER,
 demand_material_master_id TEXT,
 demand_lifecycle_event_id TEXT REFERENCES demand_lifecycle_events(id) ON DELETE RESTRICT,
 project_stage_event_id TEXT REFERENCES project_stage_events(id) ON DELETE RESTRICT,
 project_management_version_id TEXT REFERENCES project_management_versions(id) ON DELETE RESTRICT,
 project_funding_version_id TEXT REFERENCES project_funding_versions(id) ON DELETE RESTRICT,
 project_approval_material_id TEXT REFERENCES project_approval_material_items(id) ON DELETE RESTRICT,
 line_span_history_id TEXT REFERENCES line_span_history(id) ON DELETE RESTRICT,
 change_order_id TEXT REFERENCES project_change_orders(id) ON DELETE RESTRICT,
 project_approval_version_id TEXT REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 settlement_version_id TEXT REFERENCES settlement_versions(id) ON DELETE RESTRICT,
 settlement_review_event_id TEXT REFERENCES settlement_review_events(id) ON DELETE RESTRICT,
 settlement_scope_result_id TEXT REFERENCES settlement_scope_results(id) ON DELETE RESTRICT,
 cost_version_id TEXT REFERENCES cost_versions(id) ON DELETE RESTRICT,
 reconciliation_version_id TEXT REFERENCES cost_reconciliation_versions(id) ON DELETE RESTRICT,
 project_closure_id TEXT REFERENCES project_closures(id) ON DELETE RESTRICT,
 note TEXT NOT NULL DEFAULT '',
 linked_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 linked_at TEXT NOT NULL CHECK(linked_at IS NULL OR (length(linked_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(linked_at))=linked_at,0))),
 CHECK((demand_version_demand_id IS NULL)=(demand_version_no IS NULL)),
 CHECK((demand_material_demand_id IS NULL)
     =(demand_material_version_no IS NULL)
   AND (demand_material_demand_id IS NULL)
     =(demand_material_master_id IS NULL)),
 CHECK((material_version_id IS NOT NULL)+(source_id IS NOT NULL)+(demand_id IS NOT NULL)+
 (demand_revision_id IS NOT NULL)+(demand_version_demand_id IS NOT NULL)+
 (demand_material_demand_id IS NOT NULL)+
 (demand_lifecycle_event_id IS NOT NULL)+(project_stage_event_id IS NOT NULL)+
 (project_management_version_id IS NOT NULL)+(project_funding_version_id IS NOT NULL)+
 (project_approval_material_id IS NOT NULL)+
 (line_span_history_id IS NOT NULL)+
 (change_order_id IS NOT NULL)+(project_approval_version_id IS NOT NULL)+
 (settlement_version_id IS NOT NULL)+(settlement_review_event_id IS NOT NULL)+
 (cost_version_id IS NOT NULL)+(reconciliation_version_id IS NOT NULL)+
 (project_closure_id IS NOT NULL)=1),
 FOREIGN KEY(demand_version_demand_id,demand_version_no)
  REFERENCES demand_versions(demand_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(demand_material_demand_id,demand_material_version_no,demand_material_master_id)
  REFERENCES demand_material_version_items(demand_id,demand_version,material_id)
  ON DELETE RESTRICT,
 UNIQUE(file_id,material_version_id),
 UNIQUE(file_id,source_id),UNIQUE(file_id,demand_id),
 UNIQUE(file_id,demand_revision_id),
 UNIQUE(file_id,demand_version_demand_id,demand_version_no),
 UNIQUE(file_id,demand_material_demand_id,demand_material_version_no,demand_material_master_id),
 UNIQUE(file_id,demand_lifecycle_event_id),UNIQUE(file_id,project_stage_event_id),
 UNIQUE(file_id,project_management_version_id),UNIQUE(file_id,project_funding_version_id),
 UNIQUE(file_id,project_approval_material_id),
 UNIQUE(file_id,line_span_history_id),
 UNIQUE(file_id,change_order_id),
 UNIQUE(file_id,project_approval_version_id),UNIQUE(file_id,settlement_version_id),
 UNIQUE(file_id,settlement_review_event_id),
 UNIQUE(file_id,settlement_scope_result_id),
 UNIQUE(file_id,cost_version_id),
 UNIQUE(file_id,reconciliation_version_id),UNIQUE(file_id,project_closure_id)
) STRICT;


CREATE TABLE allowed_ips (
 id TEXT NOT NULL PRIMARY KEY, ip TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


CREATE TABLE frameworks (
 id TEXT NOT NULL PRIMARY KEY,code TEXT NOT NULL UNIQUE,
 fiscal_year INTEGER NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2100),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


CREATE TABLE agreements (
 id TEXT NOT NULL PRIMARY KEY,code TEXT NOT NULL UNIQUE,
 framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),UNIQUE(id,framework_id)
) STRICT;

CREATE TABLE framework_versions (
 id TEXT NOT NULL PRIMARY KEY,
 framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 limit_fen INTEGER NOT NULL CHECK(limit_fen>=0),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 UNIQUE(framework_id,version_no)
) STRICT;

CREATE TABLE agreement_versions (
 id TEXT NOT NULL PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 limit_fen INTEGER NOT NULL CHECK(limit_fen>=0),
 contract_number TEXT,
 counterparty_name TEXT,
 signed_on TEXT CHECK(signed_on IS NULL OR (length(signed_on)=10 AND
  COALESCE(strftime('%Y-%m-%d',julianday(signed_on))=signed_on,0))),
 effective_from TEXT CHECK(effective_from IS NULL OR (length(effective_from)=10 AND
  COALESCE(strftime('%Y-%m-%d',julianday(effective_from))=effective_from,0))),
 effective_to TEXT CHECK(effective_to IS NULL OR (length(effective_to)=10 AND
  COALESCE(strftime('%Y-%m-%d',julianday(effective_to))=effective_to,0))),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 CHECK(effective_from IS NULL OR effective_to IS NULL OR effective_to>=effective_from),
 UNIQUE(agreement_id,version_no)
) STRICT;



-- Stable project identity only. Name/category belong to the complete
-- immutable project management/profile version; do not duplicate mutable
-- descriptions on the project root without an actual revision.
CREATE TABLE projects (
 id TEXT NOT NULL PRIMARY KEY, code TEXT NOT NULL UNIQUE,
 framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'reserve' CHECK(status IN ('reserve','stocked','approved','closed')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


-- Agreement association is optional, but every change is a typed immutable
-- version; projects store their permanent framework identity only.
-- Organization unit has stable code; later name, hierarchy or activation
-- changes are complete typed immutable versions, never silent root UPDATEs.
CREATE TABLE organizational_units (
 id TEXT NOT NULL PRIMARY KEY,
 code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(code))>0)
) STRICT;

CREATE TABLE organizational_unit_versions (
 id TEXT NOT NULL PRIMARY KEY,
 unit_id TEXT NOT NULL REFERENCES organizational_units(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 parent_unit_id TEXT REFERENCES organizational_units(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)=24 AND
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0)),
 UNIQUE(unit_id,version_no),
 UNIQUE(id,unit_id),
 CHECK(parent_unit_id IS NULL OR parent_unit_id<>unit_id)
) STRICT;

CREATE VIEW v_organizational_unit_current AS
SELECT u.id,u.code,v.id AS unit_version_id,v.version_no,
 v.name,v.parent_unit_id,v.status,v.recorded_at
FROM organizational_units u
JOIN organizational_unit_versions v ON v.unit_id=u.id
WHERE v.version_no=(SELECT MAX(x.version_no)
 FROM organizational_unit_versions x WHERE x.unit_id=u.id);

CREATE TABLE project_management_versions (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 -- Complete immutable project profile: no second mutable name/category root.
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 category_id TEXT REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 category_version INTEGER,
 owner_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 manager_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 -- Owning administrative/management department for this subproject.
 -- NOT a performing contractor, execution unit or settlement recipient.
 -- Both nullable only while the managing unit is not yet formally assigned.
 managing_unit_id TEXT REFERENCES organizational_units(id) ON DELETE RESTRICT,
 managing_unit_version_id TEXT,
 planned_start_on TEXT CHECK(planned_start_on IS NULL OR
  (length(planned_start_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(planned_start_on))=planned_start_on,0))),
 planned_end_on TEXT CHECK(planned_end_on IS NULL OR
  (length(planned_end_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(planned_end_on))=planned_end_on,0))),
 preliminary_estimate_fen INTEGER CHECK(preliminary_estimate_fen IS NULL OR preliminary_estimate_fen>=0),
 preliminary_estimate_basis TEXT,
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)=24 AND
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0)),
 UNIQUE(project_id,version_no),
 FOREIGN KEY(category_id,category_version)
  REFERENCES dictionary_item_versions(item_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(managing_unit_version_id,managing_unit_id)
  REFERENCES organizational_unit_versions(id,unit_id) ON DELETE RESTRICT,
 CHECK((category_id IS NULL)=(category_version IS NULL)),
 CHECK((managing_unit_id IS NULL)=(managing_unit_version_id IS NULL)),
 CHECK(planned_start_on IS NULL OR planned_end_on IS NULL OR planned_end_on>=planned_start_on)
) STRICT;

CREATE TABLE project_funding_versions (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 agreement_id TEXT REFERENCES agreements(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 UNIQUE(project_id,version_no)
) STRICT;


CREATE TABLE reference_price_catalog (
 id TEXT NOT NULL PRIMARY KEY,
 code TEXT NOT NULL UNIQUE CHECK(length(trim(code))>0),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


CREATE TABLE reference_price_versions (
 id TEXT NOT NULL PRIMARY KEY,
 catalog_id TEXT NOT NULL REFERENCES reference_price_catalog(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 title TEXT NOT NULL CHECK(length(trim(title))>0),
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
 operation_version INTEGER NOT NULL CHECK(operation_version>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 unit_version INTEGER NOT NULL CHECK(unit_version>0),
 voltage_level_id TEXT REFERENCES voltage_levels(id) ON DELETE RESTRICT,
 -- NULL means the price is not restricted to one tower construction category.
 -- This is matched against the cleaned physical_towers.tower_type field.
 tower_type TEXT CHECK(tower_type IS NULL OR
  (length(trim(tower_type))>0 AND tower_type=trim(tower_type))),
 work_mode TEXT NOT NULL DEFAULT 'both'
  CHECK(work_mode IN ('outage','non_outage','both')),
 specification TEXT NOT NULL DEFAULT '',
 -- Immutable additional applicability predicates: stable factor codes keyed
 -- to exact dictionary definition versions (enum equality or integer range).
 -- Application matches input context, detects rule overlaps and snapshots
 -- selected rule/inputs into the approved price basis.
 additional_conditions_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(additional_conditions_json)
    AND json_type(additional_conditions_json)='object'),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 -- Per work LOCATION (e.g. one physical tower) and its device count:
 -- per_unit: n * unit_price; base_plus_unit: one base + n * unit_price;
 -- quantity_bracket: choose one explicit quantity band and use its
 -- per-location base + n * per-unit price. Application computes/quotes.
 pricing_mode TEXT NOT NULL DEFAULT 'per_unit'
  CHECK(pricing_mode IN
 ('fixed','per_unit','base_plus_unit','quantity_bracket',
  'progressive_bracket','group','rate','composite')),
 pricing_scope TEXT NOT NULL DEFAULT 'work_location'
  CHECK(pricing_scope IN ('work_location','work_batch','project')),
 calculation_params_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(calculation_params_json)
    AND json_type(calculation_params_json)='object'),
 -- Version-owned fee components. A composite rule cannot be amended
 -- by appending another child row after publication.
 fee_components_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(fee_components_json)
    AND json_type(fee_components_json)='array'),
 base_fee_fen INTEGER NOT NULL DEFAULT 0 CHECK(base_fee_fen>=0),
 unit_price_fen INTEGER NOT NULL CHECK(unit_price_fen>=0),
 quantity_brackets_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(quantity_brackets_json)
   AND json_type(quantity_brackets_json)='array'),
 price_source TEXT NOT NULL,
 price_date TEXT NOT NULL CHECK(price_date IS NULL OR (length(price_date)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(price_date))=price_date,0))),
 tax_mode TEXT NOT NULL CHECK(tax_mode IN ('inclusive','exclusive','none')),
 effective_on TEXT NOT NULL CHECK(effective_on IS NULL OR (length(effective_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(effective_on))=effective_on,0))),
 basis TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(catalog_id,version_no),
 FOREIGN KEY(operation_id,operation_version)
 REFERENCES operation_versions(operation_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(unit_id,unit_version)
 REFERENCES dictionary_item_versions(item_id,version) ON DELETE RESTRICT
) STRICT;


CREATE TABLE project_demand_scopes (
 id TEXT NOT NULL PRIMARY KEY,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 demand_version INTEGER NOT NULL CHECK(demand_version>0),
 proposed_quantity_scaled INTEGER NOT NULL CHECK(proposed_quantity_scaled>0),
 proposed_unit_price_fen INTEGER CHECK(proposed_unit_price_fen>=0),
 proposed_amount_fen INTEGER CHECK(proposed_amount_fen IS NULL OR proposed_amount_fen>=0),
 price_source TEXT,
 price_date TEXT CHECK(price_date IS NULL OR (length(price_date)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(price_date))=price_date,0))),
 tax_mode TEXT CHECK(tax_mode IN ('inclusive','exclusive','none')),
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))), updated_at TEXT NOT NULL CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0))), demand_snapshot_json TEXT,
 FOREIGN KEY(demand_id,demand_version) REFERENCES demand_versions(demand_id,version) ON DELETE RESTRICT,
 UNIQUE(project_id,demand_id)
) STRICT;

-- A project-demand scope is a stable historical identity, NOT a globally
-- mutable assignment cell. The latest immutable link/release event determines
-- current ownership. Its initial link is created automatically when the
-- project_demand_scopes root is inserted with its true creator identity.
-- Releasing does not delete old approval/settlement work or demand history.
CREATE TABLE project_demand_link_events (
 id TEXT NOT NULL PRIMARY KEY,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 event_seq INTEGER NOT NULL CHECK(event_seq>=1),
 action TEXT NOT NULL CHECK(action IN ('linked','released')),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)=24 AND
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0)),
 reason TEXT NOT NULL DEFAULT '',
 UNIQUE(project_scope_id,event_seq)
) STRICT;

CREATE TABLE project_stage_events (
 id TEXT NOT NULL PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 stage TEXT NOT NULL CHECK(stage IN ('stocked','approved','closed')),
 project_version INTEGER NOT NULL CHECK(project_version>=2),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(project_id,project_version),
 UNIQUE(project_id,project_version,stage)
) STRICT;


CREATE TABLE line_spans (
 id TEXT NOT NULL PRIMARY KEY,
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 start_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 end_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 -- NULL=台账尚未核准，0=明确无输电中心管辖，正数=输电中心管辖米数×1000
 transmission_center_length_mm INTEGER CHECK(
  transmission_center_length_mm IS NULL OR transmission_center_length_mm>=0),
 status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT REFERENCES users(id),
 change_reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),updated_at TEXT NOT NULL CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0))),
 CHECK(start_tower_id<>end_tower_id)
) STRICT;


-- Every topology revision preserves the exact historical pair of endpoints
-- used by previously created demand and settlement snapshots.
-- No span-length field exists: distance remains optional coordinate derivation.
CREATE TABLE line_span_history (
 id TEXT NOT NULL PRIMARY KEY,
 span_id TEXT NOT NULL REFERENCES line_spans(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>=1),
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 start_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 end_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 transmission_center_length_mm INTEGER CHECK(
  transmission_center_length_mm IS NULL OR transmission_center_length_mm>=0),
 status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 UNIQUE(span_id,version_no)
) STRICT;


-- Transactional API idempotency record, not a second finance/event ledger.
-- Once a request has a result, it must not be overwritten or impersonated.
CREATE TABLE ledger_requests (
 request_key TEXT PRIMARY KEY CHECK(length(trim(request_key))>0),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND
   request_hash NOT GLOB '*[^0-9a-f]*'),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


CREATE TABLE demand_duplicate_reviews (
 id TEXT NOT NULL PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES demand_batches(id) ON DELETE RESTRICT,
 matched_demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 new_demand_id TEXT REFERENCES demands(id) ON DELETE RESTRICT,
 decision TEXT NOT NULL CHECK(decision IN ('separate','link')),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;


-- The batch/source/demand triplet is an immutable IMPORT provenance assertion.
-- It is not the mutable/current demand-source attribution. Preserve the raw
-- assertion even when a final demand is linked to other corroborating sources.
CREATE TABLE batch_demand_sources (
 batch_id TEXT NOT NULL REFERENCES demand_batches(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 source_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 PRIMARY KEY(batch_id,demand_id,source_id)
) STRICT;



CREATE TABLE project_approval_versions (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>=1),
 change_order_id TEXT REFERENCES project_change_orders(id) ON DELETE RESTRICT,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 approved_budget_fen INTEGER NOT NULL CHECK(approved_budget_fen>=0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 approved_at TEXT CHECK(approved_at IS NULL OR (length(approved_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(approved_at))=approved_at,0))),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(project_id,version_no), UNIQUE(change_order_id),
 CHECK((version_no=1 AND change_order_id IS NULL)
    OR (version_no>1 AND change_order_id IS NOT NULL)),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL)
 OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
) STRICT;


CREATE TABLE project_change_orders (
 id TEXT NOT NULL PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 code TEXT NOT NULL UNIQUE,
 base_approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 proposal_json TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 decided_by TEXT REFERENCES users(id),decided_at TEXT CHECK(decided_at IS NULL OR (length(decided_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(decided_at))=decided_at,0))),decision_reason TEXT
) STRICT;


-- Standard work objects. Configured once on the operation, not for every demand.
CREATE TABLE work_objects (
 id TEXT NOT NULL PRIMARY KEY,code TEXT NOT NULL UNIQUE CHECK(length(trim(code))>0),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)))
) STRICT;

CREATE TABLE work_object_versions (
 id TEXT NOT NULL PRIMARY KEY,
 work_object_id TEXT NOT NULL REFERENCES work_objects(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 work_target_type TEXT NOT NULL CHECK(work_target_type IN ('line','physical','both')),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 sort_order INTEGER NOT NULL DEFAULT 100,
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 UNIQUE(work_object_id,version_no)
) STRICT;



-- A demand can have zero or many material items; no dummy material rows.
-- Unified material master: immutable identity and separate full formal
-- material_versions. No external PMS sync aliases or external mapping IDs.
-- Material identity stable; name/model/spec/status/category are immutable full versions.
-- Units stay on identity so historical quantities cannot change interpretation.
CREATE TABLE materials (
 id TEXT NOT NULL PRIMARY KEY,
 code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(code))>0 AND code=trim(code)),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(length(created_at)=24 AND
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))
) STRICT;
CREATE TABLE material_versions (
 id TEXT NOT NULL PRIMARY KEY,
 material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>=1),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 model TEXT NOT NULL DEFAULT '',
 specification TEXT NOT NULL DEFAULT '',
 category_id TEXT REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 note TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)=24 AND
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0)),
 UNIQUE(material_id,version_no)
) STRICT;
CREATE VIEW v_material_current AS
SELECT m.id,m.code,m.unit_id,m.created_by,m.created_at,
 v.id AS material_version_id,v.version_no,v.name,v.model,v.specification,
 v.category_id,v.status,v.note,v.changed_by,v.recorded_at AS updated_at
FROM materials m JOIN material_versions v ON v.material_id=m.id
 AND v.version_no=(SELECT MAX(h.version_no) FROM material_versions h
 WHERE h.material_id=m.id);



CREATE TABLE demand_material_items (
 id TEXT NOT NULL PRIMARY KEY,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 item_no INTEGER NOT NULL CHECK(item_no>0),
 material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))), updated_at TEXT NOT NULL CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0))),
 UNIQUE(demand_id,item_no),
 UNIQUE(demand_id,material_id)
) STRICT;

CREATE TABLE project_approval_scope_versions (
 id TEXT NOT NULL PRIMARY KEY,
 approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 demand_version INTEGER NOT NULL CHECK(demand_version>0),
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 unit_price_fen INTEGER CHECK(unit_price_fen IS NULL OR unit_price_fen>=0),
 approved_amount_fen INTEGER CHECK(approved_amount_fen IS NULL OR approved_amount_fen>=0),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(approval_version_id,project_scope_id),
 UNIQUE(id,approval_version_id,project_scope_id),
 FOREIGN KEY(demand_id,demand_version) REFERENCES demand_versions(demand_id,version) ON DELETE RESTRICT
) STRICT;



-- Stable identity for each project's physical/material work item.
-- A new approval may change a model or quantity without creating a new
-- actual-consumption identity; replacement material gets a new identity.
CREATE TABLE project_scope_materials (
 id TEXT NOT NULL PRIMARY KEY,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 addition_reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(id,project_scope_id),
 UNIQUE(project_scope_id,material_id)
) STRICT;


-- Each approval is frozen with material specifications, not a mutable BOM join.
CREATE TABLE project_approval_material_items (
 id TEXT NOT NULL PRIMARY KEY,
 approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 project_material_id TEXT NOT NULL,
 material_version_id TEXT NOT NULL REFERENCES material_versions(id) ON DELETE RESTRICT,
 item_no INTEGER NOT NULL CHECK(item_no>0),
 material_code_snapshot TEXT NOT NULL CHECK(length(trim(material_code_snapshot))>0),
 material_name TEXT NOT NULL,
 material_model TEXT NOT NULL,
 specification TEXT NOT NULL DEFAULT '',
 approved_quantity_scaled INTEGER NOT NULL CHECK(approved_quantity_scaled>0),
 unit_id TEXT NOT NULL REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 unit_snapshot TEXT NOT NULL,
 FOREIGN KEY(approval_version_id,project_scope_id)
  REFERENCES project_approval_scope_versions(approval_version_id,project_scope_id) ON DELETE RESTRICT,
 FOREIGN KEY(project_material_id,project_scope_id)
  REFERENCES project_scope_materials(id,project_scope_id) ON DELETE RESTRICT,
 UNIQUE(approval_version_id,project_scope_id,item_no),
 UNIQUE(approval_version_id,project_material_id)
) STRICT;


-- Project-specific fee structure. Parent nodes are grouping-only; confirmed
-- actual expenses and statement rows refer exclusively to terminal leaves.
-- An immutable parent chain cannot cycle: a parent must exist before its child.
CREATE TABLE project_cost_nodes (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 parent_id TEXT,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(id,project_id),
 CHECK(parent_id IS NULL OR parent_id<>id),
 FOREIGN KEY(parent_id,project_id) REFERENCES project_cost_nodes(id,project_id) ON DELETE RESTRICT
) STRICT;

-- Renaming or disabling a cost category must not rewrite historic postings.
CREATE TABLE project_cost_node_versions (
 id TEXT NOT NULL PRIMARY KEY,
 node_id TEXT NOT NULL REFERENCES project_cost_nodes(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)=24 AND
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0)),
 UNIQUE(node_id,version_no)
) STRICT;

-- Stable settlement business identity. No mutable financial state on this row.
-- Confirmed content is entirely in immutable settlement_versions and its items.
CREATE TABLE settlements (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 number TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(project_id,number)
) STRICT;


-- One immutable full document snapshot for each formal submitted revision.
-- No draft keystrokes stored here; draft editing uses settlement_drafts.
CREATE TABLE settlement_versions (
 id TEXT NOT NULL PRIMARY KEY,
 settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>=1),
 previous_version_id TEXT REFERENCES settlement_versions(id) ON DELETE RESTRICT,
 approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 funding_version_id TEXT REFERENCES project_funding_versions(id) ON DELETE RESTRICT,
 -- Every independent settlement represents only the THIS-TIME amount
 -- being settled; repeated documents settle different portions of the
 -- actual project cost. Do not store cumulative totals or a false "final"
 -- status. The application derives how much remains unsettled.
 change_type TEXT NOT NULL CHECK(change_type IN ('initial','revision','void')),
 reason TEXT NOT NULL DEFAULT '',
 basis TEXT NOT NULL DEFAULT '',
 settlement_on TEXT CHECK(settlement_on IS NULL OR (length(settlement_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(settlement_on))=settlement_on,0))),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 UNIQUE(settlement_id,version_no),
 UNIQUE(id,settlement_id),
 CHECK((version_no=1 AND previous_version_id IS NULL AND change_type='initial')
    OR (version_no>1 AND previous_version_id IS NOT NULL AND change_type<>'initial'))
) STRICT;


-- Single editable work-in-progress per settlement. Never counted in reports.
CREATE TABLE settlement_drafts (
 settlement_id TEXT PRIMARY KEY REFERENCES settlements(id) ON DELETE RESTRICT,
 based_on_version_id TEXT REFERENCES settlement_versions(id) ON DELETE RESTRICT,
 draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
 edit_version INTEGER NOT NULL DEFAULT 1 CHECK(edit_version>0),
 updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at TEXT NOT NULL CHECK(updated_at IS NULL OR (length(updated_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(updated_at))=updated_at,0)))
) STRICT;


-- Review history is append-only and ordered by event_seq, not backdated time.
-- Approval carries both system recorded time and business effective date.
CREATE TABLE settlement_review_events (
 id TEXT NOT NULL PRIMARY KEY,
 settlement_version_id TEXT NOT NULL REFERENCES settlement_versions(id) ON DELETE RESTRICT,
 event_seq INTEGER NOT NULL CHECK(event_seq>0),
 action TEXT NOT NULL CHECK(action IN ('submit','return','reject','approve')),
 reason TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at TEXT NOT NULL CHECK(recorded_at IS NULL OR (length(recorded_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(recorded_at))=recorded_at,0))),
 effective_on TEXT CHECK(effective_on IS NULL OR (length(effective_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(effective_on))=effective_on,0))),
 UNIQUE(settlement_version_id,event_seq),
 CHECK(action<>'approve' OR effective_on IS NOT NULL)
) STRICT;


-- Stable detail identity. Its scope/project can never be changed in-place.
-- Removing an item from the latest settlement version does NOT erase history.
CREATE TABLE settlement_items (
 id TEXT NOT NULL PRIMARY KEY,
 settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
 project_scope_id TEXT REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 cost_node_id TEXT NOT NULL REFERENCES project_cost_nodes(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 UNIQUE(settlement_id,project_scope_id,cost_node_id)
) STRICT;


-- Every submitted version snapshots ALL included items, not just differences.
-- Not present in a later approved version = removed from effective statement,
-- while the stable item ID and old versions remain auditable.
CREATE TABLE settlement_item_versions (
 id TEXT NOT NULL PRIMARY KEY,
 settlement_version_id TEXT NOT NULL REFERENCES settlement_versions(id) ON DELETE RESTRICT,
 settlement_item_id TEXT NOT NULL REFERENCES settlement_items(id) ON DELETE RESTRICT,
 cost_node_version_id TEXT NOT NULL REFERENCES project_cost_node_versions(id) ON DELETE RESTRICT,
 approval_scope_version_id TEXT REFERENCES project_approval_scope_versions(id) ON DELETE RESTRICT,
 quantity_scaled INTEGER NOT NULL DEFAULT 0 CHECK(quantity_scaled>=0),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
 unit_price_fen INTEGER CHECK(unit_price_fen IS NULL OR unit_price_fen>=0),
 work_mode TEXT CHECK(work_mode IN ('outage','non_outage')),
 tax_mode TEXT CHECK(tax_mode IN ('inclusive','exclusive','none')),
 tax_rate_basis_points INTEGER CHECK(tax_rate_basis_points IS NULL OR
  (tax_rate_basis_points BETWEEN 0 AND 10000
   AND tax_mode IS NOT NULL AND
   (tax_mode<>'none' OR tax_rate_basis_points=0))),
 evidence TEXT NOT NULL,
 scope_snapshot_json TEXT NOT NULL CHECK(json_valid(scope_snapshot_json)),
 UNIQUE(settlement_version_id,settlement_item_id),
 UNIQUE(id,settlement_item_id),
 CHECK(quantity_scaled>0 OR amount_fen>0)
) STRICT;



-- The actual demand results RESOLVED BY ONE installment's complete version.
-- This is neither a separate construction/completion phase nor an amount
-- allocation. One scope is counted ONCE even if labor, materials and other
-- cost-tree lines all refer to it in the same settlement.
-- Actual work may be BELOW or ABOVE the approved scope; do not hard-cap it.
CREATE TABLE settlement_scope_results (
 id TEXT NOT NULL PRIMARY KEY,
 settlement_version_id TEXT NOT NULL
  REFERENCES settlement_versions(id) ON DELETE RESTRICT,
 project_scope_id TEXT NOT NULL
  REFERENCES project_demand_scopes(id) ON DELETE RESTRICT,
 approval_scope_version_id TEXT NOT NULL
  REFERENCES project_approval_scope_versions(id) ON DELETE RESTRICT,
 -- Zero = the installment settles/corrects earlier work on this demand,
 -- without claiming NEW completed quantity. Never invent work for a
 -- financial-only installment. Negative quantity is not valid here; formal
 -- corrections to a prior installment replace that document's full version.
 resolved_quantity_scaled INTEGER NOT NULL CHECK(resolved_quantity_scaled>=0),
 evidence TEXT NOT NULL DEFAULT '',
 UNIQUE(settlement_version_id,project_scope_id)
) STRICT;


-- Actual expenses exist independently of a settlement document; reconciliation may occur later.
-- An expense belongs to exactly one project. Never create a fictional settlement solely to record costs.
CREATE TABLE cost_entries (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 cost_node_id TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 FOREIGN KEY(cost_node_id,project_id) REFERENCES project_cost_nodes(id,project_id) ON DELETE RESTRICT
) STRICT;


CREATE TABLE cost_versions (
 id TEXT NOT NULL PRIMARY KEY,
 entry_id TEXT NOT NULL REFERENCES cost_entries(id) ON DELETE RESTRICT,
 cost_node_version_id TEXT NOT NULL REFERENCES project_cost_node_versions(id) ON DELETE RESTRICT,
 funding_version_id TEXT REFERENCES project_funding_versions(id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 status TEXT NOT NULL CHECK(status IN ('active','voided')),
 title TEXT NOT NULL CHECK(length(trim(title))>0),
 occurred_on TEXT NOT NULL CHECK(occurred_on IS NULL OR (length(occurred_on)=10 AND COALESCE(strftime('%Y-%m-%d',julianday(occurred_on))=occurred_on,0))),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
 tax_mode TEXT CHECK(tax_mode IN ('inclusive','exclusive','none')),
 tax_rate_basis_points INTEGER CHECK(tax_rate_basis_points IS NULL OR
  (tax_rate_basis_points BETWEEN 0 AND 10000
   AND tax_mode IS NOT NULL AND
   (tax_mode<>'none' OR tax_rate_basis_points=0))),
 invoice_number TEXT,
 evidence TEXT NOT NULL CHECK(length(trim(evidence))>0),
 reason TEXT NOT NULL DEFAULT '',
 confirmed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 confirmed_at TEXT NOT NULL CHECK(confirmed_at IS NULL OR (length(confirmed_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(confirmed_at))=confirmed_at,0))),
 request_key TEXT NOT NULL UNIQUE,
 UNIQUE(entry_id,version_no)
) STRICT;





-- A reconciliation points to BOTH stable business item identity and the exact
-- previously approved document snapshot against which it was performed.
CREATE TABLE cost_reconciliation_versions (
 id TEXT NOT NULL PRIMARY KEY,
 record_id TEXT NOT NULL,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 status TEXT NOT NULL CHECK(status IN ('active','voided')),
 cost_version_id TEXT NOT NULL REFERENCES cost_versions(id) ON DELETE RESTRICT,
 settlement_item_id TEXT NOT NULL REFERENCES settlement_items(id) ON DELETE RESTRICT,
 settlement_item_version_id TEXT NOT NULL,
 reconciled_cost_fen INTEGER NOT NULL CHECK(reconciled_cost_fen>0),
 reconciled_settlement_fen INTEGER NOT NULL CHECK(reconciled_settlement_fen>=0),
 is_final INTEGER NOT NULL CHECK(is_final IN (0,1)),
 evidence TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(created_at IS NULL OR (length(created_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0))),
 request_key TEXT NOT NULL UNIQUE,
 UNIQUE(record_id,version_no),
 CHECK(status='active' OR (version_no>1 AND is_final=0)),
 FOREIGN KEY(settlement_item_version_id,settlement_item_id)
  REFERENCES settlement_item_versions(id,settlement_item_id) ON DELETE RESTRICT
) STRICT;



-- An explicit project CLOSE decision recognizes the actual delivered demand
-- quantities and all actual/settled/unsettled financial facts. It is not an
-- assertion that every budget/requirement/expense reached 100 percent.
-- The immutable snapshot can record what was unfinished, reduced or exceeded.
CREATE TABLE project_closures (
 id TEXT NOT NULL PRIMARY KEY,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
 approval_version_id TEXT NOT NULL REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL DEFAULT '',
 -- Application creates an automatic final-review snapshot of resolved
 -- demand quantities, remaining work and financial variance; no free-text
 -- explanation is mandatory for an administrator.
 close_snapshot_json TEXT NOT NULL CHECK(json_valid(close_snapshot_json)
  AND json_type(close_snapshot_json)='object'),
 closed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 closed_at TEXT NOT NULL CHECK(closed_at IS NULL OR (length(closed_at)=24 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(closed_at))=closed_at,0)))
) STRICT;





-- PROPOSED INDEXES: FKs, portfolio queries and settlement-driven operations.
CREATE INDEX idx_work_object_versions_domain ON work_object_versions(work_target_type,status,sort_order);
CREATE INDEX idx_operation_versions_work_object ON operation_versions(work_object_id,status);
CREATE INDEX idx_approval_materials_scope ON project_approval_material_items(project_scope_id,approval_version_id);
CREATE INDEX idx_settlement_items_scope ON settlement_items(project_scope_id,settlement_id);
CREATE INDEX idx_cost_entries_project ON cost_entries(project_id);
CREATE INDEX idx_cost_node_children ON project_cost_nodes(project_id,parent_id);
CREATE INDEX idx_cost_entries_node ON cost_entries(cost_node_id);
CREATE INDEX idx_settlement_items_cost_node ON settlement_items(cost_node_id);
CREATE UNIQUE INDEX ux_settlement_items_unscoped_cost_node
 ON settlement_items(settlement_id,cost_node_id) WHERE project_scope_id IS NULL;
CREATE INDEX idx_cost_reconciliation_item ON cost_reconciliation_versions(settlement_item_id);
-- Efficient per-demand total progress lookup; the version-leading UNIQUE
-- already supports each settlement's own full resolved-scope snapshot.
CREATE INDEX idx_settlement_scope_results_scope
 ON settlement_scope_results(project_scope_id,settlement_version_id);
CREATE VIEW v_project_cost_node_current AS
SELECT n.id,n.project_id,n.parent_id,v.id AS current_version_id,
 v.version_no,v.name,v.status
FROM project_cost_nodes n JOIN project_cost_node_versions v ON v.node_id=n.id
WHERE v.version_no=(SELECT MAX(x.version_no) FROM project_cost_node_versions x
 WHERE x.node_id=n.id);

CREATE VIEW v_cost_current AS
SELECT v.*,e.project_id FROM cost_versions v
JOIN cost_entries e ON e.id=v.entry_id
WHERE v.version_no=(SELECT MAX(h.version_no)
 FROM cost_versions h WHERE h.entry_id=v.entry_id);

CREATE VIEW v_cost_reconciliation_current AS
SELECT r.* FROM cost_reconciliation_versions r
WHERE r.version_no=(SELECT MAX(h.version_no)
 FROM cost_reconciliation_versions h WHERE h.record_id=r.record_id);
CREATE VIEW v_settlement_review_status AS
SELECT v.id AS settlement_version_id,v.settlement_id,v.version_no,
 (SELECT e.action FROM settlement_review_events e WHERE e.settlement_version_id=v.id
 ORDER BY e.event_seq DESC LIMIT 1) AS last_action,
 (SELECT e.recorded_at FROM settlement_review_events e
 WHERE e.settlement_version_id=v.id AND e.action='approve'
 ORDER BY e.event_seq DESC LIMIT 1) AS approved_recorded_at,
 (SELECT e.effective_on FROM settlement_review_events e
 WHERE e.settlement_version_id=v.id AND e.action='approve'
 ORDER BY e.event_seq DESC LIMIT 1) AS approved_effective_on
FROM settlement_versions v;

CREATE VIEW v_settlement_effective_versions AS
SELECT v.*,s.project_id,r.approved_recorded_at,r.approved_effective_on
FROM settlement_versions v
JOIN settlements s ON s.id=v.settlement_id
JOIN v_settlement_review_status r ON r.settlement_version_id=v.id
WHERE r.last_action='approve'
AND NOT EXISTS(
 SELECT 1 FROM settlement_versions newer
 JOIN v_settlement_review_status rr ON rr.settlement_version_id=newer.id
 WHERE newer.settlement_id=v.settlement_id AND newer.version_no>v.version_no
 AND rr.last_action='approve');

CREATE VIEW v_settlement_approval_timeline AS
SELECT s.id AS settlement_id,s.project_id,v.id AS settlement_version_id,
 v.version_no,v.change_type,e.id AS approval_event_id,
 e.recorded_at,e.effective_on
FROM settlement_review_events e
JOIN settlement_versions v ON v.id=e.settlement_version_id
JOIN settlements s ON s.id=v.settlement_id
WHERE e.action='approve';

-- Exactly one current project for each linked professional demand.
-- No persisted status is stored in demands or project_demand_scopes.
CREATE VIEW v_project_demand_binding_current AS
SELECT sc.id AS project_scope_id,sc.project_id,sc.demand_id,
       evt.id AS link_event_id,evt.actor_id AS linked_by,
       evt.recorded_at AS linked_at
FROM project_demand_scopes sc
JOIN project_demand_link_events evt ON evt.project_scope_id=sc.id
 AND evt.event_seq=(
   SELECT MAX(last.event_seq) FROM project_demand_link_events last
   WHERE last.project_scope_id=sc.id)
WHERE evt.action='linked';

CREATE VIEW v_approval_scope_current AS
SELECT a.* FROM project_approval_scope_versions a
JOIN project_approval_versions p ON p.id=a.approval_version_id
WHERE p.status='approved'
 AND p.version_no=(SELECT MAX(x.version_no) FROM project_approval_versions x
 WHERE x.project_id=p.project_id AND x.status='approved');

CREATE VIEW v_effective_settlement_items AS
SELECT i.id,i.settlement_id,i.project_scope_id,
 iv.id AS settlement_item_version_id,iv.settlement_version_id,
 iv.quantity_scaled,iv.amount_fen AS net_amount_fen,iv.amount_fen,
 iv.unit_price_fen,iv.work_mode,iv.evidence,iv.scope_snapshot_json,
 v.project_id,v.approval_version_id
FROM v_settlement_effective_versions v
JOIN settlement_item_versions iv ON iv.settlement_version_id=v.id
JOIN settlement_items i ON i.id=iv.settlement_item_id
WHERE v.change_type<>'void';

-- An old approved settlement snapshot remains historic, but its prior
-- reconciliation must not count as today's applied amount once superseded.
-- This is a current-business-fact projection, NOT an amount/statistics report.
-- Current effective demand fulfilment is derived strictly from each
-- independent settlement's CURRENT APPROVED VERSION. Never sum a
-- settlement's superseded historical results or its billing lines.
CREATE VIEW v_effective_demand_resolutions AS
SELECT r.id,r.settlement_version_id,v.settlement_id,v.project_id,
 r.project_scope_id,sc.demand_id,r.approval_scope_version_id,
 r.resolved_quantity_scaled,r.evidence
FROM settlement_scope_results r
JOIN v_settlement_effective_versions v ON v.id=r.settlement_version_id
 AND v.change_type<>'void'
JOIN project_demand_scopes sc ON sc.id=r.project_scope_id;

CREATE VIEW v_effective_cost_reconciliations AS
SELECT r.*,historic.entry_id,c.project_id,c.cost_node_id
FROM v_cost_reconciliation_current r
JOIN cost_versions historic ON historic.id=r.cost_version_id
JOIN cost_entries c ON c.id=historic.entry_id
JOIN v_cost_current current_cost ON current_cost.entry_id=c.id
JOIN v_effective_settlement_items i
 ON i.settlement_item_version_id=r.settlement_item_version_id
 AND i.id=r.settlement_item_id
WHERE r.status='active' AND current_cost.status='active';


-- TYPE CONSISTENCY: the work object is fixed on the operation template.
CREATE TRIGGER object_type_guard_insert BEFORE INSERT ON operation_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM v_work_object_current o WHERE o.id=NEW.work_object_id
 AND o.status='active'
 AND o.work_target_type IN ('both',NEW.work_target_type))
 THEN RAISE(ABORT,'标准作业对象不适用于当前操作类型') END;
END;
-- The unit is governed once in the unified master, not copied on every demand.
CREATE TRIGGER material_master_unit_insert BEFORE INSERT ON materials
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM dictionary_items u WHERE u.id=NEW.unit_id AND u.type_id='unit')
 THEN RAISE(ABORT,'物资主数据的计量单位必须属于单位字典') END; END;
CREATE TRIGGER approved_material_immutable_update
BEFORE UPDATE ON project_approval_material_items
WHEN EXISTS(SELECT 1 FROM project_approval_versions a
 WHERE a.id=OLD.approval_version_id AND a.status='approved')
 OR NEW.id IS NOT OLD.id OR NEW.approval_version_id IS NOT OLD.approval_version_id
 OR NEW.project_scope_id IS NOT OLD.project_scope_id
 OR NEW.project_material_id IS NOT OLD.project_material_id
BEGIN SELECT RAISE(ABORT,'已批准物资不可覆盖；草稿只允许编辑非身份字段'); END;

CREATE TRIGGER approved_material_immutable_delete
BEFORE DELETE ON project_approval_material_items
WHEN EXISTS(SELECT 1 FROM project_approval_versions a
 WHERE a.id=OLD.approval_version_id AND a.status='approved')
BEGIN SELECT RAISE(ABORT,'已批准物资版本不可删除'); END;

CREATE TRIGGER approved_material_scope_insert
 BEFORE INSERT ON project_approval_material_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_demand_scopes s
 JOIN project_approval_versions v ON v.project_id=s.project_id
 WHERE s.id=NEW.project_scope_id AND v.id=NEW.approval_version_id)
 THEN RAISE(ABORT,'批准物资明细与项目需求范围不一致') END;
END;
CREATE TRIGGER cost_version_immutable_update BEFORE UPDATE ON cost_versions
BEGIN SELECT RAISE(ABORT,'费用确认历史不可覆盖'); END;
CREATE TRIGGER cost_reconciliation_immutable_update
 BEFORE UPDATE ON cost_reconciliation_versions
BEGIN SELECT RAISE(ABORT,'费用核对历史不可覆盖'); END;


-- OPTIONAL AGREEMENT: an approved project may have no agreement. In that case
-- it consumes framework capacity not reserved by agreements; the two pools
-- must not double-count the same funds.
-- The annual framework and the agreement are budget *baselines*, not hard caps.
-- Projects may exceed them as real conditions change; the overage is reported.
-- The framework is the project's permanent ownership; optional agreement
-- changes are recorded in project_funding_versions rather than updating
-- a mutable duplicate field on projects.
CREATE TRIGGER project_home_insert BEFORE INSERT ON projects
BEGIN
 SELECT CASE WHEN NEW.status IN ('approved','closed')
 THEN RAISE(ABORT,'正式立项需要已有的项目批准版本，先创建储备项目') END;
END;
CREATE TRIGGER project_home_update
 BEFORE UPDATE OF id,code,framework_id,created_by,created_at ON projects
BEGIN SELECT RAISE(ABORT,'子项目根身份、编码和框架归属不允许直接改写；名称与类别须创建正式档案版本'); END;
CREATE TRIGGER project_root_immutable_delete BEFORE DELETE ON projects
BEGIN SELECT RAISE(ABORT,'已建档子项目不能删除；使用业务阶段和正式历史保留审计'); END;
CREATE TRIGGER project_approved_status_guard
 BEFORE UPDATE OF status ON projects
 WHEN NEW.status IN ('approved','closed')
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM project_approval_versions v
 WHERE v.project_id=NEW.id AND v.status='approved')
 THEN RAISE(ABORT,'正式项目必须存在已经生效的完整批准版本') END;
END;
CREATE TRIGGER project_funding_insert_guard BEFORE INSERT ON project_funding_versions
BEGIN
 SELECT CASE WHEN (SELECT p.status FROM projects p WHERE p.id=NEW.project_id)='closed'
 THEN RAISE(ABORT,'项目正式关闭后不得私自改变资金归属') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_funding_versions prev WHERE prev.project_id=NEW.project_id
 AND prev.recorded_at>NEW.recorded_at)
 THEN RAISE(ABORT,'资金关联历史的记录时点不得逆序') END;
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM project_funding_versions v WHERE v.project_id=NEW.project_id)
 THEN RAISE(ABORT,'项目资金关联版本号必须连续') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT p.created_at FROM projects p WHERE p.id=NEW.project_id)
 THEN RAISE(ABORT,'资金关联历史不能早于所属子项目创建') END;
 SELECT CASE WHEN NEW.version_no>1 AND
 NEW.agreement_id IS (SELECT prior.agreement_id
  FROM project_funding_versions prior WHERE prior.project_id=NEW.project_id
  AND prior.version_no=NEW.version_no-1)
 THEN RAISE(ABORT,'资金归属协议未发生变化，不得产生无效历史版本') END;
 SELECT CASE WHEN NEW.agreement_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM projects p JOIN agreements a ON a.framework_id=p.framework_id
 WHERE p.id=NEW.project_id AND a.id=NEW.agreement_id)
 THEN RAISE(ABORT,'所选执行协议必须属于子项目年度框架') END;
END;
CREATE TRIGGER project_funding_immutable_update BEFORE UPDATE ON project_funding_versions
BEGIN SELECT RAISE(ABORT,'项目协议关联历史不可覆盖'); END;
CREATE TRIGGER project_funding_immutable_delete BEFORE DELETE ON project_funding_versions
BEGIN SELECT RAISE(ABORT,'项目协议关联历史不可删除'); END;
CREATE TRIGGER project_approval_version_insert_guard
 BEFORE INSERT ON project_approval_versions
BEGIN
 SELECT CASE WHEN NEW.status<>'draft'
 THEN RAISE(ABORT,'必须先建立草稿及其完整需求范围，再正式批准') END;
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM project_approval_versions v WHERE v.project_id=NEW.project_id)
 THEN RAISE(ABORT,'项目批准版本号必须连续') END;
 SELECT CASE WHEN NEW.created_at<
 (SELECT p.created_at FROM projects p WHERE p.id=NEW.project_id)
 OR NEW.created_at<
 (SELECT MAX(a.created_at) FROM project_approval_versions a
  WHERE a.project_id=NEW.project_id)
 THEN RAISE(ABORT,'项目批准草稿版本不能早于子项目创建或历史批准版本') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM project_approval_versions prev WHERE prev.project_id=NEW.project_id
 AND prev.version_no=NEW.version_no-1 AND prev.status<>'approved')
 THEN RAISE(ABORT,'前一项目批准版本尚未正式生效') END;
 SELECT CASE WHEN (SELECT status FROM projects WHERE id=NEW.project_id)='closed'
 THEN RAISE(ABORT,'关闭后不能默默改写项目批准版本，应按正式再批准程序处理') END;
 SELECT CASE WHEN NEW.version_no>1 AND NOT EXISTS(
 SELECT 1 FROM project_change_orders ch
 JOIN project_approval_versions old
 ON old.id=ch.base_approval_version_id
 WHERE ch.id=NEW.change_order_id
 AND ch.project_id=NEW.project_id AND ch.status='approved'
 AND old.version_no=NEW.version_no-1 AND old.project_id=NEW.project_id)
 THEN RAISE(ABORT,'新版项目批准必须对应同项目已批准的正式变更单及上一批准版本') END;
END;

CREATE TRIGGER closure_project_version_guard BEFORE INSERT ON project_closures
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM projects p JOIN project_approval_versions a
 ON a.project_id=p.id WHERE p.id=NEW.project_id
 AND a.id=NEW.approval_version_id AND a.status='approved'
 AND a.version_no=(SELECT MAX(av.version_no) FROM project_approval_versions av
 WHERE av.project_id=p.id AND av.status='approved')
 AND p.status='approved')
 THEN RAISE(ABORT,'结项必须引用子项目最新已批准范围与预算，不能引用历史过期版本') END; END;
CREATE TRIGGER project_close_guard
 BEFORE UPDATE OF status ON projects
 WHEN NEW.status='closed' AND OLD.status<>'closed'
BEGIN
 SELECT CASE WHEN OLD.status<>'approved' OR NOT EXISTS(
 SELECT 1 FROM project_closures c WHERE c.project_id=NEW.id)
 THEN RAISE(ABORT,'正式关闭前必须建立审核与关闭记录') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_closures c JOIN v_project_current_approval a
 ON a.project_id=c.project_id AND a.approval_version_id=c.approval_version_id
 WHERE c.project_id=NEW.id)
 THEN RAISE(ABORT,'结项必须以最新正式批准版本为依据') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM settlements settle
 LEFT JOIN settlement_versions latest ON latest.id=(
  SELECT sv.id FROM settlement_versions sv
  WHERE sv.settlement_id=settle.id
  ORDER BY sv.version_no DESC LIMIT 1)
 LEFT JOIN v_settlement_review_status review
  ON review.settlement_version_id=latest.id
 WHERE settle.project_id=NEW.id
 AND (latest.id IS NULL OR review.last_action IS NULL
      OR review.last_action IN ('submit','return')))
 THEN RAISE(ABORT,'仍有未核定结算单，不能关闭项目') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_change_orders x WHERE x.project_id=NEW.id
 AND x.status IN ('draft','submitted'))
 THEN RAISE(ABORT,'仍有未完成项目变更，不能关闭项目') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_approval_versions x WHERE x.project_id=NEW.id
 AND x.status='draft')
 THEN RAISE(ABORT,'还有未完成的正式项目批准草稿，不能关闭项目') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_change_orders ch
 WHERE ch.project_id=NEW.id AND ch.status='approved'
 AND NOT EXISTS(SELECT 1 FROM project_approval_versions ap
 WHERE ap.change_order_id=ch.id AND ap.status='approved'))
 THEN RAISE(ABORT,'存在已审核但未落实到正式批准范围的项目变更，不能关闭项目') END;
 -- The closure decision records the administrator/verifier's acceptance
 -- of remaining, over-completed or reduced requirements and remaining
 -- actual/unsettled costs in close_snapshot_json. The project status does
 -- not claim everything was completed, paid or reconciled.
 -- Per-cost and per-statement over-application rules are independently
 -- enforced when reconciliation is written; close-out MUST NOT add a
 -- fictitious 100-percent requirement or budget ceiling.

END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_reference_price_update BEFORE UPDATE ON reference_price_versions
 BEGIN SELECT RAISE(ABORT,'历史参考单价版本不可修改'); END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_reference_price_delete BEFORE DELETE ON reference_price_versions
 BEGIN SELECT RAISE(ABORT,'历史参考单价版本不可删除'); END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER valid_branch_insert BEFORE INSERT ON transmission_lines BEGIN
 SELECT CASE WHEN NEW.line_kind='main' AND (NEW.parent_line_id IS NOT NULL OR NEW.junction_tower_id IS NOT NULL) THEN RAISE(ABORT,'主线不能设置上级线路或接入杆塔') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND (NEW.parent_line_id IS NULL AND NEW.setup_status<>'draft' OR NEW.parent_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transmission_lines WHERE id=NEW.parent_line_id AND line_kind='main')) THEN RAISE(ABORT,'支线必须归属主线') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NEW.status='active' AND NEW.setup_status='ready' AND NOT EXISTS(SELECT 1 FROM logical_towers WHERE id=NEW.junction_tower_id AND line_id=NEW.parent_line_id AND status='active') THEN RAISE(ABORT,'支线接入杆塔无效') END;
END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER valid_branch_update BEFORE UPDATE ON transmission_lines BEGIN
 SELECT CASE WHEN NEW.line_kind='main' AND (NEW.parent_line_id IS NOT NULL OR NEW.junction_tower_id IS NOT NULL) THEN RAISE(ABORT,'主线不能设置上级线路或接入杆塔') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND (NEW.parent_line_id IS NULL AND NEW.setup_status<>'draft' OR NEW.parent_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transmission_lines WHERE id=NEW.parent_line_id AND line_kind='main' AND id<>NEW.id)) THEN RAISE(ABORT,'支线必须归属主线') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NEW.status='active' AND NEW.setup_status='ready' AND NOT EXISTS(SELECT 1 FROM logical_towers WHERE id=NEW.junction_tower_id AND line_id=NEW.parent_line_id AND status='active') THEN RAISE(ABORT,'支线接入杆塔无效') END;
END;
CREATE TRIGGER immutable_approval_version_update
BEFORE UPDATE ON project_approval_versions
WHEN OLD.status='approved'
 OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.version_no IS NOT OLD.version_no OR NEW.change_order_id IS NOT OLD.change_order_id
 OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.status='approved' AND
     (NEW.snapshot_json IS NOT OLD.snapshot_json OR
      NEW.approved_budget_fen IS NOT OLD.approved_budget_fen))
BEGIN
 SELECT RAISE(ABORT,'只有正式批准前的预算和正文草稿可以编辑；已批准版本不可覆盖');
END;

CREATE TRIGGER immutable_approval_version_delete
BEFORE DELETE ON project_approval_versions
WHEN OLD.status='approved'
BEGIN SELECT RAISE(ABORT,'已批准的项目历史版本不可删除'); END;



-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_audit_update
BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'审计事件不可覆盖'); END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_audit_delete
BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'审计事件不可删除'); END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER operation_unit_insert BEFORE INSERT ON operation_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dictionary_items
  WHERE id=NEW.default_unit_id AND type_id='unit')
 THEN RAISE(ABORT,'操作类型必须关联计量单位') END;
END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_operation_version_update BEFORE UPDATE ON operation_versions
BEGIN SELECT RAISE(ABORT,'操作类型历史版本不可修改'); END;
CREATE TRIGGER immutable_operation_version_delete BEFORE DELETE ON operation_versions
BEGIN SELECT RAISE(ABORT,'操作类型正式历史不可删除'); END;


-- The first span of a branch must connect its confirmed junction tower on
-- the parent MAIN line to a tower on the branch. Other cross-line edges are
-- invalid, even when both endpoints happen to share a physical structure.


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER span_line_consistency_insert BEFORE INSERT ON line_spans
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM transmission_lines l
 JOIN logical_towers a ON a.id=NEW.start_tower_id
 JOIN logical_towers b ON b.id=NEW.end_tower_id
 WHERE l.id=NEW.line_id
 AND (a.line_id=l.id OR (l.line_kind='branch' AND
 a.id=l.junction_tower_id AND a.line_id=l.parent_line_id))
 AND (b.line_id=l.id OR (l.line_kind='branch' AND
 b.id=l.junction_tower_id AND b.line_id=l.parent_line_id))
 AND (a.line_id=l.id OR b.line_id=l.id)
 ) THEN RAISE(ABORT,'档距端点必须属于本线路或合法支线接入杆塔') END;
END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER span_line_consistency_update
BEFORE UPDATE OF line_id,start_tower_id,end_tower_id ON line_spans
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM transmission_lines l
 JOIN logical_towers a ON a.id=NEW.start_tower_id
 JOIN logical_towers b ON b.id=NEW.end_tower_id
 WHERE l.id=NEW.line_id
 AND (a.line_id=l.id OR (l.line_kind='branch' AND
 a.id=l.junction_tower_id AND a.line_id=l.parent_line_id))
 AND (b.line_id=l.id OR (l.line_kind='branch' AND
 b.id=l.junction_tower_id AND b.line_id=l.parent_line_id))
 AND (a.line_id=l.id OR b.line_id=l.id)
 ) THEN RAISE(ABORT,'档距端点必须属于本线路或合法支线接入杆塔') END;
END;

-- New demands must follow the currently approved operation definition. The
-- immutable operation_version FK keeps existing historical facts valid later.


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER demand_definition_insert BEFORE INSERT ON demands
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operation_versions o
 WHERE o.operation_id=NEW.operation_id AND o.version=NEW.operation_version
 AND o.work_target_type=NEW.work_target_type AND o.default_unit_id=NEW.unit_id
 AND ((NEW.span_id IS NULL AND o.allow_tower=1) OR
      (NEW.span_id IS NOT NULL AND o.allow_span=1)))
 THEN RAISE(ABORT,'需求操作类型、单位或位置不符合操作定义') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items u
 WHERE u.id=NEW.unit_id AND u.type_id='unit')
 THEN RAISE(ABORT,'需求计量单位类型无效') END;
 SELECT CASE WHEN NEW.priority_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM dictionary_items p WHERE p.id=NEW.priority_id AND p.type_id='priority')
 THEN RAISE(ABORT,'需求优先级类型无效') END;
 SELECT CASE WHEN NEW.logical_tower_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM logical_towers t WHERE t.id=NEW.logical_tower_id
 AND t.physical_tower_id=NEW.observed_physical_tower_id)
 THEN RAISE(ABORT,'需求杆塔实体关联与实际位置不一致') END;
 SELECT CASE WHEN NEW.span_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM line_spans sp WHERE sp.id=NEW.span_id AND sp.version=NEW.span_version)
 THEN RAISE(ABORT,'需求档距版本已变化') END;
END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER change_order_project_insert BEFORE INSERT ON project_change_orders
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_approval_versions a
 WHERE a.id=NEW.base_approval_version_id AND a.project_id=NEW.project_id)
 THEN RAISE(ABORT,'项目变更单批准基线不属于该子项目') END;
END;


-- Dictionary categories are semantic foreign keys, not interchangeable IDs.


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER source_category_insert BEFORE INSERT ON source_records
WHEN NEW.type_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.type_id AND type_id='source')
 THEN RAISE(ABORT,'来源类别必须引用来源字典') END; END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER source_category_update BEFORE UPDATE OF type_id ON source_records
WHEN NEW.type_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.type_id AND type_id='source')
 THEN RAISE(ABORT,'来源类别必须引用来源字典') END; END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER project_management_category_insert
 BEFORE INSERT ON project_management_versions
WHEN NEW.category_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM dictionary_items item
 JOIN dictionary_item_versions v ON v.item_id=item.id AND v.version=NEW.category_version
 WHERE item.id=NEW.category_id AND item.type_id='project_category')
 THEN RAISE(ABORT,'子项目正式档案的类别必须引用对应项目类别字典的准确版本') END; END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER dictionary_item_root_immutable_update BEFORE UPDATE ON dictionary_items
BEGIN SELECT RAISE(ABORT,'基础字典项的编码与类型属于稳定身份'); END;
CREATE TRIGGER dictionary_item_root_immutable_delete BEFORE DELETE ON dictionary_items
BEGIN SELECT RAISE(ABORT,'已建档的字典身份不可删除'); END;
CREATE TRIGGER dictionary_item_version_sequence BEFORE INSERT ON dictionary_item_versions
BEGIN
 SELECT CASE WHEN NEW.version<>(SELECT COALESCE(MAX(v.version),0)+1
 FROM dictionary_item_versions v WHERE v.item_id=NEW.item_id)
 THEN RAISE(ABORT,'字典版本必须从1连续递增') END;
 SELECT CASE WHEN NEW.changed_at<
 (SELECT i.created_at FROM dictionary_items i WHERE i.id=NEW.item_id)
 OR NEW.changed_at<
 (SELECT MAX(v.changed_at) FROM dictionary_item_versions v WHERE v.item_id=NEW.item_id)
 THEN RAISE(ABORT,'字典正式定义不得早于根身份或上一历史版本') END;
 SELECT CASE WHEN NEW.version>1 AND EXISTS(
 SELECT 1 FROM dictionary_item_versions previous
 WHERE previous.item_id=NEW.item_id AND previous.version=NEW.version-1
 AND previous.name=NEW.name AND previous.status=NEW.status
 AND previous.sort_order=NEW.sort_order AND previous.fields_json=NEW.fields_json)
 THEN RAISE(ABORT,'字典定义没有真实变化，不允许新增空版本') END;
END;
CREATE TRIGGER dictionary_item_version_immutable_update BEFORE UPDATE ON dictionary_item_versions
BEGIN SELECT RAISE(ABORT,'字典版本历史不可覆盖'); END;
CREATE TRIGGER dictionary_item_version_immutable_delete BEFORE DELETE ON dictionary_item_versions
BEGIN SELECT RAISE(ABORT,'字典版本历史不可删除'); END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER reference_price_unit_insert BEFORE INSERT ON reference_price_versions
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operation_versions o
 JOIN dictionary_items u ON u.id=o.default_unit_id AND u.type_id='unit'
 WHERE o.operation_id=NEW.operation_id AND o.version=NEW.operation_version
 AND o.default_unit_id=NEW.unit_id)
 THEN RAISE(ABORT,'参考价格单位必须与操作类型固定单位一致') END; END;

-- Extensible price factors reuse the existing VERSIONED dictionary:
-- dictionary_types.id='price_factor'; item.code is a stable factor key;
-- item version fields_json.kind is either 'enum' or 'number'.
-- Every rule atomically embeds its full typed predicates in its immutable
-- reference_price_versions row; an older rule pins the exact factor version.
-- Category-match/pricing search itself remains an application function.
-- A single location-specific rule can price 1/2/3/... devices; price
-- quantity is NOT the number of towers. Brackets are immutable and validated
-- for non-overlap and well-defined per-band pricing.
CREATE TRIGGER reference_price_quantity_bracket_guard
 BEFORE INSERT ON reference_price_versions
BEGIN
 SELECT CASE WHEN NEW.pricing_mode<>'quantity_bracket'
   AND (NEW.quantity_brackets_json<>'[]'
    OR (NEW.pricing_mode='per_unit' AND NEW.base_fee_fen<>0))
 THEN RAISE(ABORT,'非分档价格不能保存分档明细，按件计价不得有基位固定费') END;
 SELECT CASE WHEN NEW.pricing_mode='quantity_bracket'
   AND (json_array_length(NEW.quantity_brackets_json)=0
   OR NEW.base_fee_fen<>0 OR NEW.unit_price_fen<>0)
 THEN RAISE(ABORT,'分档计价须有分档完整定义，不重复存储固定/单位单价') END;
 SELECT CASE WHEN NEW.pricing_mode='quantity_bracket'
 AND EXISTS(
  SELECT 1 FROM json_each(NEW.quantity_brackets_json) band
  WHERE json_type(band.value)<>'object'
     OR json_type(band.value,'$.min_quantity_scaled')<>'integer'
     OR json_extract(band.value,'$.min_quantity_scaled')<=0
     OR json_type(band.value,'$.max_quantity_scaled') IS NULL
     OR json_type(band.value,'$.max_quantity_scaled') NOT IN ('null','integer')
     OR (json_type(band.value,'$.max_quantity_scaled')='integer'
         AND json_extract(band.value,'$.max_quantity_scaled')<
             json_extract(band.value,'$.min_quantity_scaled'))
     OR json_type(band.value,'$.base_fee_fen')<>'integer'
     OR json_extract(band.value,'$.base_fee_fen')<0
     OR json_type(band.value,'$.unit_price_fen')<>'integer'
     OR json_extract(band.value,'$.unit_price_fen')<0
 ) THEN RAISE(ABORT,'计价分档须包含有效数量上下限及非负的基位费/件单价') END;
 SELECT CASE WHEN NEW.pricing_mode='quantity_bracket'
 AND EXISTS(
  SELECT 1 FROM json_each(NEW.quantity_brackets_json) first
  JOIN json_each(NEW.quantity_brackets_json) second
   ON CAST(first.key AS INTEGER)<CAST(second.key AS INTEGER)
  WHERE (json_extract(first.value,'$.max_quantity_scaled') IS NULL
     OR json_extract(first.value,'$.max_quantity_scaled')>=
        json_extract(second.value,'$.min_quantity_scaled'))
     OR json_extract(first.value,'$.min_quantity_scaled')>=
        json_extract(second.value,'$.min_quantity_scaled')
 ) THEN RAISE(ABORT,'计价分档范围必须按数量递增且互不重叠') END;
END;
CREATE TRIGGER reference_price_factor_definition_guard
 BEFORE INSERT ON reference_price_versions
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.additional_conditions_json) j
  GROUP BY j.key HAVING COUNT(*)>1
 ) THEN RAISE(ABORT,'参考价扩展价格因素不能重复声明') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.additional_conditions_json) j
  LEFT JOIN dictionary_items f
   ON f.type_id='price_factor' AND f.code=j.key
  LEFT JOIN dictionary_item_versions fv ON fv.item_id=f.id
   AND fv.version=json_extract(j.value,'$.factor_version')
  WHERE f.id IS NULL OR fv.id IS NULL
   OR fv.status<>'active' OR fv.changed_at>NEW.created_at
   OR fv.version<>(
     SELECT MAX(vers.version) FROM dictionary_item_versions vers
     WHERE vers.item_id=f.id)
   OR json_type(j.value)<>'object'
   OR json_type(j.value,'$.factor_version')<>'integer'
   OR COALESCE((
    (json_extract(fv.fields_json,'$.kind')='enum'
      AND json_extract(j.value,'$.op')='eq'
      AND json_type(j.value,'$.value')='text'
      AND length(trim(json_extract(j.value,'$.value')))>0)
    OR
    (json_extract(fv.fields_json,'$.kind')='number'
      AND json_extract(j.value,'$.op')='range'
      AND json_type(j.value,'$.min')='integer'
      AND json_type(j.value,'$.max')='integer'
      AND json_extract(j.value,'$.min')<=json_extract(j.value,'$.max'))
   ),0)=0
 ) THEN RAISE(ABORT,'参考价格扩展因素须引用有效的正式定义版本并使用正确值类型') END;
END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_cost_version_delete BEFORE DELETE ON cost_versions
BEGIN SELECT RAISE(ABORT,'已确认费用不可清除，请明确撤销'); END;


-- Retained original asset, demand, category or audit rule.
CREATE TRIGGER immutable_cost_reconciliation_delete BEFORE DELETE ON cost_reconciliation_versions
BEGIN SELECT RAISE(ABORT,'费用结算核对历史不可清除'); END;

-- Operation unit must be an ordinary UNIT dictionary record.


-- Retained original asset, demand, category or audit rule.

CREATE INDEX idx_lines_voltage ON transmission_lines(voltage_level_id);
CREATE INDEX idx_logical_towers_physical ON logical_towers(physical_tower_id);
CREATE INDEX idx_logical_towers_name ON logical_towers(line_id, tower_no);
CREATE UNIQUE INDEX uq_logical_towers_active_order
    ON logical_towers(line_id, sort_rank) WHERE status = 'active';
CREATE INDEX idx_audit_entity ON audit_events(entity,entity_id,created_at);
CREATE INDEX idx_demands_tower ON demands(logical_tower_id,operation_id);
CREATE INDEX idx_operation_versions_unit ON operation_versions(default_unit_id,status);
CREATE INDEX idx_agreement_framework ON agreements(framework_id);
CREATE INDEX idx_project_funding_agreement ON project_funding_versions(agreement_id,project_id);
CREATE INDEX idx_projects_framework ON projects(framework_id,status);
CREATE INDEX idx_reference_price_versions_operation ON reference_price_versions(operation_id,unit_id,status);
CREATE INDEX idx_project_scope_demand ON project_demand_scopes(demand_id);
CREATE INDEX idx_project_demand_link_event_history
 ON project_demand_link_events(actor_id,recorded_at);
CREATE INDEX idx_line_parent ON transmission_lines(parent_line_id);
CREATE UNIQUE INDEX uq_current_span_pair ON line_spans(line_id,min(start_tower_id,end_tower_id),max(start_tower_id,end_tower_id)) WHERE status<>'retired';
CREATE INDEX idx_span_end ON line_spans(end_tower_id);
CREATE INDEX idx_span_start ON line_spans(start_tower_id);
CREATE INDEX idx_demand_context_line ON demands(context_line_id);
CREATE INDEX idx_demands_physical ON demands(physical_tower_id,operation_id);
CREATE INDEX idx_demand_span ON demands(span_id);
CREATE INDEX idx_duplicate_review_batch ON demand_duplicate_reviews(batch_id);
CREATE INDEX idx_project_changes ON project_change_orders(project_id,status);
-- Replaced by typed evidence_links (no generic attachment foreign keys).
-- Replaced by typed evidence_links (no generic attachment foreign keys).
CREATE INDEX idx_source_record_type ON source_records(type_id);
CREATE INDEX idx_demand_sources_reverse ON demand_sources(source_id,demand_id);
CREATE INDEX idx_change_order_approval ON project_change_orders(base_approval_version_id);
CREATE INDEX idx_spans_line_status ON line_spans(line_id,status);


-- A demand inherits the operation's standard object automatically; the
-- frozen object/name is retained even if the operation definition later evolves.
CREATE TRIGGER demand_work_object_match_insert BEFORE INSERT ON demands
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM operation_versions o WHERE o.operation_id=NEW.operation_id
 AND o.version=NEW.operation_version
 AND o.work_object_id=NEW.work_object_id
 AND o.work_target_type=NEW.work_target_type)
 THEN RAISE(ABORT,'需求标准作业对象必须来自所选操作类型') END; END;




-- The following are read-only management indicators. Overages never throw,
-- rewrite an approved baseline, or require a fake correction to match plan.
-- Current material budget follows the latest approved project scope,
-- but actual consumption is grouped by the stable material identity across
-- EVERY historical approval version of the same material.
CREATE VIEW v_approved_material_current AS
SELECT m.* FROM project_approval_material_items m
JOIN v_approval_scope_current a
 ON a.approval_version_id=m.approval_version_id
 AND a.project_scope_id=m.project_scope_id;

-- Current typed configuration definitions, derived from each latest
-- immutable definition version (no second mutable definition copy).
CREATE VIEW v_dictionary_current AS
SELECT i.id,i.type_id,i.code,i.created_at,v.id AS current_version_id,
 v.version,v.name,v.status,v.sort_order,v.fields_json,v.changed_at AS updated_at
FROM dictionary_items i JOIN dictionary_item_versions v ON v.item_id=i.id
WHERE v.version=(SELECT MAX(x.version) FROM dictionary_item_versions x
 WHERE x.item_id=i.id);

CREATE VIEW v_operation_current AS
SELECT o.id,o.code,o.created_at,
 v.id AS current_version_id,v.version,v.name,v.status,v.sort_order,
 v.work_target_type,v.work_object_id,v.default_unit_id,v.default_unit_version,
 v.default_quantity_scaled,v.completion_standard,v.fields_json,
 v.allow_tower,v.allow_span,v.default_location_kind,v.default_target_object,
 v.entry_hint,v.changed_at AS updated_at
FROM operations o JOIN operation_versions v ON v.operation_id=o.id
WHERE v.version=(SELECT MAX(x.version) FROM operation_versions x
 WHERE x.operation_id=o.id);

CREATE VIEW v_reference_price_current AS
SELECT c.id,c.code,c.created_by,c.created_at,
 v.id AS current_version_id,v.version_no,v.title,v.operation_id,
 v.operation_version,v.unit_id,v.unit_version,v.voltage_level_id,v.tower_type,
 v.work_mode,v.specification,v.additional_conditions_json,
 v.status,v.pricing_mode,v.pricing_scope,v.calculation_params_json,
 v.fee_components_json,v.base_fee_fen,v.unit_price_fen,
 v.quantity_brackets_json,v.tax_mode,v.effective_on
FROM reference_price_catalog c
JOIN reference_price_versions v ON v.catalog_id=c.id
WHERE v.version_no=(SELECT MAX(x.version_no)
 FROM reference_price_versions x WHERE x.catalog_id=c.id);

CREATE VIEW v_framework_current AS
SELECT f.id,f.code,f.fiscal_year,f.created_at,
 v.id AS current_version_id,v.version_no,v.name,v.limit_fen,v.status
FROM frameworks f JOIN framework_versions v ON v.framework_id=f.id
WHERE v.version_no=(SELECT MAX(x.version_no) FROM framework_versions x
 WHERE x.framework_id=f.id);

CREATE VIEW v_agreement_current AS
SELECT a.id,a.code,a.framework_id,a.created_at,
 v.id AS current_version_id,v.version_no,v.name,v.limit_fen,v.status,
 v.contract_number,v.counterparty_name,v.signed_on,v.effective_from,v.effective_to
FROM agreements a JOIN agreement_versions v ON v.agreement_id=a.id
WHERE v.version_no=(SELECT MAX(x.version_no) FROM agreement_versions x
 WHERE x.agreement_id=a.id);

CREATE VIEW v_work_object_current AS
SELECT o.id,o.code,o.created_at,
 v.id AS current_version_id,v.version_no,v.name,v.work_target_type,
 v.status,v.sort_order
FROM work_objects o JOIN work_object_versions v ON v.work_object_id=o.id
WHERE v.version_no=(SELECT MAX(x.version_no) FROM work_object_versions x
 WHERE x.work_object_id=o.id);

CREATE VIEW v_project_current_approval AS
SELECT p.id AS project_id,a.id AS approval_version_id,
 a.version_no AS approval_version_no,a.approved_budget_fen
FROM projects p
LEFT JOIN project_approval_versions a ON a.project_id=p.id
 AND a.status='approved'
 AND a.version_no=(SELECT MAX(v.version_no) FROM project_approval_versions v
 WHERE v.project_id=p.id AND v.status='approved');

CREATE VIEW v_project_funding_current AS
SELECT p.id AS project_id,p.framework_id,
 f.id AS funding_version_id,f.version_no AS funding_version_no,
 f.agreement_id
FROM projects p
LEFT JOIN project_funding_versions f ON f.project_id=p.id
 AND f.version_no=(SELECT MAX(v.version_no) FROM project_funding_versions v
 WHERE v.project_id=p.id);
CREATE TRIGGER cost_reconciliation_amount_cap
BEFORE INSERT ON cost_reconciliation_versions
BEGIN
 -- A NEW active application of money requires the CURRENT approved
 -- statement snapshot and a currently active real cost. A historical
 -- void is not a new application and must remain possible after either
 -- side has been formally superseded. Its unchanged prior identity and
 -- amounts are checked in reconciliation_version_sequential_insert.
 SELECT CASE WHEN NEW.status='active' AND NOT EXISTS(
  SELECT 1 FROM cost_versions cv JOIN cost_entries ce ON ce.id=cv.entry_id
  JOIN v_cost_current current_cv ON current_cv.entry_id=ce.id
    AND current_cv.status='active'
  JOIN settlement_items item ON item.id=NEW.settlement_item_id
  JOIN settlements settlement_doc ON settlement_doc.id=item.settlement_id
    AND settlement_doc.project_id=ce.project_id
    AND item.cost_node_id=ce.cost_node_id
  JOIN settlement_item_versions iv ON iv.settlement_item_id=item.id
  JOIN v_effective_settlement_items effective_item
   ON effective_item.settlement_item_version_id=iv.id
   AND effective_item.id=item.id
  WHERE cv.id=NEW.cost_version_id AND item.id=NEW.settlement_item_id
    AND iv.id=NEW.settlement_item_version_id AND cv.status='active')
 THEN RAISE(ABORT,'费用核对必须匹配已确认费用及同结算单已批准的历史明细') END;
 -- Only genuine financial duplicates are blocked, not budget overages.
 -- For a correction version of one reconciliation record, its previous
 -- revision is replaced, not counted again.
 SELECT CASE WHEN NEW.status='active' AND
 NEW.reconciled_cost_fen+COALESCE((SELECT SUM(r.reconciled_cost_fen)
 FROM v_effective_cost_reconciliations r
 WHERE r.entry_id=(SELECT entry_id FROM cost_versions WHERE id=NEW.cost_version_id)
 AND r.record_id<>NEW.record_id),0)>
 (SELECT amount_fen FROM v_cost_current
  WHERE entry_id=(SELECT entry_id FROM cost_versions WHERE id=NEW.cost_version_id))
 THEN RAISE(ABORT,'同一真实费用的有效核对累计金额不能超过该费用自身') END;
 SELECT CASE WHEN NEW.status='active' AND
 NEW.reconciled_settlement_fen+COALESCE((SELECT SUM(r.reconciled_settlement_fen)
 FROM v_effective_cost_reconciliations r
 WHERE r.settlement_item_version_id=NEW.settlement_item_version_id
 AND r.record_id<>NEW.record_id),0)>
 (SELECT amount_fen FROM settlement_item_versions
  WHERE id=NEW.settlement_item_version_id)
 THEN RAISE(ABORT,'同一历史结算明细的有效核对累计金额不能超过该明细金额') END;
END;



-- Settlement identity and submitted snapshots are immutable business facts.
-- Draft edits are held only in settlement_drafts and never enter reports.
CREATE TRIGGER settlement_identity_update BEFORE UPDATE ON settlements
BEGIN SELECT RAISE(ABORT,'结算业务身份不可覆盖，应另建正式结算版本'); END;
CREATE TRIGGER settlement_identity_delete BEFORE DELETE ON settlements
BEGIN SELECT RAISE(ABORT,'结算业务身份不可删除'); END;

CREATE TRIGGER settlement_version_insert_guard BEFORE INSERT ON settlement_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlements s JOIN project_approval_versions a
 ON a.project_id=s.project_id WHERE s.id=NEW.settlement_id
 AND a.id=NEW.approval_version_id
 AND a.status='approved'
 AND (SELECT status FROM projects p WHERE p.id=s.project_id)='approved')
 THEN RAISE(ABORT,'正式结算历史版本必须对应已批准项目及其批准版本') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM project_funding_versions v
 JOIN settlements st ON st.project_id=v.project_id
 WHERE st.id=NEW.settlement_id)
 AND NEW.funding_version_id IS NULL
 THEN RAISE(ABORT,'有资金归属历史的子项目结算必须绑定对应历史资金版本') END;
 SELECT CASE WHEN NEW.funding_version_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM settlements s JOIN project_funding_versions f
 ON f.project_id=s.project_id
 WHERE s.id=NEW.settlement_id AND f.id=NEW.funding_version_id
 AND f.recorded_at<=NEW.recorded_at)
 THEN RAISE(ABORT,'结算所引用的资金版本必须属于本项目且不得晚于结算登记') END;
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM settlement_versions v WHERE v.settlement_id=NEW.settlement_id)
 THEN RAISE(ABORT,'结算版本号必须连续增加') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT settle.created_at FROM settlements settle WHERE settle.id=NEW.settlement_id)
 OR NEW.recorded_at<
 (SELECT MAX(v.recorded_at) FROM settlement_versions v
  WHERE v.settlement_id=NEW.settlement_id)
 THEN RAISE(ABORT,'结算正式版本不得早于单据身份创建或上一版本登记') END;
 SELECT CASE WHEN NEW.version_no>1 AND
 (SELECT x.id FROM settlement_versions x WHERE x.settlement_id=NEW.settlement_id
 ORDER BY x.version_no DESC LIMIT 1) IS NOT NEW.previous_version_id
 THEN RAISE(ABORT,'结算版本的前驱引用必须是上一正式版本') END;
 SELECT CASE WHEN NEW.change_type='void' AND NOT EXISTS(
 SELECT 1 FROM v_settlement_approval_timeline x WHERE x.settlement_id=NEW.settlement_id)
 THEN RAISE(ABORT,'未曾确认的结算无需创建正式注销版本') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM v_settlement_effective_versions a
 WHERE a.settlement_id=NEW.settlement_id AND a.change_type='void')
 THEN RAISE(ABORT,'正式注销的结算不可重新激活，需新建独立结算单') END;
END;
CREATE TRIGGER settlement_version_immutable_update BEFORE UPDATE ON settlement_versions
BEGIN SELECT RAISE(ABORT,'已建立的结算历史版本不可直接修改'); END;
CREATE TRIGGER settlement_version_immutable_delete BEFORE DELETE ON settlement_versions
BEGIN SELECT RAISE(ABORT,'已建立的结算历史版本不可删除'); END;

CREATE TRIGGER settlement_item_identity_insert BEFORE INSERT ON settlement_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlements s JOIN project_cost_nodes n ON n.project_id=s.project_id
 WHERE s.id=NEW.settlement_id AND n.id=NEW.cost_node_id)
 THEN RAISE(ABORT,'结算费用项必须属于结算单所在子项目') END;
 SELECT CASE WHEN NEW.project_scope_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM settlements s JOIN project_demand_scopes d ON d.project_id=s.project_id
 WHERE s.id=NEW.settlement_id AND d.id=NEW.project_scope_id)
 THEN RAISE(ABORT,'结算作业范围必须属于结算单所在子项目') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM project_cost_nodes c WHERE c.parent_id=NEW.cost_node_id)
 THEN RAISE(ABORT,'只能结算费用树的末级费用项') END;
 SELECT CASE WHEN EXISTS(
 WITH RECURSIVE fee_path(id,parent_id) AS (
  SELECT id,parent_id FROM project_cost_nodes WHERE id=NEW.cost_node_id
  UNION ALL SELECT n.id,n.parent_id FROM project_cost_nodes n
    JOIN fee_path p ON n.id=p.parent_id)
 SELECT 1 FROM fee_path p LEFT JOIN v_project_cost_node_current v ON v.id=p.id
 WHERE COALESCE(v.status,'undefined')<>'active')
 THEN RAISE(ABORT,'费用项及全部上级科目必须启用才能新增结算明细') END;
END;
CREATE TRIGGER settlement_item_identity_update BEFORE UPDATE ON settlement_items
BEGIN SELECT RAISE(ABORT,'结算明细身份不可更改；改内容需增加结算版本'); END;
CREATE TRIGGER settlement_item_identity_delete BEFORE DELETE ON settlement_items
BEGIN SELECT RAISE(ABORT,'结算明细身份不可删除'); END;

CREATE TRIGGER settlement_item_version_insert_guard
 BEFORE INSERT ON settlement_item_versions
BEGIN
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM settlement_review_events e
 WHERE e.settlement_version_id=NEW.settlement_version_id)
 THEN RAISE(ABORT,'已提交或审核过的结算版本不能新增或改写明细') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlement_versions v JOIN settlement_items i
 ON i.settlement_id=v.settlement_id
 LEFT JOIN project_approval_scope_versions a
 ON a.approval_version_id=v.approval_version_id AND a.project_scope_id=i.project_scope_id
 WHERE v.id=NEW.settlement_version_id AND i.id=NEW.settlement_item_id
 AND ((i.project_scope_id IS NULL AND NEW.approval_scope_version_id IS NULL
       AND NEW.quantity_scaled=0)
   OR (i.project_scope_id IS NOT NULL
       AND a.id=NEW.approval_scope_version_id)))
 THEN RAISE(ABORT,'结算明细历史版本与项目批准范围版本不匹配') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlement_items i JOIN project_cost_node_versions nv
   ON nv.node_id=i.cost_node_id
 WHERE i.id=NEW.settlement_item_id AND nv.id=NEW.cost_node_version_id)
 THEN RAISE(ABORT,'结算明细采用的费用定义版本与费用节点不匹配') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_cost_node_versions nv
 JOIN settlement_versions sv ON sv.id=NEW.settlement_version_id
 WHERE nv.id=NEW.cost_node_version_id AND nv.recorded_at<=sv.recorded_at)
 THEN RAISE(ABORT,'结算明细不能引用登记时间晚于结算版本的费用科目定义') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM settlement_versions v
 WHERE v.id=NEW.settlement_version_id AND v.change_type='void')
 THEN RAISE(ABORT,'注销结算版本不应再包含有效明细') END;
END;
CREATE TRIGGER settlement_scope_result_insert_guard
 BEFORE INSERT ON settlement_scope_results
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlement_versions sv
 JOIN settlements s ON s.id=sv.settlement_id
 JOIN project_demand_scopes sc ON sc.project_id=s.project_id
 JOIN project_approval_scope_versions aps
  ON aps.id=NEW.approval_scope_version_id
  AND aps.project_scope_id=sc.id
  AND aps.approval_version_id=sv.approval_version_id
 WHERE sv.id=NEW.settlement_version_id
   AND sc.id=NEW.project_scope_id AND sv.change_type<>'void'
   AND NOT EXISTS(SELECT 1 FROM settlement_review_events e
    WHERE e.settlement_version_id=sv.id))
 THEN RAISE(ABORT,'本次结算需求解决结果须关联同项目当次批准的需求范围，且须在提交前完整写入') END;
END;
CREATE TRIGGER settlement_scope_result_immutable_update
 BEFORE UPDATE ON settlement_scope_results
BEGIN SELECT RAISE(ABORT,'已发布结算的需求解决结果不可原地修改，须发布新版完整结算'); END;
CREATE TRIGGER settlement_scope_result_immutable_delete
 BEFORE DELETE ON settlement_scope_results
BEGIN SELECT RAISE(ABORT,'结算需求解决结果历史不可删除'); END;

CREATE TRIGGER settlement_item_version_immutable_update
 BEFORE UPDATE ON settlement_item_versions
BEGIN SELECT RAISE(ABORT,'结算明细完整版本不可覆盖'); END;
CREATE TRIGGER settlement_item_version_immutable_delete
 BEFORE DELETE ON settlement_item_versions
BEGIN SELECT RAISE(ABORT,'结算明细完整版本不可删除'); END;

-- Review events provide an ordered approval history. One submitted snapshot
-- can be returned and resubmitted without changes; changed content requires
-- a new immutable version. Pending new versions never replace approved ones.
CREATE TRIGGER settlement_review_event_insert_guard
 BEFORE INSERT ON settlement_review_events
BEGIN
 SELECT CASE WHEN NEW.event_seq<>(SELECT COALESCE(MAX(e.event_seq),0)+1
 FROM settlement_review_events e WHERE e.settlement_version_id=NEW.settlement_version_id)
 THEN RAISE(ABORT,'结算审核事件序号必须连续增加') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT sv.recorded_at FROM settlement_versions sv WHERE sv.id=NEW.settlement_version_id)
 OR NEW.recorded_at<
 (SELECT MAX(e.recorded_at) FROM settlement_review_events e
  WHERE e.settlement_version_id=NEW.settlement_version_id)
 THEN RAISE(ABORT,'结算审核记录不得早于正式单据版本或上一审核事件') END;
 SELECT CASE WHEN NEW.action='submit' AND
 COALESCE((SELECT e.action FROM settlement_review_events e
 WHERE e.settlement_version_id=NEW.settlement_version_id
 ORDER BY e.event_seq DESC LIMIT 1),'initial') NOT IN ('initial','return')
 THEN RAISE(ABORT,'结算只能首次提交或者在退回后重新提交') END;
 SELECT CASE WHEN NEW.action IN ('approve','return','reject') AND
 COALESCE((SELECT e.action FROM settlement_review_events e
 WHERE e.settlement_version_id=NEW.settlement_version_id
 ORDER BY e.event_seq DESC LIMIT 1),'initial')<>'submit'
 THEN RAISE(ABORT,'结算必须先提交才能审核') END;
 SELECT CASE WHEN NEW.action='submit' AND
 (SELECT change_type FROM settlement_versions WHERE id=NEW.settlement_version_id)<>'void'
 AND NOT EXISTS(SELECT 1 FROM settlement_item_versions i
 WHERE i.settlement_version_id=NEW.settlement_version_id)
 THEN RAISE(ABORT,'完整结算版本至少包含一条正式明细') END;

 SELECT CASE WHEN NEW.action IN ('submit','approve')
 AND (SELECT change_type FROM settlement_versions
      WHERE id=NEW.settlement_version_id)<>'void'
 AND NOT EXISTS(SELECT 1 FROM settlement_scope_results r
   WHERE r.settlement_version_id=NEW.settlement_version_id)
 THEN RAISE(ABORT,'每张正式结算单必须明确记录本次解决的至少一项需求及实际数量') END;
 SELECT CASE WHEN NEW.action IN ('submit','approve')
 AND EXISTS(
  SELECT 1 FROM settlement_item_versions iv
  JOIN settlement_items item ON item.id=iv.settlement_item_id
  WHERE iv.settlement_version_id=NEW.settlement_version_id
    AND item.project_scope_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM settlement_scope_results r
     WHERE r.settlement_version_id=NEW.settlement_version_id
       AND r.project_scope_id=item.project_scope_id))
 THEN RAISE(ABORT,'有明确需求归属的结算费用明细必须对应本次需求解决结果') END;

 SELECT CASE WHEN NEW.action='approve' AND
 (SELECT v.version_no FROM settlement_versions v WHERE v.id=NEW.settlement_version_id)
 <>(SELECT MAX(x.version_no) FROM settlement_versions x WHERE x.settlement_id=
 (SELECT settlement_id FROM settlement_versions WHERE id=NEW.settlement_version_id))
 THEN RAISE(ABORT,'只能审核最新的正式结算版本') END;
 SELECT CASE WHEN NEW.action='approve' AND EXISTS(
 SELECT 1 FROM v_settlement_approval_timeline x
 WHERE x.settlement_id=(SELECT settlement_id FROM settlement_versions
 WHERE id=NEW.settlement_version_id)
 AND x.version_no>=(SELECT version_no FROM settlement_versions
 WHERE id=NEW.settlement_version_id))
 THEN RAISE(ABORT,'已存在同版或更新的审核生效结算，不允许重复确认') END;
END;
CREATE TRIGGER settlement_review_event_immutable_update
 BEFORE UPDATE ON settlement_review_events
BEGIN SELECT RAISE(ABORT,'结算审核历史不可覆盖'); END;
CREATE TRIGGER settlement_review_event_immutable_delete
 BEFORE DELETE ON settlement_review_events
BEGIN SELECT RAISE(ABORT,'结算审核历史不可删除'); END;

CREATE TRIGGER approval_scope_link_guard
 BEFORE INSERT ON project_approval_scope_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM v_project_demand_binding_current held
 JOIN project_approval_versions a ON a.project_id=held.project_id
 WHERE a.id=NEW.approval_version_id
 AND held.project_scope_id=NEW.project_scope_id)
 THEN RAISE(ABORT,'批准草稿不能新增已解绑或被其他项目占用的需求范围') END;
END;

CREATE TRIGGER approved_scope_project_guard
 BEFORE INSERT ON project_approval_scope_versions
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_approval_versions a JOIN project_demand_scopes sc
 ON sc.project_id=a.project_id
 WHERE a.id=NEW.approval_version_id AND sc.id=NEW.project_scope_id)
 THEN RAISE(ABORT,'项目批准需求范围历史必须归属同一项目') END; END;
CREATE TRIGGER approved_scope_immutable_update
BEFORE UPDATE ON project_approval_scope_versions
WHEN EXISTS(SELECT 1 FROM project_approval_versions a
 WHERE a.id=OLD.approval_version_id AND a.status='approved')
 OR NEW.id IS NOT OLD.id OR NEW.approval_version_id IS NOT OLD.approval_version_id
 OR NEW.project_scope_id IS NOT OLD.project_scope_id
 OR NEW.demand_id IS NOT OLD.demand_id
BEGIN SELECT RAISE(ABORT,'已批准需求范围不可覆盖；草稿可编辑数量但不能改挂业务身份'); END;

CREATE TRIGGER approved_scope_immutable_delete
BEFORE DELETE ON project_approval_scope_versions
WHEN EXISTS(SELECT 1 FROM project_approval_versions a
 WHERE a.id=OLD.approval_version_id AND a.status='approved')
BEGIN SELECT RAISE(ABORT,'已批准项目需求范围历史不可删除'); END;



-- Other business definitions require snapshots but not full event-sourcing.
CREATE TRIGGER framework_versions_immutable_update BEFORE UPDATE ON framework_versions
BEGIN SELECT RAISE(ABORT,'年度框架历史不可覆盖'); END;
CREATE TRIGGER framework_versions_immutable_delete BEFORE DELETE ON framework_versions
BEGIN SELECT RAISE(ABORT,'年度框架历史不可删除'); END;
CREATE TRIGGER agreement_versions_immutable_update BEFORE UPDATE ON agreement_versions
BEGIN SELECT RAISE(ABORT,'执行协议历史不可覆盖'); END;
CREATE TRIGGER agreement_versions_immutable_delete BEFORE DELETE ON agreement_versions
BEGIN SELECT RAISE(ABORT,'执行协议历史不可删除'); END;
CREATE TRIGGER work_object_versions_immutable_update BEFORE UPDATE ON work_object_versions
BEGIN SELECT RAISE(ABORT,'标准作业对象历史不可覆盖'); END;
CREATE TRIGGER work_object_versions_immutable_delete BEFORE DELETE ON work_object_versions
BEGIN SELECT RAISE(ABORT,'标准作业对象历史不可删除'); END;

-- Helpful FK / history indexes; UNIQUE already indexes exact version identities.
CREATE INDEX idx_settlement_review_events_time
 ON settlement_review_events(settlement_version_id,recorded_at);
CREATE INDEX idx_settlement_item_versions_scope
 ON settlement_item_versions(settlement_item_id,settlement_version_id);
CREATE INDEX idx_settlement_item_versions_approval
 ON settlement_item_versions(approval_scope_version_id);
CREATE INDEX idx_settlement_approvals_time
 ON settlement_review_events(action,recorded_at,effective_on);
CREATE INDEX idx_reconciliation_history_item ON cost_reconciliation_versions(settlement_item_version_id);
CREATE INDEX idx_approved_scope_snapshot ON project_approval_scope_versions(project_scope_id,approval_version_id);


-- Draft references must belong to the same stable settlement identity.
CREATE TRIGGER settlement_draft_project_guard BEFORE INSERT ON settlement_drafts
WHEN NEW.based_on_version_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlement_versions v WHERE v.id=NEW.based_on_version_id
 AND v.settlement_id=NEW.settlement_id)
 THEN RAISE(ABORT,'结算草稿引用了其他结算单的历史版本') END; END;
CREATE TRIGGER settlement_draft_project_guard_update
 BEFORE UPDATE OF based_on_version_id,settlement_id ON settlement_drafts
WHEN NEW.based_on_version_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM settlement_versions v WHERE v.id=NEW.based_on_version_id
 AND v.settlement_id=NEW.settlement_id)
 THEN RAISE(ABORT,'结算草稿基线版本不得跨结算单') END; END;

-- A scope's stable demand/project identity and approved numeric baseline
-- must never be silently rewritten after a formal approval snapshot exists.
-- Future approved changes are new project_approval_scope_versions rows.
-- The association starts on link, NOT when an eventual project is approved.
-- This rejects simultaneous pending project grabs as well as approved grabs.
-- The stable record remains when released; only an event can relinquish it.
CREATE TRIGGER project_demand_scope_current_owner_insert
 BEFORE INSERT ON project_demand_scopes
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM v_demand_current d
  WHERE d.id=NEW.demand_id AND d.status='cancelled')
 THEN RAISE(ABORT,'已取消需求不能再关联子项目') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM v_project_demand_binding_current held
  WHERE held.demand_id=NEW.demand_id)
 THEN RAISE(ABORT,'需求已关联其他子项目，须先由原子项目显式解绑') END;
END;
CREATE TRIGGER project_demand_scope_seed_link
 AFTER INSERT ON project_demand_scopes
BEGIN
 INSERT INTO project_demand_link_events(
  id,project_scope_id,event_seq,action,actor_id,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,1,'linked',
        NEW.created_by,NEW.created_at);
END;
CREATE TRIGGER project_demand_scope_root_immutable_update
 BEFORE UPDATE OF id,project_id,demand_id,created_by,created_at
 ON project_demand_scopes
BEGIN SELECT RAISE(ABORT,'需求关联的稳定项目/需求身份与创建人不可直接改写，须显式解绑'); END;
CREATE TRIGGER project_demand_scope_root_immutable_delete
 BEFORE DELETE ON project_demand_scopes
BEGIN SELECT RAISE(ABORT,'已建立的需求关联及解绑历史不可删除'); END;

-- The link/release is an immutable, consecutive, auditable user action.
-- No bare status flip, false release, backwards timestamp or cross-project
-- duplicate acquisition is permitted. Release of an approved active scope
-- requires a prior formal approved project scope change that excludes it,
-- or explicit release AFTER the original project was formally closed.
CREATE TRIGGER project_demand_link_event_guard
 BEFORE INSERT ON project_demand_link_events
BEGIN
 SELECT CASE WHEN NEW.event_seq<>(
  SELECT COALESCE(MAX(evt.event_seq),0)+1 FROM project_demand_link_events evt
  WHERE evt.project_scope_id=NEW.project_scope_id)
 THEN RAISE(ABORT,'项目需求关联事件版本必须连续') END;
 SELECT CASE WHEN (
  (NEW.event_seq=1 AND NEW.action<>'linked')
  OR (NEW.event_seq>1 AND NEW.action IS (
    SELECT prev.action FROM project_demand_link_events prev
    WHERE prev.project_scope_id=NEW.project_scope_id
    ORDER BY prev.event_seq DESC LIMIT 1)))
 THEN RAISE(ABORT,'需求关联与解绑必须按当前状态交替，不能重复挂接或重复解绑') END;
 SELECT CASE WHEN NEW.recorded_at<
  (SELECT sc.created_at FROM project_demand_scopes sc
  WHERE sc.id=NEW.project_scope_id)
 OR NEW.recorded_at<
  (SELECT MAX(prev.recorded_at) FROM project_demand_link_events prev
   WHERE prev.project_scope_id=NEW.project_scope_id)
 THEN RAISE(ABORT,'需求关联解绑操作不能早于建档或上一事件') END;
 SELECT CASE WHEN NEW.action='linked' AND EXISTS(
  SELECT 1 FROM project_demand_scopes sc JOIN v_demand_current d
   ON d.id=sc.demand_id
  WHERE sc.id=NEW.project_scope_id AND d.status='cancelled')
 THEN RAISE(ABORT,'已取消需求不得再次建立关联') END;
 SELECT CASE WHEN NEW.action='linked' AND EXISTS(
  SELECT 1 FROM v_project_demand_binding_current other
  JOIN project_demand_scopes self ON self.id=NEW.project_scope_id
  WHERE other.demand_id=self.demand_id
    AND other.project_scope_id<>self.id)
 THEN RAISE(ABORT,'需求仍由另一子项目关联，必须先显式解绑') END;
 SELECT CASE WHEN NEW.action='linked' AND EXISTS(
  SELECT 1 FROM projects p JOIN project_demand_scopes sc
   ON sc.project_id=p.id
  WHERE sc.id=NEW.project_scope_id AND p.status='closed')
 THEN RAISE(ABORT,'已结项子项目不能重新关联需求') END;
 SELECT CASE WHEN NEW.action='released' AND EXISTS(
  SELECT 1 FROM project_demand_scopes sc
  JOIN project_approval_scope_versions aps
   ON aps.project_scope_id=sc.id
  JOIN project_approval_versions ap ON ap.id=aps.approval_version_id
  WHERE sc.id=NEW.project_scope_id AND ap.status='draft')
 THEN RAISE(ABORT,'仍有立项或变更草稿引用需求，须先移出草稿再解绑') END;
 SELECT CASE WHEN NEW.action='released' AND EXISTS(
  SELECT 1 FROM project_demand_scopes sc JOIN projects p ON p.id=sc.project_id
  JOIN v_approval_scope_current a ON a.project_scope_id=sc.id
  WHERE sc.id=NEW.project_scope_id AND p.status<>'closed')
 THEN RAISE(ABORT,'已正式批准的在办项目须先通过最新版范围变更移出需求，才能解绑') END;
END;
CREATE TRIGGER project_demand_link_event_immutable_update
 BEFORE UPDATE ON project_demand_link_events
BEGIN SELECT RAISE(ABORT,'已记录需求关联/解绑历史不得修改'); END;
CREATE TRIGGER project_demand_link_event_immutable_delete
 BEFORE DELETE ON project_demand_link_events
BEGIN SELECT RAISE(ABORT,'已记录需求关联/解绑历史不得删除'); END;

CREATE TRIGGER frozen_approved_project_scope
 BEFORE UPDATE OF project_id,demand_id,demand_version,
 proposed_quantity_scaled,proposed_unit_price_fen,proposed_amount_fen,
 price_source,price_date,tax_mode,note,demand_snapshot_json
 ON project_demand_scopes
WHEN EXISTS(SELECT 1 FROM project_approval_scope_versions v
 JOIN project_approval_versions a ON a.id=v.approval_version_id
 WHERE v.project_scope_id=OLD.id AND a.status='approved')
BEGIN SELECT RAISE(ABORT,'已批准项目需求范围不得原地修改；应形成新的批准版本'); END;
CREATE TRIGGER project_closure_immutable_update BEFORE UPDATE ON project_closures
BEGIN SELECT RAISE(ABORT,'子项目关闭审核历史不可覆盖'); END;
CREATE TRIGGER project_closure_immutable_delete BEFORE DELETE ON project_closures
BEGIN SELECT RAISE(ABORT,'子项目关闭审核历史不可删除'); END;


CREATE TRIGGER project_material_identity_insert BEFORE INSERT ON project_scope_materials
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM v_material_current cur WHERE cur.id=NEW.material_id)
 THEN RAISE(ABORT,'项目范围物资必须已有正式主数据版本') END;
 -- Additional site materials need not have been forecast in the demand
 -- BOM. Optional explanatory reason is not a database access barrier;
 -- stable material identity and later formal approval remain mandatory.
END;
CREATE TRIGGER project_material_identity_immutable_update BEFORE UPDATE ON project_scope_materials
BEGIN SELECT RAISE(ABORT,'项目物资身份不可改挂，只能创建新的物资身份及批准版本'); END;
CREATE TRIGGER project_material_identity_immutable_delete BEFORE DELETE ON project_scope_materials
BEGIN SELECT RAISE(ABORT,'已建立的项目物资身份不可删除'); END;
CREATE TRIGGER approved_material_identity_insert BEFORE INSERT ON project_approval_material_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_scope_materials pm
 JOIN v_material_current master ON master.id=pm.material_id
 WHERE pm.id=NEW.project_material_id AND pm.project_scope_id=NEW.project_scope_id
 AND master.material_version_id=NEW.material_version_id
 AND master.code=NEW.material_code_snapshot
 AND master.name=NEW.material_name
 AND master.model=NEW.material_model
 AND master.specification=NEW.specification
 AND master.unit_id=NEW.unit_id)
 THEN RAISE(ABORT,'批准物资名称、型号、规格、计量单位必须来自统一物资主数据') END;
END;
CREATE INDEX idx_approved_material_stable ON project_approval_material_items(project_material_id,approval_version_id);


CREATE TRIGGER evidence_file_immutable_update BEFORE UPDATE ON evidence_files
BEGIN SELECT RAISE(ABORT,'证据文件内容指纹及原始元数据不可覆盖'); END;
CREATE TRIGGER evidence_file_immutable_delete BEFORE DELETE ON evidence_files
BEGIN SELECT RAISE(ABORT,'已归档原始证据文件不能删除'); END;
CREATE TRIGGER evidence_link_immutable_update BEFORE UPDATE ON evidence_links
BEGIN SELECT RAISE(ABORT,'证据与原始业务版本的关联不可改挂'); END;
CREATE TRIGGER evidence_link_immutable_delete BEFORE DELETE ON evidence_links
BEGIN SELECT RAISE(ABORT,'证据原始关联不可删除'); END;
CREATE INDEX idx_evidence_settlement_version ON evidence_links(settlement_version_id)
 WHERE settlement_version_id IS NOT NULL;
CREATE INDEX idx_evidence_review_event ON evidence_links(settlement_review_event_id)
 WHERE settlement_review_event_id IS NOT NULL;
CREATE INDEX idx_evidence_cost ON evidence_links(cost_version_id)
 WHERE cost_version_id IS NOT NULL;
CREATE INDEX idx_evidence_demand ON evidence_links(demand_id)
 WHERE demand_id IS NOT NULL;
CREATE INDEX idx_evidence_source ON evidence_links(source_id)
 WHERE source_id IS NOT NULL;


-- A formal change decision is one immutable record. Draft edits remain allowed.
CREATE TRIGGER approved_change_order_immutable
 BEFORE UPDATE ON project_change_orders
 WHEN OLD.status='approved'
BEGIN SELECT RAISE(ABORT,'已批准的项目变更单不可覆盖；应重新发起变更'); END;
CREATE TRIGGER approved_change_order_immutable_delete
 BEFORE DELETE ON project_change_orders
 WHEN OLD.status='approved'
BEGIN SELECT RAISE(ABORT,'已批准的项目变更单不可删除'); END;
CREATE TRIGGER change_order_approval_metadata_guard
 BEFORE UPDATE OF status ON project_change_orders
 WHEN NEW.status='approved' AND OLD.status<>'approved'
BEGIN
 SELECT CASE WHEN NEW.decided_by IS NULL OR NEW.decided_at IS NULL
 THEN RAISE(ABORT,'正式变更批准需要真实审核人和时间') END;

END;

CREATE TRIGGER project_stage_event_immutable_update BEFORE UPDATE ON project_stage_events
BEGIN SELECT RAISE(ABORT,'项目阶段历史不可覆盖'); END;
CREATE TRIGGER project_stage_event_immutable_delete BEFORE DELETE ON project_stage_events
BEGIN SELECT RAISE(ABORT,'项目阶段历史不可删除'); END;


-- The approval header stays a draft until all scope/material rows exist.
-- Dashboards consult only formally approved versions.
CREATE TRIGGER project_approval_finalize_guard
 BEFORE UPDATE OF status ON project_approval_versions
 WHEN NEW.status='approved' AND OLD.status='draft'
BEGIN
 SELECT CASE WHEN (SELECT status FROM projects WHERE id=NEW.project_id)<>'stocked'
 AND NEW.version_no=1
 THEN RAISE(ABORT,'正式立项批准前必须完成储备项目入库登记') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_approval_scope_versions a
 WHERE a.approval_version_id=NEW.id)
 THEN RAISE(ABORT,'项目正式批准前必须包含完整需求范围快照') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_approval_scope_versions a
 LEFT JOIN v_demand_current d ON d.id=a.demand_id
 WHERE a.approval_version_id=NEW.id AND COALESCE(d.status,'pending')<>'active')
 THEN RAISE(ABORT,'项目正式批准范围只可引用已完成需求确认的有效需求') END;
 SELECT CASE WHEN (SELECT status FROM projects p WHERE p.id=NEW.project_id)='closed'
 THEN RAISE(ABORT,'已关闭子项目不得批准旧草稿') END;

 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_approval_material_items a
 JOIN project_scope_materials pm ON pm.id=a.project_material_id
 JOIN v_material_current m ON m.id=pm.material_id
 WHERE a.approval_version_id=NEW.id AND
 (a.material_version_id<>m.material_version_id
 OR a.material_code_snapshot COLLATE NOCASE <> m.code COLLATE NOCASE
 OR a.material_name<>m.name OR a.material_model<>m.model
 OR a.specification<>m.specification OR a.unit_id<>m.unit_id))
 THEN RAISE(ABORT,'项目批准前物资草稿快照必须与当前物资主数据重新核定一致') END;
END;
CREATE TRIGGER project_approval_scope_frozen_after_approval
 BEFORE INSERT ON project_approval_scope_versions
 WHEN EXISTS(SELECT 1 FROM project_approval_versions a
 WHERE a.id=NEW.approval_version_id AND a.status='approved')
BEGIN SELECT RAISE(ABORT,'正式批准后不能追加批准需求，必须创建新变更版本'); END;
CREATE TRIGGER project_approval_material_frozen_after_approval
 BEFORE INSERT ON project_approval_material_items
 WHEN EXISTS(SELECT 1 FROM project_approval_versions a
 WHERE a.id=NEW.approval_version_id AND a.status='approved')
BEGIN SELECT RAISE(ABORT,'正式批准后不能追加已批准物资快照'); END;
CREATE INDEX idx_project_approval_versions_effective
 ON project_approval_versions(project_id,status,version_no);


-- Stable roots have no mutable duplicate values. The latest typed immutable
-- version is the only authoritative name/limit/status/work-domain definition.
CREATE TRIGGER framework_root_immutable_update BEFORE UPDATE ON frameworks
BEGIN SELECT RAISE(ABORT,'年度框架业务身份不可原地修改'); END;
CREATE TRIGGER agreement_root_immutable_update BEFORE UPDATE ON agreements
BEGIN SELECT RAISE(ABORT,'执行协议业务身份及框架归属不可改挂'); END;
CREATE TRIGGER work_object_root_immutable_update BEFORE UPDATE ON work_objects
BEGIN SELECT RAISE(ABORT,'标准作业对象编码不可直接改变'); END;
CREATE TRIGGER framework_root_immutable_delete BEFORE DELETE ON frameworks
BEGIN SELECT RAISE(ABORT,'年度框架历史身份不可删除'); END;
CREATE TRIGGER agreement_root_immutable_delete BEFORE DELETE ON agreements
BEGIN SELECT RAISE(ABORT,'执行协议历史身份不可删除'); END;
CREATE TRIGGER work_object_root_immutable_delete BEFORE DELETE ON work_objects
BEGIN SELECT RAISE(ABORT,'标准作业对象历史身份不可删除'); END;
CREATE TRIGGER framework_version_sequential_insert BEFORE INSERT ON framework_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM framework_versions v WHERE v.framework_id=NEW.framework_id)
 THEN RAISE(ABORT,'年度框架版本必须连续') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT f.created_at FROM frameworks f WHERE f.id=NEW.framework_id)
 OR NEW.recorded_at<
 (SELECT MAX(v.recorded_at) FROM framework_versions v WHERE v.framework_id=NEW.framework_id)
 THEN RAISE(ABORT,'年度框架正式版本不能早于其根身份或上一版本') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM framework_versions previous WHERE previous.framework_id=NEW.framework_id
 AND previous.version_no=NEW.version_no-1
 AND previous.name=NEW.name AND previous.limit_fen=NEW.limit_fen
 AND previous.status=NEW.status)
 THEN RAISE(ABORT,'年度框架正式版本必须改变额度、名称或启停状态') END;
END;
CREATE TRIGGER agreement_version_sequential_insert BEFORE INSERT ON agreement_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM agreement_versions v WHERE v.agreement_id=NEW.agreement_id)
 THEN RAISE(ABORT,'执行协议版本必须连续') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT a.created_at FROM agreements a WHERE a.id=NEW.agreement_id)
 OR NEW.recorded_at<
 (SELECT MAX(v.recorded_at) FROM agreement_versions v WHERE v.agreement_id=NEW.agreement_id)
 THEN RAISE(ABORT,'执行协议正式版本不能早于其根身份或上一版本') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM agreement_versions previous WHERE previous.agreement_id=NEW.agreement_id
 AND previous.version_no=NEW.version_no-1
 AND previous.name=NEW.name AND previous.limit_fen=NEW.limit_fen
 AND previous.contract_number IS NEW.contract_number
 AND previous.counterparty_name IS NEW.counterparty_name
 AND previous.signed_on IS NEW.signed_on
 AND previous.effective_from IS NEW.effective_from
 AND previous.effective_to IS NEW.effective_to
 AND previous.status=NEW.status)
 THEN RAISE(ABORT,'执行协议正式版本必须改变真实合同条款、额度或状态') END;
END;
CREATE TRIGGER work_object_version_sequential_insert BEFORE INSERT ON work_object_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM work_object_versions v WHERE v.work_object_id=NEW.work_object_id)
 THEN RAISE(ABORT,'标准作业对象版本必须连续') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT o.created_at FROM work_objects o WHERE o.id=NEW.work_object_id)
 OR NEW.recorded_at<
 (SELECT MAX(v.recorded_at) FROM work_object_versions v WHERE v.work_object_id=NEW.work_object_id)
 THEN RAISE(ABORT,'作业对象正式版本不得倒签或早于根身份') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM work_object_versions prev
 WHERE prev.work_object_id=NEW.work_object_id AND prev.version_no=NEW.version_no-1
 AND prev.name=NEW.name AND prev.work_target_type=NEW.work_target_type
 AND prev.status=NEW.status AND prev.sort_order=NEW.sort_order)
 THEN RAISE(ABORT,'作业对象定义无变化，不得新增空历史') END;
END;
CREATE TRIGGER operation_root_immutable_update BEFORE UPDATE ON operations
BEGIN SELECT RAISE(ABORT,'操作类型编码与业务身份不可覆盖；应创建新操作版本'); END;
CREATE TRIGGER operation_root_immutable_delete BEFORE DELETE ON operations
BEGIN SELECT RAISE(ABORT,'操作类型身份不能删除'); END;
CREATE TRIGGER operation_version_sequential_insert BEFORE INSERT ON operation_versions
BEGIN
 SELECT CASE WHEN NEW.version<>(SELECT COALESCE(MAX(v.version),0)+1
 FROM operation_versions v WHERE v.operation_id=NEW.operation_id)
 THEN RAISE(ABORT,'操作类型版本必须连续') END;
 SELECT CASE WHEN NEW.changed_at<
 (SELECT o.created_at FROM operations o WHERE o.id=NEW.operation_id)
 OR NEW.changed_at<
 (SELECT MAX(v.changed_at) FROM operation_versions v WHERE v.operation_id=NEW.operation_id)
 THEN RAISE(ABORT,'操作类型完整定义不得早于根身份或上一正式版本') END;
 SELECT CASE WHEN NEW.version>1 AND EXISTS(
 SELECT 1 FROM operation_versions prev
 WHERE prev.operation_id=NEW.operation_id AND prev.version=NEW.version-1
 AND prev.name=NEW.name AND prev.status=NEW.status
 AND prev.sort_order=NEW.sort_order AND prev.work_target_type=NEW.work_target_type
 AND prev.work_object_id=NEW.work_object_id
 AND prev.default_unit_id=NEW.default_unit_id
 AND prev.default_unit_version=NEW.default_unit_version
 AND prev.default_quantity_scaled IS NEW.default_quantity_scaled
 AND prev.completion_standard IS NEW.completion_standard
 AND prev.fields_json=NEW.fields_json
 AND prev.pricing_features_json=NEW.pricing_features_json
 AND prev.allow_tower=NEW.allow_tower AND prev.allow_span=NEW.allow_span
 AND prev.default_location_kind=NEW.default_location_kind
 AND prev.default_target_object=NEW.default_target_object
 AND prev.entry_hint=NEW.entry_hint)
 THEN RAISE(ABORT,'操作类型正式版本没有真实定义变化，不允许空改版') END;
END;
CREATE TRIGGER reference_price_root_immutable_update BEFORE UPDATE ON reference_price_catalog
BEGIN SELECT RAISE(ABORT,'参考价目录业务身份不可覆盖；应创建新价格版本'); END;
CREATE TRIGGER reference_price_root_immutable_delete BEFORE DELETE ON reference_price_catalog
BEGIN SELECT RAISE(ABORT,'参考价目录业务身份不可删除'); END;
CREATE TRIGGER reference_price_version_sequential_insert BEFORE INSERT ON reference_price_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM reference_price_versions v WHERE v.catalog_id=NEW.catalog_id)
 THEN RAISE(ABORT,'参考价版本必须连续') END;
 SELECT CASE WHEN NEW.created_at<
 (SELECT c.created_at FROM reference_price_catalog c WHERE c.id=NEW.catalog_id)
 OR NEW.created_at<
 (SELECT MAX(v.created_at) FROM reference_price_versions v WHERE v.catalog_id=NEW.catalog_id)
 THEN RAISE(ABORT,'参考价正式版本不能早于根目录或上一价格历史') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM reference_price_versions prev
 WHERE prev.catalog_id=NEW.catalog_id AND prev.version_no=NEW.version_no-1
 AND prev.title=NEW.title
 AND prev.operation_id=NEW.operation_id
 AND prev.operation_version=NEW.operation_version
 AND prev.unit_id=NEW.unit_id AND prev.unit_version=NEW.unit_version
 AND prev.voltage_level_id IS NEW.voltage_level_id
 AND prev.tower_type IS NEW.tower_type AND prev.work_mode=NEW.work_mode
 AND prev.specification=NEW.specification
 AND prev.additional_conditions_json=NEW.additional_conditions_json
 AND prev.pricing_mode=NEW.pricing_mode
 AND prev.pricing_scope=NEW.pricing_scope
 AND prev.calculation_params_json=NEW.calculation_params_json
 AND prev.fee_components_json=NEW.fee_components_json
 AND prev.base_fee_fen=NEW.base_fee_fen
 AND prev.quantity_brackets_json=NEW.quantity_brackets_json
 AND prev.status=NEW.status AND prev.unit_price_fen=NEW.unit_price_fen
 AND prev.price_source=NEW.price_source AND prev.price_date=NEW.price_date
 AND prev.tax_mode=NEW.tax_mode AND prev.effective_on=NEW.effective_on
 AND prev.basis=NEW.basis)
 THEN RAISE(ABORT,'参考价正式版本没有真实价格或分类依据变化，不允许空改版') END;
END;
-- Keep a history row automatically with each new/changed span topology.
CREATE TRIGGER span_first_version_guard BEFORE INSERT ON line_spans
WHEN NEW.version<>1
BEGIN SELECT RAISE(ABORT,'新建档距必须从版本1开始'); END;
CREATE TRIGGER span_history_create AFTER INSERT ON line_spans
BEGIN
 INSERT INTO line_span_history(id,span_id,version_no,line_id,start_tower_id,
 end_tower_id,transmission_center_length_mm,status,reason,actor_id,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.version,NEW.line_id,
 NEW.start_tower_id,NEW.end_tower_id,NEW.transmission_center_length_mm,
 NEW.status,'首次建档',NEW.created_by,NEW.created_at);
END;
CREATE TRIGGER span_history_update_guard
 BEFORE UPDATE OF line_id,start_tower_id,end_tower_id,
 transmission_center_length_mm,status,version ON line_spans
BEGIN
 SELECT CASE WHEN NEW.version<>OLD.version+1
 OR (NEW.line_id IS OLD.line_id AND
 NEW.start_tower_id IS OLD.start_tower_id AND
 NEW.end_tower_id IS OLD.end_tower_id
 AND NEW.transmission_center_length_mm IS OLD.transmission_center_length_mm
 AND NEW.status IS OLD.status)
 OR NEW.updated_by IS NULL
 THEN RAISE(ABORT,'档距拓扑或状态变化必须明确操作者并递增历史版本') END;
END;
CREATE TRIGGER span_history_update AFTER UPDATE OF
 line_id,start_tower_id,end_tower_id,transmission_center_length_mm,status,version ON line_spans
BEGIN
 INSERT INTO line_span_history(id,span_id,version_no,line_id,start_tower_id,
 end_tower_id,transmission_center_length_mm,status,reason,actor_id,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.version,NEW.line_id,
 NEW.start_tower_id,NEW.end_tower_id,NEW.transmission_center_length_mm,
 NEW.status,NEW.change_reason,NEW.updated_by,NEW.updated_at);
END;
CREATE TRIGGER span_history_immutable_update BEFORE UPDATE ON line_span_history
BEGIN SELECT RAISE(ABORT,'历史档距版本不可覆盖'); END;
CREATE TRIGGER span_history_immutable_delete BEFORE DELETE ON line_span_history
BEGIN SELECT RAISE(ABORT,'历史档距版本不可删除'); END;
-- Immutable identities and append-only correction chains. These boundaries
-- are independent from SOFT budget/material expectations.
-- Fee tree is an immutable parent chain; labels/status have full history.
CREATE TRIGGER project_cost_node_insert_guard BEFORE INSERT ON project_cost_nodes
BEGIN
 -- The ENTIRE parent chain must be active; active children cannot bypass
 -- a disabled higher-level fee group.
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND EXISTS(
 WITH RECURSIVE parents(id,parent_id) AS (
  SELECT id,parent_id FROM project_cost_nodes WHERE id=NEW.parent_id
  UNION ALL SELECT n.id,n.parent_id FROM project_cost_nodes n
    JOIN parents p ON n.id=p.parent_id)
 SELECT 1 FROM parents p
 LEFT JOIN v_project_cost_node_current v ON v.id=p.id
 WHERE COALESCE(v.status,'undefined')<>'active')
 THEN RAISE(ABORT,'新费用子项所在的整条父级科目路径必须启用') END;
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM cost_entries e WHERE e.cost_node_id=NEW.parent_id
  UNION ALL SELECT 1 FROM settlement_items i WHERE i.cost_node_id=NEW.parent_id)
 THEN RAISE(ABORT,'已有实际费用或结算明细的叶子费用项不能再拆出子项') END;
END;
CREATE TRIGGER project_cost_node_immutable_update BEFORE UPDATE ON project_cost_nodes
BEGIN SELECT RAISE(ABORT,'费用树层级身份不可覆盖'); END;
CREATE TRIGGER project_cost_node_immutable_delete BEFORE DELETE ON project_cost_nodes
BEGIN SELECT RAISE(ABORT,'费用树节点不可直接删除，应保留其历史'); END;
CREATE TRIGGER project_cost_node_version_insert_guard BEFORE INSERT ON project_cost_node_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM project_cost_node_versions v WHERE v.node_id=NEW.node_id)
 THEN RAISE(ABORT,'费用节点定义版本必须连续') END;
 SELECT CASE WHEN NEW.recorded_at <
  (SELECT created_at FROM project_cost_nodes WHERE id=NEW.node_id)
 THEN RAISE(ABORT,'费用节点历史定义不能早于其稳定身份创建') END;
 SELECT CASE WHEN NEW.version_no>1 AND NEW.recorded_at<
  (SELECT recorded_at FROM project_cost_node_versions
   WHERE node_id=NEW.node_id ORDER BY version_no DESC LIMIT 1)
 THEN RAISE(ABORT,'费用节点正式版本登记时间不能倒序') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
  SELECT 1 FROM project_cost_node_versions prior
  WHERE prior.node_id=NEW.node_id
    AND prior.version_no=NEW.version_no-1
    AND prior.name=NEW.name AND prior.status=NEW.status)
 THEN RAISE(ABORT,'费用节点的名称和状态均未变化，无需新增空版本') END;
END;
CREATE TRIGGER project_cost_node_version_immutable_update BEFORE UPDATE ON project_cost_node_versions
BEGIN SELECT RAISE(ABORT,'费用节点定义历史不可覆盖'); END;
CREATE TRIGGER project_cost_node_version_immutable_delete BEFORE DELETE ON project_cost_node_versions
BEGIN SELECT RAISE(ABORT,'费用节点定义历史不可删除'); END;
CREATE TRIGGER cost_entry_node_insert_guard BEFORE INSERT ON cost_entries
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM project_cost_nodes c WHERE c.parent_id=NEW.cost_node_id)
 THEN RAISE(ABORT,'实际费用只能登记至末级费用项') END;
 SELECT CASE WHEN EXISTS(
 WITH RECURSIVE fee_path(id,parent_id) AS (
  SELECT id,parent_id FROM project_cost_nodes WHERE id=NEW.cost_node_id
  UNION ALL SELECT n.id,n.parent_id FROM project_cost_nodes n
    JOIN fee_path p ON n.id=p.parent_id)
 SELECT 1 FROM fee_path p LEFT JOIN v_project_cost_node_current v ON v.id=p.id
 WHERE COALESCE(v.status,'undefined')<>'active')
 THEN RAISE(ABORT,'费用项及全部上级科目必须启用才能新增实际费用') END;
END;

CREATE TRIGGER cost_entry_immutable_update BEFORE UPDATE ON cost_entries
BEGIN SELECT RAISE(ABORT,'真实费用原始身份与所属子项目不可被改挂'); END;
CREATE TRIGGER cost_entry_immutable_delete BEFORE DELETE ON cost_entries
BEGIN SELECT RAISE(ABORT,'原始费用业务身份不可删除'); END;
CREATE TRIGGER cost_version_sequential_insert BEFORE INSERT ON cost_versions
BEGIN

 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM cost_versions v WHERE v.entry_id=NEW.entry_id)
 THEN RAISE(ABORT,'同一笔费用确认版本必须从1连续增加') END;
 SELECT CASE WHEN NEW.confirmed_at<
 (SELECT e.created_at FROM cost_entries e WHERE e.id=NEW.entry_id)
 OR NEW.confirmed_at<
 (SELECT MAX(v.confirmed_at) FROM cost_versions v WHERE v.entry_id=NEW.entry_id)
 THEN RAISE(ABORT,'真实费用确认历史不能早于其原始费用身份或前一正式版本') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM cost_entries e JOIN project_cost_node_versions nv
   ON nv.node_id=e.cost_node_id
 WHERE e.id=NEW.entry_id AND nv.id=NEW.cost_node_version_id)
 THEN RAISE(ABORT,'实际费用采用的费用定义版本与费用节点不匹配') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_cost_node_versions nv
 WHERE nv.id=NEW.cost_node_version_id AND nv.recorded_at<=NEW.confirmed_at)
 THEN RAISE(ABORT,'实际费用不能引用确认时间之后才登记的费用科目定义') END;
 SELECT CASE WHEN NOT (
  (SELECT ce.project_id FROM cost_entries ce WHERE ce.id=NEW.entry_id)
  IS (SELECT p.id FROM project_funding_versions fv
   JOIN projects p ON p.id=fv.project_id WHERE fv.id=NEW.funding_version_id))
  AND NEW.funding_version_id IS NOT NULL
 THEN RAISE(ABORT,'费用历史资金归属版本必须属于同一子项目') END;
 SELECT CASE WHEN NEW.funding_version_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM project_funding_versions f WHERE f.id=NEW.funding_version_id
 AND f.recorded_at<=NEW.confirmed_at)
 THEN RAISE(ABORT,'真实费用不能引用未来登记的资金归属版本') END;
 SELECT CASE WHEN NEW.funding_version_id IS NULL AND EXISTS(
 SELECT 1 FROM project_funding_versions fv
 JOIN cost_entries ce ON ce.project_id=fv.project_id
 WHERE ce.id=NEW.entry_id)
 THEN RAISE(ABORT,'存在资金归属历史的实际费用必须明确关联历史资金版本') END;
 SELECT CASE WHEN NEW.version_no>1 AND
 NEW.funding_version_id IS NOT
 (SELECT prior.funding_version_id FROM cost_versions prior
 WHERE prior.entry_id=NEW.entry_id AND prior.version_no=1)
 THEN RAISE(ABORT,'费用更正不得悄悄更改原始资金归属；需另行正式调拨') END;
END;
CREATE TRIGGER reconciliation_version_sequential_insert
 BEFORE INSERT ON cost_reconciliation_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM cost_reconciliation_versions v WHERE v.record_id=NEW.record_id)
 THEN RAISE(ABORT,'费用核对版本必须连续增加') END;
 -- record_id is a stable business reconciliation identity. A correction
 -- may point to another version of the SAME actual cost entry, but may not
 -- repurpose that identity for a different cost or settlement item.
 SELECT CASE WHEN NEW.version_no>1 AND NEW.created_at<
  (SELECT previous.created_at FROM cost_reconciliation_versions previous
   WHERE previous.record_id=NEW.record_id AND
         previous.version_no=NEW.version_no-1)
 THEN RAISE(ABORT,'正式费用核对更正时间不能早于上一版本') END;
 SELECT CASE WHEN NEW.version_no>1 AND NOT EXISTS(
 SELECT 1 FROM cost_reconciliation_versions original
 JOIN cost_versions original_cost ON original_cost.id=original.cost_version_id
 JOIN cost_versions proposed_cost ON proposed_cost.id=NEW.cost_version_id
 WHERE original.record_id=NEW.record_id AND original.version_no=1
 AND original.settlement_item_id=NEW.settlement_item_id
 AND original_cost.entry_id=proposed_cost.entry_id)
 THEN RAISE(ABORT,'核对历史版本不得更换实际费用身份或结算明细身份') END;
 -- Formal voiding keeps the exact preceding money assertion for audit.
 -- The current fact view excludes status='voided' from money totals.
 -- A void event is allowed even if its old statement was superseded.
 SELECT CASE WHEN NEW.status='voided' AND NOT EXISTS(
  SELECT 1 FROM cost_reconciliation_versions previous
  WHERE previous.record_id=NEW.record_id
   AND previous.version_no=NEW.version_no-1
   AND previous.cost_version_id=NEW.cost_version_id
   AND previous.settlement_item_id=NEW.settlement_item_id
   AND previous.settlement_item_version_id=NEW.settlement_item_version_id
   AND previous.status='active'
   AND previous.reconciled_cost_fen=NEW.reconciled_cost_fen
   AND previous.reconciled_settlement_fen=NEW.reconciled_settlement_fen)
 THEN RAISE(ABORT,'撤销历史核对不得伪造或改变前一版本的金额及核对归属') END;
END;
CREATE TRIGGER demand_revision_sequential_insert BEFORE INSERT ON demand_revisions
BEGIN SELECT CASE WHEN NEW.version<>(SELECT COALESCE(MAX(v.version),1)+1
 FROM demand_revisions v WHERE v.demand_id=NEW.demand_id)
 THEN RAISE(ABORT,'需求修订版本从2开始并且必须连续') END;
 SELECT CASE WHEN NEW.changed_at <
 (SELECT recorded_at FROM demand_versions
 WHERE demand_id=NEW.demand_id AND version=NEW.version-1)
 THEN RAISE(ABORT,'需求正式修订不能早于上一已发布版本') END;
 SELECT CASE WHEN (SELECT to_status FROM demand_lifecycle_events
 WHERE demand_id=NEW.demand_id ORDER BY event_seq DESC LIMIT 1)='cancelled'
 THEN RAISE(ABORT,'已取消的需求不得悄悄发布新版本') END;
 SELECT CASE WHEN json_type(json_patch((SELECT p.snapshot_json FROM demand_versions p WHERE p.demand_id=NEW.demand_id AND p.version=NEW.version-1),NEW.snapshot_json),'$.quantity_scaled')<>'integer'
 OR json_type(json_patch((SELECT p.snapshot_json FROM demand_versions p WHERE p.demand_id=NEW.demand_id AND p.version=NEW.version-1),NEW.snapshot_json),'$.operation_id')<>'text'
 OR json_type(json_patch((SELECT p.snapshot_json FROM demand_versions p WHERE p.demand_id=NEW.demand_id AND p.version=NEW.version-1),NEW.snapshot_json),'$.operation_version')<>'integer'
 OR json_type(json_patch((SELECT p.snapshot_json FROM demand_versions p WHERE p.demand_id=NEW.demand_id AND p.version=NEW.version-1),NEW.snapshot_json),'$.work_object_id')<>'text'
 OR json_type(json_patch((SELECT p.snapshot_json FROM demand_versions p WHERE p.demand_id=NEW.demand_id AND p.version=NEW.version-1),NEW.snapshot_json),'$.unit_id')<>'text'
 OR json_type(json_patch((SELECT p.snapshot_json FROM demand_versions p WHERE p.demand_id=NEW.demand_id AND p.version=NEW.version-1),NEW.snapshot_json),'$.unit_version')<>'integer'
 THEN RAISE(ABORT,'合并需求修订后必须保留数量、操作、对象和单位的完整结构') END;
 SELECT CASE WHEN json_type(NEW.snapshot_json,'$.materials') IS NOT NULL
 AND (json_type(NEW.snapshot_json,'$.materials')<>'array' OR EXISTS(
 SELECT 1 FROM json_each(NEW.snapshot_json,'$.materials') x
 WHERE json_type(x.value)<>'object'
 OR json_type(x.value,'$.material_id')<>'text'
 OR json_type(x.value,'$.quantity_scaled')<>'integer'
 OR json_extract(x.value,'$.quantity_scaled')<=0))
 THEN RAISE(ABORT,'需求物资修订必须采用完整物资清单，包含有效物资编码和整数数量') END;
 SELECT CASE WHEN json_type(NEW.snapshot_json,'$.materials')='array'
 AND EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.materials') x
 WHERE NOT EXISTS(SELECT 1 FROM v_material_current m
 WHERE m.id=json_extract(x.value,'$.material_id')))
 THEN RAISE(ABORT,'需求新增物资必须先存在于统一物资主数据') END;
 -- Previously selected inactive material remains historically valid. A newly
 -- selected material must be active at the moment its demand version is made.
 SELECT CASE WHEN json_type(NEW.snapshot_json,'$.materials')='array'
 AND EXISTS(
 SELECT 1 FROM json_each(NEW.snapshot_json,'$.materials') x
 JOIN v_material_current m ON m.id=json_extract(x.value,'$.material_id')
 WHERE m.status='inactive' AND NOT EXISTS(
 SELECT 1 FROM demand_material_version_items old
 WHERE old.demand_id=NEW.demand_id AND old.demand_version=NEW.version-1
 AND old.material_id=m.id))
 THEN RAISE(ABORT,'停用物资不能作为新版需求的新增物资，历史物资仍可保留') END;
END;
CREATE TRIGGER demand_initial_version_publish AFTER INSERT ON demands
BEGIN
 INSERT INTO demand_versions(demand_id,version,quantity_scaled,operation_id,
 operation_version,work_object_id,unit_id,unit_version,snapshot_json,recorded_by,recorded_at)
 VALUES(NEW.id,1,NEW.quantity_scaled,NEW.operation_id,NEW.operation_version,
 NEW.work_object_id,NEW.unit_id,NEW.unit_version,
 json_object(
 'demand_id',NEW.id,'demand_no',NEW.demand_no,'quantity_scaled',NEW.quantity_scaled,
 'operation_id',NEW.operation_id,'operation_version',NEW.operation_version,
 'operation_snapshot',NEW.operation_snapshot,
 'work_object_id',NEW.work_object_id,'work_object_snapshot',NEW.work_object_snapshot,
 'unit_id',NEW.unit_id,'unit_version',NEW.unit_version,'unit_snapshot',NEW.unit_snapshot,
 'line_name_snapshot',NEW.line_name_snapshot,'tower_no_snapshot',NEW.tower_no_snapshot,
 'physical_code_snapshot',NEW.physical_code_snapshot,
 'work_target_type',NEW.work_target_type,'target_object',NEW.target_object,
 'completion_standard',NEW.completion_standard,'problem_description',NEW.problem_description,
 'priority_id',NEW.priority_id,'priority_snapshot',NEW.priority_snapshot,
 'expected_on',NEW.expected_on,
 'logical_tower_id',NEW.logical_tower_id,'physical_tower_id',NEW.physical_tower_id,
 'observed_physical_tower_id',NEW.observed_physical_tower_id,
 'context_line_id',NEW.context_line_id,'span_id',NEW.span_id,
 'span_version',NEW.span_version,'span_snapshot_json',NEW.span_snapshot_json,
 'custom_fields_json',NEW.custom_fields_json,'field_definitions_json',NEW.field_definitions_json,
 'work_locations',CASE WHEN json_array_length(NEW.initial_work_locations_json)>0
 THEN json(NEW.initial_work_locations_json)
 ELSE json_array(json_object(
    'location_kind',CASE WHEN NEW.physical_tower_id IS NOT NULL
      THEN 'physical_tower' WHEN NEW.span_id IS NOT NULL
      THEN 'span' ELSE 'logical_tower' END,
    'logical_tower_id',NEW.logical_tower_id,
    'physical_tower_id',NEW.physical_tower_id,
    'span_id',NEW.span_id,'span_version',NEW.span_version,
    'quantity_scaled',NEW.quantity_scaled,
    'work_mode','unspecified',
    'site_features_json',json('{}'),
    'location_snapshot_json',json_object(
      'line_name',NEW.line_name_snapshot,'tower_no',NEW.tower_no_snapshot,
      'physical_code',NEW.physical_code_snapshot))) END),
 NEW.created_by,NEW.created_at);
 INSERT INTO demand_lifecycle_events(id,demand_id,event_seq,from_status,
 to_status,reason,actor_id,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,1,NULL,'pending',
 '首次登记',NEW.created_by,NEW.created_at);
END;
CREATE TRIGGER demand_revision_publish AFTER INSERT ON demand_revisions
BEGIN
 INSERT INTO demand_versions(demand_id,version,quantity_scaled,operation_id,
 operation_version,work_object_id,unit_id,unit_version,snapshot_json,recorded_by,recorded_at)
 SELECT NEW.demand_id,NEW.version,
 json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.quantity_scaled'),
 json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.operation_id'),
 json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.operation_version'),
 json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.work_object_id'),
 json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.unit_id'),
 json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.unit_version'),
 CASE WHEN json_type(NEW.snapshot_json,'$.quantity_scaled')='integer'
  AND json_type(NEW.snapshot_json,'$.work_locations') IS NULL
  AND json_array_length(prev.snapshot_json,'$.work_locations')=1
 THEN json_set(json_patch(prev.snapshot_json,NEW.snapshot_json),
  '$.work_locations[0].quantity_scaled',
  json_extract(json_patch(prev.snapshot_json,NEW.snapshot_json),'$.quantity_scaled'))
 ELSE json_patch(prev.snapshot_json,NEW.snapshot_json) END,
 NEW.changed_by,NEW.changed_at
 FROM demand_versions prev
 WHERE prev.demand_id=NEW.demand_id AND prev.version=NEW.version-1;
 -- A revision may replace the COMPLETE expected-material list. Omission
 -- means carry the prior list, never means silently erase material history.
 INSERT INTO demand_material_version_items(demand_id,demand_version,material_id,
 material_version_id,item_no,quantity_scaled,unit_id,unit_snapshot,note)
 SELECT NEW.demand_id,NEW.version,prior.material_id,prior.material_version_id,prior.item_no,
 prior.quantity_scaled,prior.unit_id,prior.unit_snapshot,prior.note
 FROM demand_material_version_items prior
 WHERE prior.demand_id=NEW.demand_id AND prior.demand_version=NEW.version-1
 AND json_type(NEW.snapshot_json,'$.materials') IS NULL;
 INSERT INTO demand_material_version_items(demand_id,demand_version,material_id,
 material_version_id,item_no,quantity_scaled,unit_id,unit_snapshot,note)
 SELECT NEW.demand_id,NEW.version,json_extract(x.value,'$.material_id'),
 m.material_version_id,CAST(x.key AS INTEGER)+1,json_extract(x.value,'$.quantity_scaled'),
 m.unit_id,
 (SELECT name FROM v_dictionary_current WHERE id=m.unit_id),
 COALESCE(json_extract(x.value,'$.note'),'')
 FROM json_each(NEW.snapshot_json,'$.materials') x
 JOIN v_material_current m ON m.id=json_extract(x.value,'$.material_id')
 WHERE json_type(NEW.snapshot_json,'$.materials')='array';
END;
CREATE TRIGGER demand_version_guard BEFORE INSERT ON demand_versions
BEGIN
 SELECT CASE WHEN NEW.version=1 AND
 NOT EXISTS(SELECT 1 FROM demands d WHERE d.id=NEW.demand_id
 AND d.quantity_scaled=NEW.quantity_scaled
 AND d.operation_id=NEW.operation_id AND d.operation_version=NEW.operation_version
 AND d.work_object_id=NEW.work_object_id AND d.unit_id=NEW.unit_id
 AND d.unit_version=NEW.unit_version)
 THEN RAISE(ABORT,'首次需求版本必须来自真实初始需求') END;
 SELECT CASE WHEN NEW.version>1 AND NOT EXISTS(
 SELECT 1 FROM demand_revisions r WHERE r.demand_id=NEW.demand_id
 AND r.version=NEW.version AND EXISTS(
 SELECT 1 FROM demand_versions prior
 WHERE prior.demand_id=NEW.demand_id AND prior.version=NEW.version-1
 AND (CASE WHEN json_type(r.snapshot_json,'$.quantity_scaled')='integer'
  AND json_type(r.snapshot_json,'$.work_locations') IS NULL
  AND json_array_length(prior.snapshot_json,'$.work_locations')=1
 THEN json_set(json_patch(prior.snapshot_json,r.snapshot_json),
  '$.work_locations[0].quantity_scaled',
  json_extract(json_patch(prior.snapshot_json,r.snapshot_json),'$.quantity_scaled'))
 ELSE json_patch(prior.snapshot_json,r.snapshot_json) END)=NEW.snapshot_json))
 THEN RAISE(ABORT,'后续需求版本必须来自上一正式版本与真实修订内容') END;
 SELECT CASE WHEN json_extract(NEW.snapshot_json,'$.quantity_scaled') IS NOT NEW.quantity_scaled
 OR json_extract(NEW.snapshot_json,'$.operation_id') IS NOT NEW.operation_id
 OR json_extract(NEW.snapshot_json,'$.operation_version') IS NOT NEW.operation_version
 OR json_extract(NEW.snapshot_json,'$.work_object_id') IS NOT NEW.work_object_id
 OR json_extract(NEW.snapshot_json,'$.unit_id') IS NOT NEW.unit_id
 OR json_extract(NEW.snapshot_json,'$.unit_version') IS NOT NEW.unit_version
 THEN RAISE(ABORT,'需求结构化字段必须与完整需求历史快照一致') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM operation_versions op
 WHERE op.operation_id=NEW.operation_id AND op.version=NEW.operation_version
 AND op.work_object_id=NEW.work_object_id
 AND op.work_target_type=NEW.work_target_type
 AND op.default_unit_id=NEW.unit_id
 AND ((NEW.span_id IS NULL AND op.allow_tower=1)
 OR (NEW.span_id IS NOT NULL AND op.allow_span=1)))
 THEN RAISE(ABORT,'需求完整版本的作业类型、作业对象和计量单位必须与正式操作定义一致') END;
 SELECT CASE WHEN NEW.priority_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM dictionary_items d WHERE d.id=NEW.priority_id AND d.type_id='priority')
 THEN RAISE(ABORT,'需求版本优先级不是有效的优先级字典') END;
 SELECT CASE WHEN NEW.logical_tower_id IS NOT NULL
 AND NEW.observed_physical_tower_id IS NOT NULL
 AND NOT EXISTS(
 SELECT 1 FROM logical_tower_history h
 WHERE h.logical_tower_id=NEW.logical_tower_id
 AND h.physical_tower_id=NEW.observed_physical_tower_id)
 THEN RAISE(ABORT,'需求版本指定的逻辑杆塔与实物杆塔从未有历史有效关联') END;
END;
CREATE TRIGGER demand_version_immutable_update BEFORE UPDATE ON demand_versions
BEGIN SELECT RAISE(ABORT,'正式需求版本不允许覆盖'); END;
CREATE TRIGGER demand_version_immutable_delete BEFORE DELETE ON demand_versions
BEGIN SELECT RAISE(ABORT,'正式需求版本不允许删除'); END;
CREATE TRIGGER demand_root_immutable_update BEFORE UPDATE ON demands
BEGIN SELECT RAISE(ABORT,'正式需求根记录不可原地修改；应通过新的需求修订版本办理'); END;
CREATE TRIGGER demand_root_immutable_delete BEFORE DELETE ON demands
BEGIN SELECT RAISE(ABORT,'正式需求根记录不可删除'); END;
CREATE TRIGGER demand_revision_immutable_update BEFORE UPDATE ON demand_revisions
BEGIN SELECT RAISE(ABORT,'专业需求历史版本不可覆盖'); END;
CREATE TRIGGER demand_revision_immutable_delete BEFORE DELETE ON demand_revisions
BEGIN SELECT RAISE(ABORT,'专业需求历史版本不可删除'); END;


-- Historical approved scopes remain immutable after a release and a
-- later transfer. Approval checks the CURRENT link, not whether an old
-- project ever approved this demand at any time in history.
CREATE TRIGGER project_demand_exclusive_approval
 BEFORE UPDATE OF status ON project_approval_versions
 WHEN OLD.status='draft' AND NEW.status='approved'
BEGIN
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM project_approval_scope_versions aps
 JOIN project_demand_scopes sc ON sc.id=aps.project_scope_id
 LEFT JOIN v_project_demand_binding_current held
  ON held.project_scope_id=sc.id AND held.project_id=NEW.project_id
 WHERE aps.approval_version_id=NEW.id
 AND held.project_scope_id IS NULL)
 THEN RAISE(ABORT,'项目正式批准时其全部需求必须仍由该子项目独占关联') END;
END;

CREATE INDEX idx_demand_material_master ON demand_material_items(material_id,demand_id);
CREATE INDEX idx_project_scope_material_master ON project_scope_materials(material_id,project_scope_id);

CREATE TRIGGER approved_scope_demand_version_relation BEFORE INSERT ON project_approval_scope_versions
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_demand_scopes ps WHERE ps.id=NEW.project_scope_id
 AND ps.demand_id=NEW.demand_id)
 THEN RAISE(ABORT,'项目批准范围所指需求与项目需求范围不一致') END; END;


CREATE TRIGGER project_closed_no_reopen_without_decision
 BEFORE UPDATE OF status ON projects
 WHEN OLD.status='closed' AND NEW.status<>'closed'
BEGIN SELECT RAISE(ABORT,'费用全部结清后不得直接重新开启子项目；需另行正式授权'); END;
CREATE TRIGGER settlement_root_insert_only_active
 BEFORE INSERT ON settlements
 WHEN (SELECT status FROM projects p WHERE p.id=NEW.project_id)='closed'
BEGIN SELECT RAISE(ABORT,'已结项子项目不得私自建立新结算单，补录应形成复核事项'); END;

CREATE TRIGGER draft_approval_scope_valid_update
 BEFORE UPDATE ON project_approval_scope_versions
 WHEN (SELECT status FROM project_approval_versions a WHERE a.id=OLD.approval_version_id)='draft'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM project_demand_scopes sc
 JOIN project_approval_versions a ON a.project_id=sc.project_id
 WHERE sc.id=NEW.project_scope_id AND a.id=NEW.approval_version_id
 AND sc.demand_id=NEW.demand_id)
 THEN RAISE(ABORT,'草稿批准范围不能更改为别的需求或项目') END;
END;
CREATE TRIGGER draft_approval_material_valid_update
 BEFORE UPDATE ON project_approval_material_items
 WHEN (SELECT status FROM project_approval_versions a WHERE a.id=OLD.approval_version_id)='draft'
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_scope_materials pm
 JOIN v_material_current m ON m.id=pm.material_id
 WHERE pm.id=NEW.project_material_id AND pm.project_scope_id=NEW.project_scope_id
 AND m.material_version_id=NEW.material_version_id
 AND m.code=NEW.material_code_snapshot
 AND m.name=NEW.material_name AND m.model=NEW.material_model
 AND m.specification=NEW.specification AND m.unit_id=NEW.unit_id)
 THEN RAISE(ABORT,'项目物资草稿必须保持同一主数据的真实字段快照') END;
END;
CREATE TRIGGER material_master_inactive_new_demand
 BEFORE INSERT ON demand_material_items
 WHEN NOT EXISTS(SELECT 1 FROM v_material_current m WHERE m.id=NEW.material_id
 AND m.status='active')
BEGIN SELECT RAISE(ABORT,'新增需求只能引用已有正式启用版本的统一物资主数据'); END;

CREATE INDEX idx_settlement_funding_history
 ON settlement_versions(funding_version_id,settlement_id);
CREATE INDEX idx_cost_funding_history ON cost_versions(funding_version_id,entry_id);


-- Complete current demand definition: all readable fields originate from the
-- latest published demand version; lifecycle state only from append-only events.
CREATE VIEW v_demand_current AS
SELECT d.id,d.demand_no,d.batch_id,v.version AS current_version,
 v.quantity_scaled,v.operation_id,v.operation_version,v.work_object_id,
 v.unit_id,v.unit_version,v.snapshot_json AS full_definition_json,
 json_extract(v.snapshot_json,'$.target_object') AS target_object,
 json_extract(v.snapshot_json,'$.problem_description') AS problem_description,
 json_extract(v.snapshot_json,'$.completion_standard') AS completion_standard,
 json_extract(v.snapshot_json,'$.work_target_type') AS work_target_type,
 json_extract(v.snapshot_json,'$.priority_id') AS priority_id,
 json_extract(v.snapshot_json,'$.expected_on') AS expected_on,
 json_extract(v.snapshot_json,'$.logical_tower_id') AS logical_tower_id,
 json_extract(v.snapshot_json,'$.physical_tower_id') AS physical_tower_id,
 json_extract(v.snapshot_json,'$.span_id') AS span_id,
 json_extract(v.snapshot_json,'$.span_version') AS span_version,
 (SELECT e.to_status FROM demand_lifecycle_events e
 WHERE e.demand_id=d.id ORDER BY e.event_seq DESC LIMIT 1) AS status,
 v.recorded_at AS definition_changed_at
FROM demands d
JOIN demand_versions v ON v.demand_id=d.id
 AND v.version=(SELECT MAX(x.version) FROM demand_versions x WHERE x.demand_id=d.id);

CREATE VIEW v_demand_material_current AS
SELECT a.demand_id,a.demand_version,a.material_id,a.material_version_id,
 a.item_no,a.quantity_scaled,a.unit_id,a.unit_snapshot,a.note,
 m.code AS material_code,m.name AS current_master_name,m.model AS current_master_model
FROM demand_material_version_items a
JOIN v_material_current m ON m.id=a.material_id
JOIN v_demand_current d ON d.id=a.demand_id AND d.current_version=a.demand_version;


CREATE TRIGGER demand_lifecycle_initial_guard BEFORE INSERT ON demand_lifecycle_events
BEGIN
 SELECT CASE WHEN NEW.event_seq<>(SELECT COALESCE(MAX(event_seq),0)+1
 FROM demand_lifecycle_events WHERE demand_id=NEW.demand_id)
 THEN RAISE(ABORT,'需求状态事件序号必须连续') END;
 SELECT CASE WHEN NEW.event_seq=1 AND
 (NEW.from_status IS NOT NULL OR NEW.to_status<>'pending')
 THEN RAISE(ABORT,'初始需求事件必须是待确认状态') END;
 SELECT CASE WHEN NEW.event_seq>1 AND
 (NEW.from_status IS NOT (SELECT to_status FROM demand_lifecycle_events
 WHERE demand_id=NEW.demand_id ORDER BY event_seq DESC LIMIT 1)
 OR (NEW.from_status='cancelled')
 OR (NEW.from_status='pending' AND NEW.to_status NOT IN ('active','returned','cancelled'))
 OR (NEW.from_status='active' AND NEW.to_status NOT IN ('returned','cancelled'))
 OR (NEW.from_status='returned' AND NEW.to_status NOT IN ('pending','active','cancelled')))
 THEN RAISE(ABORT,'需求状态变化非法，不能直接改写历史或重新激活已取消需求') END;
 SELECT CASE WHEN NEW.event_seq>1 AND NEW.recorded_at <
 (SELECT e.recorded_at FROM demand_lifecycle_events e
 WHERE e.demand_id=NEW.demand_id ORDER BY e.event_seq DESC LIMIT 1)
 THEN RAISE(ABORT,'需求状态事件登记时间不能逆序') END;
END;
CREATE TRIGGER demand_lifecycle_no_update BEFORE UPDATE ON demand_lifecycle_events
BEGIN SELECT RAISE(ABORT,'需求生命周期事件不可覆盖'); END;
CREATE TRIGGER demand_lifecycle_no_delete BEFORE DELETE ON demand_lifecycle_events
BEGIN SELECT RAISE(ABORT,'需求生命周期事件不可删除'); END;

-- Initial demand material lists may be assembled only before any following
-- formal revision or project approved adoption. After that use a new demand revision.
CREATE TRIGGER demand_material_v1_insert AFTER INSERT ON demand_material_items
BEGIN
 INSERT INTO demand_material_version_items(demand_id,demand_version,material_id,
 material_version_id,item_no,quantity_scaled,unit_id,unit_snapshot,note)
 SELECT NEW.demand_id,1,NEW.material_id,m.material_version_id,NEW.item_no,
 NEW.quantity_scaled,m.unit_id,v.name,NEW.note
 FROM v_material_current m JOIN v_dictionary_current v ON v.id=m.unit_id
 WHERE m.id=NEW.material_id;
END;
CREATE TRIGGER demand_material_v1_update AFTER UPDATE ON demand_material_items
BEGIN
 UPDATE demand_material_version_items
 SET item_no=NEW.item_no,material_id=NEW.material_id,quantity_scaled=NEW.quantity_scaled,
 material_version_id=(SELECT material_version_id FROM v_material_current WHERE id=NEW.material_id),
 note=NEW.note,unit_id=(SELECT unit_id FROM materials WHERE id=NEW.material_id),
 unit_snapshot=(SELECT v.name FROM materials m JOIN v_dictionary_current v
 ON v.id=m.unit_id WHERE m.id=NEW.material_id)
 WHERE demand_id=OLD.demand_id AND demand_version=1 AND material_id=OLD.material_id;
END;
CREATE TRIGGER demand_material_v1_delete AFTER DELETE ON demand_material_items
BEGIN DELETE FROM demand_material_version_items
 WHERE demand_id=OLD.demand_id AND demand_version=1
 AND material_id=OLD.material_id; END;
CREATE TRIGGER demand_material_seed_frozen_update BEFORE UPDATE ON demand_material_items
WHEN EXISTS(SELECT 1 FROM demand_versions v WHERE v.demand_id=OLD.demand_id AND v.version>1)
 OR EXISTS(SELECT 1 FROM demand_lifecycle_events e WHERE e.demand_id=OLD.demand_id
 AND e.to_status='active')
 OR EXISTS(SELECT 1 FROM project_approval_scope_versions ap
 JOIN project_demand_scopes sc ON sc.id=ap.project_scope_id
 JOIN project_approval_versions pv ON pv.id=ap.approval_version_id
 WHERE sc.demand_id=OLD.demand_id AND pv.status='approved')
BEGIN SELECT RAISE(ABORT,'需求初始物资基线已使用，必须通过正式需求修订更改物资清单'); END;
CREATE TRIGGER demand_material_seed_frozen_delete BEFORE DELETE ON demand_material_items
WHEN EXISTS(SELECT 1 FROM demand_versions v WHERE v.demand_id=OLD.demand_id AND v.version>1)
 OR EXISTS(SELECT 1 FROM demand_lifecycle_events e WHERE e.demand_id=OLD.demand_id
 AND e.to_status='active')
 OR EXISTS(SELECT 1 FROM project_approval_scope_versions ap
 JOIN project_demand_scopes sc ON sc.id=ap.project_scope_id
 JOIN project_approval_versions pv ON pv.id=ap.approval_version_id
 WHERE sc.demand_id=OLD.demand_id AND pv.status='approved')
BEGIN SELECT RAISE(ABORT,'正式物资清单不可删除；后续材料变化通过新需求版本'); END;
CREATE TRIGGER demand_material_seed_frozen_insert BEFORE INSERT ON demand_material_items
WHEN EXISTS(SELECT 1 FROM demand_versions v WHERE v.demand_id=NEW.demand_id AND v.version>1)
 OR EXISTS(SELECT 1 FROM demand_lifecycle_events e WHERE e.demand_id=NEW.demand_id
 AND e.to_status='active')
 OR EXISTS(SELECT 1 FROM project_approval_scope_versions ap
 JOIN project_demand_scopes sc ON sc.id=ap.project_scope_id
 JOIN project_approval_versions pv ON pv.id=ap.approval_version_id
 WHERE sc.demand_id=NEW.demand_id AND pv.status='approved')
BEGIN SELECT RAISE(ABORT,'已确认需求物资清单不得追加到初始基线；请创建需求修订'); END;
CREATE TRIGGER demand_material_version_no_change_update BEFORE UPDATE ON demand_material_version_items
WHEN OLD.demand_version>1
 OR EXISTS(SELECT 1 FROM demand_versions v WHERE v.demand_id=OLD.demand_id AND v.version>1)
 OR EXISTS(SELECT 1 FROM demand_lifecycle_events e
 WHERE e.demand_id=OLD.demand_id AND e.to_status='active')
 OR EXISTS(SELECT 1 FROM project_approval_scope_versions ap
 JOIN project_demand_scopes sc ON sc.id=ap.project_scope_id
 JOIN project_approval_versions pv ON pv.id=ap.approval_version_id
 WHERE sc.demand_id=OLD.demand_id AND pv.status='approved')
BEGIN SELECT RAISE(ABORT,'已发布需求物资完整清单不可覆盖'); END;
CREATE TRIGGER demand_material_version_no_change_delete BEFORE DELETE ON demand_material_version_items
WHEN OLD.demand_version>1
 OR EXISTS(SELECT 1 FROM demand_versions v WHERE v.demand_id=OLD.demand_id AND v.version>1)
 OR EXISTS(SELECT 1 FROM demand_lifecycle_events e
 WHERE e.demand_id=OLD.demand_id AND e.to_status='active')
 OR EXISTS(SELECT 1 FROM project_approval_scope_versions ap
 JOIN project_demand_scopes sc ON sc.id=ap.project_scope_id
 JOIN project_approval_versions pv ON pv.id=ap.approval_version_id
 WHERE sc.demand_id=OLD.demand_id AND pv.status='approved')
BEGIN SELECT RAISE(ABORT,'已发布需求物资完整清单不可删除'); END;
CREATE INDEX idx_demand_material_version_master ON demand_material_version_items(material_id,demand_id,demand_version);
-- Project lifecycle authority is project_stage_events. projects.status/version
-- is only a trigger-maintained read projection. Direct updates are impossible.
CREATE TRIGGER project_status_projection_guard BEFORE UPDATE OF status,version ON projects
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_stage_events e WHERE e.project_id=NEW.id
 AND e.stage=NEW.status AND e.project_version=NEW.version
 AND NEW.version=OLD.version+1)
 THEN RAISE(ABORT,'项目状态只能由有效项目阶段事件原子推进') END;
END;
CREATE TRIGGER project_stage_event_transition BEFORE INSERT ON project_stage_events
BEGIN
 SELECT CASE WHEN NEW.project_version<>(SELECT version+1 FROM projects WHERE id=NEW.project_id)
 THEN RAISE(ABORT,'项目阶段版本必须严格连续') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_management_versions profile
 WHERE profile.project_id=NEW.project_id AND profile.version_no=1)
 THEN RAISE(ABORT,'子项目必须具有完整的首版名称与类别档案才能流转正式阶段') END;
 SELECT CASE WHEN NEW.created_at<
 (SELECT p.created_at FROM projects p WHERE p.id=NEW.project_id)
 OR NEW.created_at<
 (SELECT MAX(e.created_at) FROM project_stage_events e
  WHERE e.project_id=NEW.project_id)
 THEN RAISE(ABORT,'子项目阶段事件不能早于项目建档或上一阶段事件') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND (
 (p.status='reserve' AND NEW.stage='stocked')
 OR (p.status='stocked' AND NEW.stage='approved')
 OR (p.status='approved' AND NEW.stage='closed')))
 THEN RAISE(ABORT,'项目阶段变更不符合储备、入库、立项、关闭的正式流转') END;

END;
CREATE TRIGGER project_stage_event_apply AFTER INSERT ON project_stage_events
BEGIN
 UPDATE projects SET status=NEW.stage,version=NEW.project_version
 WHERE id=NEW.project_id;
END;

CREATE TRIGGER line_history_initial AFTER INSERT ON transmission_lines
BEGIN INSERT INTO line_history(line_id,version,name,voltage_level_id,status,line_kind,parent_line_id,junction_tower_id,setup_status,erection_type,actor_id,reason,recorded_at)
 VALUES(NEW.id,NEW.version,NEW.name,NEW.voltage_level_id,NEW.status,NEW.line_kind,NEW.parent_line_id,NEW.junction_tower_id,NEW.setup_status,NEW.erection_type,NEW.created_by,'首次建档',NEW.created_at); END;
CREATE TRIGGER line_history_version_guard BEFORE UPDATE ON transmission_lines
WHEN (NEW.name IS NOT OLD.name OR NEW.voltage_level_id IS NOT OLD.voltage_level_id OR NEW.status IS NOT OLD.status OR NEW.line_kind IS NOT OLD.line_kind OR NEW.parent_line_id IS NOT OLD.parent_line_id OR NEW.junction_tower_id IS NOT OLD.junction_tower_id OR NEW.setup_status IS NOT OLD.setup_status OR NEW.erection_type IS NOT OLD.erection_type) OR NEW.version<>OLD.version
BEGIN
 SELECT CASE WHEN NEW.version<>OLD.version+1
 OR (NEW.name IS OLD.name AND NEW.voltage_level_id IS OLD.voltage_level_id AND NEW.status IS OLD.status AND NEW.line_kind IS OLD.line_kind AND NEW.parent_line_id IS OLD.parent_line_id AND NEW.junction_tower_id IS OLD.junction_tower_id AND NEW.setup_status IS OLD.setup_status AND NEW.erection_type IS OLD.erection_type)
 OR NEW.updated_by IS NULL
 OR NEW.updated_at<=OLD.updated_at
 THEN RAISE(ABORT,'设备台账变更必须有真实属性变化、责任人和连续新版本') END;
END;
CREATE TRIGGER line_history_append AFTER UPDATE ON transmission_lines
WHEN (NEW.name IS NOT OLD.name OR NEW.voltage_level_id IS NOT OLD.voltage_level_id OR NEW.status IS NOT OLD.status OR NEW.line_kind IS NOT OLD.line_kind OR NEW.parent_line_id IS NOT OLD.parent_line_id OR NEW.junction_tower_id IS NOT OLD.junction_tower_id OR NEW.setup_status IS NOT OLD.setup_status OR NEW.erection_type IS NOT OLD.erection_type)
BEGIN INSERT INTO line_history(line_id,version,name,voltage_level_id,status,line_kind,parent_line_id,junction_tower_id,setup_status,erection_type,actor_id,reason,recorded_at)
 VALUES(NEW.id,NEW.version,NEW.name,NEW.voltage_level_id,NEW.status,NEW.line_kind,NEW.parent_line_id,NEW.junction_tower_id,NEW.setup_status,NEW.erection_type,NEW.updated_by,NEW.change_reason,NEW.updated_at); END;
CREATE TRIGGER line_history_immutable_update BEFORE UPDATE ON line_history
BEGIN SELECT RAISE(ABORT,'设备完整历史不可覆盖'); END;
CREATE TRIGGER line_history_immutable_delete BEFORE DELETE ON line_history
BEGIN SELECT RAISE(ABORT,'设备完整历史不可删除'); END;

CREATE TRIGGER line_history_identity_insert BEFORE INSERT ON line_history
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM transmission_lines a WHERE a.id=NEW.line_id
 AND a.version=NEW.version
 AND NEW.name IS a.name AND NEW.voltage_level_id IS a.voltage_level_id AND NEW.status IS a.status AND NEW.line_kind IS a.line_kind AND NEW.parent_line_id IS a.parent_line_id AND NEW.junction_tower_id IS a.junction_tower_id AND NEW.setup_status IS a.setup_status AND NEW.erection_type IS a.erection_type
 AND (a.created_at=NEW.recorded_at OR a.updated_at=NEW.recorded_at)
 )
 THEN RAISE(ABORT,'设备历史必须来自已保存的真实台账完整版本') END;
END;

CREATE TRIGGER physical_tower_history_initial AFTER INSERT ON physical_towers
BEGIN INSERT INTO physical_tower_history(physical_tower_id,version,asset_no,tower_type,longitude,latitude,commissioned_on,model,height_scaled,purpose,status,actor_id,reason,recorded_at)
 VALUES(NEW.id,NEW.version,NEW.asset_no,NEW.tower_type,NEW.longitude,NEW.latitude,NEW.commissioned_on,NEW.model,NEW.height_scaled,NEW.purpose,NEW.status,NEW.created_by,'首次建档',NEW.created_at); END;
CREATE TRIGGER physical_tower_history_version_guard BEFORE UPDATE ON physical_towers
WHEN (NEW.asset_no IS NOT OLD.asset_no OR NEW.tower_type IS NOT OLD.tower_type OR NEW.longitude IS NOT OLD.longitude OR NEW.latitude IS NOT OLD.latitude OR NEW.commissioned_on IS NOT OLD.commissioned_on OR NEW.model IS NOT OLD.model OR NEW.height_scaled IS NOT OLD.height_scaled OR NEW.purpose IS NOT OLD.purpose OR NEW.status IS NOT OLD.status) OR NEW.version<>OLD.version
BEGIN
 SELECT CASE WHEN NEW.version<>OLD.version+1
 OR (NEW.asset_no IS OLD.asset_no AND NEW.tower_type IS OLD.tower_type AND NEW.longitude IS OLD.longitude AND NEW.latitude IS OLD.latitude AND NEW.commissioned_on IS OLD.commissioned_on AND NEW.model IS OLD.model AND NEW.height_scaled IS OLD.height_scaled AND NEW.purpose IS OLD.purpose AND NEW.status IS OLD.status)
 OR NEW.updated_by IS NULL
 OR NEW.updated_at<=OLD.updated_at
 THEN RAISE(ABORT,'设备台账变更必须有真实属性变化、责任人和连续新版本') END;
END;
CREATE TRIGGER physical_tower_history_append AFTER UPDATE ON physical_towers
WHEN (NEW.asset_no IS NOT OLD.asset_no OR NEW.tower_type IS NOT OLD.tower_type OR NEW.longitude IS NOT OLD.longitude OR NEW.latitude IS NOT OLD.latitude OR NEW.commissioned_on IS NOT OLD.commissioned_on OR NEW.model IS NOT OLD.model OR NEW.height_scaled IS NOT OLD.height_scaled OR NEW.purpose IS NOT OLD.purpose OR NEW.status IS NOT OLD.status)
BEGIN INSERT INTO physical_tower_history(physical_tower_id,version,asset_no,tower_type,longitude,latitude,commissioned_on,model,height_scaled,purpose,status,actor_id,reason,recorded_at)
 VALUES(NEW.id,NEW.version,NEW.asset_no,NEW.tower_type,NEW.longitude,NEW.latitude,NEW.commissioned_on,NEW.model,NEW.height_scaled,NEW.purpose,NEW.status,NEW.updated_by,NEW.change_reason,NEW.updated_at); END;
CREATE TRIGGER physical_tower_history_immutable_update BEFORE UPDATE ON physical_tower_history
BEGIN SELECT RAISE(ABORT,'设备完整历史不可覆盖'); END;
CREATE TRIGGER physical_tower_history_immutable_delete BEFORE DELETE ON physical_tower_history
BEGIN SELECT RAISE(ABORT,'设备完整历史不可删除'); END;

CREATE TRIGGER physical_tower_history_identity_insert BEFORE INSERT ON physical_tower_history
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM physical_towers a WHERE a.id=NEW.physical_tower_id
 AND a.version=NEW.version
 AND NEW.asset_no IS a.asset_no AND NEW.tower_type IS a.tower_type AND NEW.longitude IS a.longitude AND NEW.latitude IS a.latitude AND NEW.commissioned_on IS a.commissioned_on AND NEW.model IS a.model AND NEW.height_scaled IS a.height_scaled AND NEW.purpose IS a.purpose AND NEW.status IS a.status
 AND (a.created_at=NEW.recorded_at OR a.updated_at=NEW.recorded_at)
 )
 THEN RAISE(ABORT,'设备历史必须来自已保存的真实台账完整版本') END;
END;

CREATE TRIGGER logical_tower_history_initial AFTER INSERT ON logical_towers
BEGIN INSERT INTO logical_tower_history(logical_tower_id,version,line_id,physical_tower_id,tower_no,display_name,sort_rank,circuit_position,management_department,operations_team,status,actor_id,reason,recorded_at)
 VALUES(NEW.id,NEW.version,NEW.line_id,NEW.physical_tower_id,NEW.tower_no,NEW.display_name,NEW.sort_rank,NEW.circuit_position,NEW.management_department,NEW.operations_team,NEW.status,NEW.created_by,'首次建档',NEW.created_at); END;
CREATE TRIGGER logical_tower_history_version_guard BEFORE UPDATE ON logical_towers
WHEN (NEW.line_id IS NOT OLD.line_id OR NEW.physical_tower_id IS NOT OLD.physical_tower_id OR NEW.tower_no IS NOT OLD.tower_no OR NEW.display_name IS NOT OLD.display_name OR NEW.sort_rank IS NOT OLD.sort_rank OR NEW.circuit_position IS NOT OLD.circuit_position OR NEW.management_department IS NOT OLD.management_department OR NEW.operations_team IS NOT OLD.operations_team OR NEW.status IS NOT OLD.status) OR NEW.version<>OLD.version
BEGIN
 SELECT CASE WHEN NEW.version<>OLD.version+1
 OR (NEW.line_id IS OLD.line_id AND NEW.physical_tower_id IS OLD.physical_tower_id AND NEW.tower_no IS OLD.tower_no AND NEW.display_name IS OLD.display_name AND NEW.sort_rank IS OLD.sort_rank AND NEW.circuit_position IS OLD.circuit_position AND NEW.management_department IS OLD.management_department AND NEW.operations_team IS OLD.operations_team AND NEW.status IS OLD.status)
 OR NEW.updated_by IS NULL
 OR NEW.updated_at<=OLD.updated_at
 THEN RAISE(ABORT,'设备台账变更必须有真实属性变化、责任人和连续新版本') END;
END;
CREATE TRIGGER logical_tower_history_append AFTER UPDATE ON logical_towers
WHEN (NEW.line_id IS NOT OLD.line_id OR NEW.physical_tower_id IS NOT OLD.physical_tower_id OR NEW.tower_no IS NOT OLD.tower_no OR NEW.display_name IS NOT OLD.display_name OR NEW.sort_rank IS NOT OLD.sort_rank OR NEW.circuit_position IS NOT OLD.circuit_position OR NEW.management_department IS NOT OLD.management_department OR NEW.operations_team IS NOT OLD.operations_team OR NEW.status IS NOT OLD.status)
BEGIN INSERT INTO logical_tower_history(logical_tower_id,version,line_id,physical_tower_id,tower_no,display_name,sort_rank,circuit_position,management_department,operations_team,status,actor_id,reason,recorded_at)
 VALUES(NEW.id,NEW.version,NEW.line_id,NEW.physical_tower_id,NEW.tower_no,NEW.display_name,NEW.sort_rank,NEW.circuit_position,NEW.management_department,NEW.operations_team,NEW.status,NEW.updated_by,NEW.change_reason,NEW.updated_at); END;
CREATE TRIGGER logical_tower_history_immutable_update BEFORE UPDATE ON logical_tower_history
BEGIN SELECT RAISE(ABORT,'设备完整历史不可覆盖'); END;
CREATE TRIGGER logical_tower_history_immutable_delete BEFORE DELETE ON logical_tower_history
BEGIN SELECT RAISE(ABORT,'设备完整历史不可删除'); END;

CREATE TRIGGER logical_tower_history_identity_insert BEFORE INSERT ON logical_tower_history
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM logical_towers a WHERE a.id=NEW.logical_tower_id
 AND a.version=NEW.version
 AND NEW.line_id IS a.line_id AND NEW.physical_tower_id IS a.physical_tower_id AND NEW.tower_no IS a.tower_no AND NEW.display_name IS a.display_name AND NEW.sort_rank IS a.sort_rank AND NEW.circuit_position IS a.circuit_position AND NEW.management_department IS a.management_department AND NEW.operations_team IS a.operations_team AND NEW.status IS a.status
 AND (a.created_at=NEW.recorded_at OR a.updated_at=NEW.recorded_at)
 )
 THEN RAISE(ABORT,'设备历史必须来自已保存的真实台账完整版本') END;
END;

CREATE UNIQUE INDEX uq_active_tower_line_no
 ON logical_towers(line_id,tower_no) WHERE status='active';
CREATE INDEX idx_line_history_voltage ON line_history(voltage_level_id,line_id);
CREATE INDEX idx_physical_tower_history_time ON physical_tower_history(physical_tower_id,recorded_at);
CREATE INDEX idx_logical_tower_history_line ON logical_tower_history(line_id,logical_tower_id,version);


CREATE VIEW v_project_management_current AS
SELECT v.* FROM project_management_versions v
WHERE v.version_no=(SELECT MAX(x.version_no) FROM project_management_versions x
WHERE x.project_id=v.project_id);
CREATE TRIGGER management_version_guard BEFORE INSERT ON project_management_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(version_no),0)+1
 FROM project_management_versions WHERE project_id=NEW.project_id)
 THEN RAISE(ABORT,'子项目管理档案需保留连续版本') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT p.created_at FROM projects p WHERE p.id=NEW.project_id)
 OR NEW.recorded_at<
 (SELECT MAX(v.recorded_at) FROM project_management_versions v
  WHERE v.project_id=NEW.project_id)
 THEN RAISE(ABORT,'子项目管理档案版本不能倒序或早于子项目创建') END;
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM dictionary_item_versions cat
 WHERE cat.item_id=NEW.category_id AND cat.version=NEW.category_version
 AND cat.changed_at<=NEW.recorded_at)
 THEN RAISE(ABORT,'项目正式类别不能引用该版本登记之后才发布的字典名称') END;
 SELECT CASE WHEN NEW.managing_unit_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM organizational_unit_versions org
 WHERE org.id=NEW.managing_unit_version_id
 AND org.unit_id=NEW.managing_unit_id
 AND org.recorded_at<=NEW.recorded_at)
 THEN RAISE(ABORT,'子项目归口单位历史不能引用未来才登记的组织定义版本') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM project_management_versions old
 WHERE old.project_id=NEW.project_id AND old.version_no=NEW.version_no-1
 AND old.name=NEW.name
 AND old.category_id IS NEW.category_id
 AND old.category_version IS NEW.category_version
 AND old.owner_id IS NEW.owner_id
 AND old.manager_id IS NEW.manager_id
 AND old.managing_unit_id IS NEW.managing_unit_id
 AND old.managing_unit_version_id IS NEW.managing_unit_version_id
 AND old.planned_start_on IS NEW.planned_start_on
 AND old.planned_end_on IS NEW.planned_end_on
 AND old.preliminary_estimate_fen IS NEW.preliminary_estimate_fen
 AND old.preliminary_estimate_basis IS NEW.preliminary_estimate_basis)
 THEN RAISE(ABORT,'项目档案、责任和初步估算内容均未变化，无需新增无效版本') END;
 SELECT CASE WHEN (SELECT status FROM projects WHERE id=NEW.project_id)='closed'
 THEN RAISE(ABORT,'已关闭项目的管理计划不可私自改动') END;
END;
CREATE TRIGGER management_version_no_update BEFORE UPDATE ON project_management_versions
BEGIN SELECT RAISE(ABORT,'子项目归口及管理档案历史不可覆盖'); END;
CREATE TRIGGER management_version_no_delete BEFORE DELETE ON project_management_versions
BEGIN SELECT RAISE(ABORT,'子项目归口及管理档案历史不可删除'); END;
CREATE UNIQUE INDEX uq_import_source_record
 ON source_records(source_system,external_record_id) WHERE external_record_id IS NOT NULL;
CREATE UNIQUE INDEX uq_excel_source_row
 ON source_records(source_file_id,worksheet_name,row_number)
 WHERE source_file_id IS NOT NULL AND worksheet_name IS NOT NULL AND row_number IS NOT NULL;
CREATE INDEX idx_project_managing_unit ON project_management_versions(managing_unit_id,project_id);
CREATE INDEX idx_material_category ON material_versions(category_id);


CREATE TRIGGER demand_material_version_source_guard
 BEFORE INSERT ON demand_material_version_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM material_versions mv
 WHERE mv.id=NEW.material_version_id AND mv.material_id=NEW.material_id)
 THEN RAISE(ABORT,'需求历史物资版本必须属于对应稳定物资身份') END;
 SELECT CASE WHEN (NEW.demand_version=1 OR EXISTS(
 SELECT 1 FROM demand_revisions r WHERE r.demand_id=NEW.demand_id
 AND r.version=NEW.demand_version
 AND json_type(r.snapshot_json,'$.materials')='array'))
 AND NEW.material_version_id IS NOT
 (SELECT cur.material_version_id FROM v_material_current cur
  WHERE cur.id=NEW.material_id)
 THEN RAISE(ABORT,'新建或明确更新的需求物资必须使用当前物资主数据正式版本') END;
 SELECT CASE WHEN NEW.unit_id IS NOT (SELECT m.unit_id FROM materials m WHERE m.id=NEW.material_id)
 THEN RAISE(ABORT,'需求历史物资计量单位必须与统一物资主数据一致') END;
 SELECT CASE WHEN NEW.demand_version=1 AND NOT EXISTS(
 SELECT 1 FROM demand_material_items d
 WHERE d.demand_id=NEW.demand_id AND d.material_id=NEW.material_id
 AND d.quantity_scaled=NEW.quantity_scaled AND d.item_no=NEW.item_no
 AND d.note=NEW.note)
 THEN RAISE(ABORT,'初始需求物资历史必须来自原始需求物资清单') END;
 SELECT CASE WHEN NEW.demand_version>1 AND NOT EXISTS(
 SELECT 1 FROM demand_revisions r
 WHERE r.demand_id=NEW.demand_id AND r.version=NEW.demand_version AND (
 (json_type(r.snapshot_json,'$.materials') IS NULL AND EXISTS(
 SELECT 1 FROM demand_material_version_items prev
 WHERE prev.demand_id=NEW.demand_id AND prev.demand_version=NEW.demand_version-1
 AND prev.material_id=NEW.material_id AND prev.quantity_scaled=NEW.quantity_scaled
 AND prev.item_no=NEW.item_no AND prev.unit_id=NEW.unit_id
 AND prev.material_version_id=NEW.material_version_id
 AND prev.unit_snapshot=NEW.unit_snapshot AND prev.note=NEW.note))
 OR
 (json_type(r.snapshot_json,'$.materials')='array' AND EXISTS(
 SELECT 1 FROM json_each(r.snapshot_json,'$.materials') x
 WHERE json_extract(x.value,'$.material_id')=NEW.material_id
 AND CAST(x.key AS INTEGER)+1=NEW.item_no
 AND json_extract(x.value,'$.quantity_scaled')=NEW.quantity_scaled
 AND COALESCE(json_extract(x.value,'$.note'),'')=NEW.note))))
 THEN RAISE(ABORT,'需求版本物资条目必须来自正式需求修订的完整清单') END;
END;

CREATE TRIGGER line_identity_immutable BEFORE UPDATE ON transmission_lines
WHEN NEW.id IS NOT OLD.id OR NEW.line_code IS NOT OLD.line_code
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.updated_at IS NOT OLD.updated_at AND NEW.version=OLD.version)
 OR (NEW.updated_by IS NOT OLD.updated_by AND NEW.version=OLD.version)
 OR (NEW.change_reason IS NOT OLD.change_reason AND NEW.version=OLD.version)
BEGIN SELECT RAISE(ABORT,'设备稳定身份及历史写入责任不可单独改写'); END;

CREATE TRIGGER physical_tower_identity_immutable BEFORE UPDATE ON physical_towers
WHEN NEW.id IS NOT OLD.id OR NEW.tower_code IS NOT OLD.tower_code
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.updated_at IS NOT OLD.updated_at AND NEW.version=OLD.version)
 OR (NEW.updated_by IS NOT OLD.updated_by AND NEW.version=OLD.version)
 OR (NEW.change_reason IS NOT OLD.change_reason AND NEW.version=OLD.version)
BEGIN SELECT RAISE(ABORT,'设备稳定身份及历史写入责任不可单独改写'); END;

CREATE TRIGGER logical_tower_identity_immutable BEFORE UPDATE ON logical_towers
WHEN NEW.id IS NOT OLD.id OR NEW.logical_code IS NOT OLD.logical_code
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.updated_at IS NOT OLD.updated_at AND NEW.version=OLD.version)
 OR (NEW.updated_by IS NOT OLD.updated_by AND NEW.version=OLD.version)
 OR (NEW.change_reason IS NOT OLD.change_reason AND NEW.version=OLD.version)
BEGIN SELECT RAISE(ABORT,'设备稳定身份及历史写入责任不可单独改写'); END;


-- Active topology and its end-tower/line identities must stay coherent.
-- Re-parenting/retiring a tower or line requires first retiring its active
-- spans with an explicit audited line_span_history version.
CREATE TRIGGER active_span_logical_tower_guard
 BEFORE UPDATE OF line_id,status ON logical_towers
 WHEN (NEW.line_id IS NOT OLD.line_id
   OR (OLD.status='active' AND NEW.status<>'active'))
 AND EXISTS(SELECT 1 FROM line_spans sp WHERE sp.status='active'
 AND (sp.start_tower_id=OLD.id OR sp.end_tower_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'存在在运档距，禁止直接移线或退役逻辑杆塔；须先更新档距历史'); END;
CREATE TRIGGER active_span_line_guard
 BEFORE UPDATE OF status,line_kind,parent_line_id,junction_tower_id ON transmission_lines
 WHEN (NEW.status IS NOT OLD.status OR NEW.line_kind IS NOT OLD.line_kind
 OR NEW.parent_line_id IS NOT OLD.parent_line_id
 OR NEW.junction_tower_id IS NOT OLD.junction_tower_id)
 AND EXISTS(SELECT 1 FROM line_spans sp WHERE sp.line_id=OLD.id AND sp.status='active')
BEGIN SELECT RAISE(ABORT,'在运档距所在线路的状态或接线关系变化须先更新档距历史'); END;
-- Permanently retiring one line is NOT a multi-circuit tower demolition.
-- All active logical towers on THAT line and its active spans must first be
-- legally retired; shared physical towers or other lines stay unchanged.
CREATE TRIGGER line_retirement_logical_guard
 BEFORE UPDATE OF status ON transmission_lines
 WHEN NEW.status='retired' AND OLD.status<>'retired'
 AND EXISTS(SELECT 1 FROM logical_towers l WHERE l.line_id=OLD.id
 AND l.status='active')
BEGIN SELECT RAISE(ABORT,'线路正式退役前须处理本线路全部在运逻辑杆塔，不影响其他共塔线路'); END;
-- Physical operation status is independent of per-circuit logical retirement,
-- but an active logical tower cannot be served by a non-operational structure.
CREATE TRIGGER active_logical_tower_physical_guard
 BEFORE INSERT ON logical_towers
 WHEN NEW.status='active'
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM physical_towers p WHERE p.id=NEW.physical_tower_id
 AND p.status='active')
 THEN RAISE(ABORT,'在运逻辑杆塔必须关联在运物理杆塔') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM transmission_lines l WHERE l.id=NEW.line_id
 AND l.status='retired')
 THEN RAISE(ABORT,'已退役线路不得增加在运逻辑杆塔') END;
END;
CREATE TRIGGER active_logical_tower_physical_update_guard
 BEFORE UPDATE OF status,physical_tower_id,line_id ON logical_towers
 WHEN NEW.status='active'
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM physical_towers p WHERE p.id=NEW.physical_tower_id
 AND p.status='active')
 THEN RAISE(ABORT,'在运逻辑杆塔必须关联在运物理杆塔') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM transmission_lines l WHERE l.id=NEW.line_id
 AND l.status='retired')
 THEN RAISE(ABORT,'已退役线路不得关联在运逻辑杆塔') END;
END;
CREATE TRIGGER active_physical_tower_retire_guard
 BEFORE UPDATE OF status ON physical_towers
 WHEN NEW.status<>'active' AND OLD.status='active'
 AND EXISTS(SELECT 1 FROM logical_towers l WHERE l.physical_tower_id=OLD.id
 AND l.status='active')
BEGIN SELECT RAISE(ABORT,'仍有在运逻辑杆塔关联，物理杆塔不可停用或退役；须先处理相关线路'); END;

CREATE TRIGGER demand_adopted_cancel_guard
 BEFORE INSERT ON demand_lifecycle_events
 WHEN NEW.event_seq>1 AND NEW.to_status='cancelled'
 AND EXISTS(
  SELECT 1 FROM v_project_demand_binding_current held
  WHERE held.demand_id=NEW.demand_id)
BEGIN SELECT RAISE(ABORT,'需求尚关联子项目，须先完成明确解绑才能取消该需求'); END;

CREATE TRIGGER org_unit_root_immutable_update BEFORE UPDATE ON organizational_units
BEGIN SELECT RAISE(ABORT,'组织单位稳定编码不可覆盖；正式更名、上级或停用需要新版定义'); END;
CREATE TRIGGER org_unit_root_immutable_delete BEFORE DELETE ON organizational_units
BEGIN SELECT RAISE(ABORT,'组织单位稳定身份不可删除'); END;
CREATE TRIGGER org_unit_version_immutable_update BEFORE UPDATE ON organizational_unit_versions
BEGIN SELECT RAISE(ABORT,'组织机构定义的正式历史不可覆盖'); END;
CREATE TRIGGER org_unit_version_immutable_delete BEFORE DELETE ON organizational_unit_versions
BEGIN SELECT RAISE(ABORT,'组织机构定义的正式历史不可删除'); END;
CREATE TRIGGER org_unit_version_insert_guard BEFORE INSERT ON organizational_unit_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(v.version_no),0)+1
 FROM organizational_unit_versions v WHERE v.unit_id=NEW.unit_id)
 THEN RAISE(ABORT,'组织单位版本号必须连续') END;
 SELECT CASE WHEN NEW.recorded_at<
 (SELECT MAX(v.recorded_at) FROM organizational_unit_versions v WHERE v.unit_id=NEW.unit_id)
 THEN RAISE(ABORT,'组织单位定义版本登记时间不能倒序') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM organizational_unit_versions old WHERE old.unit_id=NEW.unit_id
 AND old.version_no=NEW.version_no-1 AND old.name=NEW.name
 AND old.parent_unit_id IS NEW.parent_unit_id AND old.status=NEW.status)
 THEN RAISE(ABORT,'组织单位名称、上级和状态均未变动，无需新增空版本') END;
 SELECT CASE WHEN NEW.parent_unit_id IS NOT NULL AND
 NOT EXISTS(SELECT 1 FROM v_organizational_unit_current
 WHERE id=NEW.parent_unit_id)
 THEN RAISE(ABORT,'组织单位的上级必须已有正式定义版本') END;
 SELECT CASE WHEN NEW.parent_unit_id IS NOT NULL AND EXISTS(
 WITH RECURSIVE ancestors(id) AS (
  SELECT NEW.parent_unit_id
  UNION
  SELECT parent.parent_unit_id FROM v_organizational_unit_current parent
  JOIN ancestors a ON a.id=parent.id WHERE parent.parent_unit_id IS NOT NULL)
 SELECT 1 FROM ancestors WHERE id=NEW.unit_id)
 THEN RAISE(ABORT,'组织单位层级历史不能建立当前父子循环') END;
END;


-- Source lineage: no redundant batch/demand/source triple. Once a raw source
-- is associated with a demand or an import batch, it becomes evidence, not
-- editable text whose contents can silently change after project approval.
-- Existing uq_import_source_record / uq_excel_source_row enforce source identity; do not duplicate indexes.
CREATE TRIGGER source_identity_immutable_update
 BEFORE UPDATE ON source_records
 WHEN EXISTS(SELECT 1 FROM demand_sources d WHERE d.source_id=OLD.id)
  OR EXISTS(SELECT 1 FROM demand_batches b WHERE b.source_id=OLD.id)
  OR EXISTS(SELECT 1 FROM batch_demand_sources x WHERE x.source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'已建立需求或批次引用的来源证据不可原地改写，应增加新来源记录'); END;
CREATE TRIGGER source_identity_immutable_delete
 BEFORE DELETE ON source_records
 WHEN EXISTS(SELECT 1 FROM demand_sources d WHERE d.source_id=OLD.id)
  OR EXISTS(SELECT 1 FROM demand_batches b WHERE b.source_id=OLD.id)
  OR EXISTS(SELECT 1 FROM batch_demand_sources x WHERE x.source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'已被业务引用的来源证据不可删除'); END;
CREATE TRIGGER demand_source_identity_immutable_update
 BEFORE UPDATE ON demand_sources
BEGIN SELECT RAISE(ABORT,'需求来源关系不可直接改挂；正式更正须有独立来源依据'); END;
CREATE TRIGGER demand_source_identity_protected_delete
 BEFORE DELETE ON demand_sources
 WHEN EXISTS(SELECT 1 FROM demand_lifecycle_events e
 WHERE e.demand_id=OLD.demand_id AND e.to_status='active')
 OR EXISTS(SELECT 1 FROM project_demand_scopes p WHERE p.demand_id=OLD.demand_id)
BEGIN SELECT RAISE(ABORT,'已确认或已由项目承接的需求不可抹除来源关联'); END;
CREATE TRIGGER batch_source_provenance_update_guard
 BEFORE UPDATE OF source_id ON demand_batches
 WHEN EXISTS(SELECT 1 FROM demands d WHERE d.batch_id=OLD.id)
 OR OLD.status='submitted'
BEGIN SELECT RAISE(ABORT,'已用于导入需求的批次来源不得事后改挂'); END;


-- Intake batch metadata and its submitted payload are historical evidence,
-- not an editable copy of the current demand definition.
CREATE TRIGGER demand_batch_draft_edit_version_guard
 BEFORE UPDATE OF draft_json,version ON demand_batches
 WHEN OLD.status='draft' AND NEW.draft_json IS NOT OLD.draft_json
  AND NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'批次草稿修改正文须递增编辑版本'); END;

CREATE TRIGGER demand_batch_submitted_immutable_update
 BEFORE UPDATE ON demand_batches WHEN OLD.status='submitted'
BEGIN SELECT RAISE(ABORT,'已提交的需求导入批次与来源元数据不可覆盖'); END;

CREATE TRIGGER demand_batch_submitted_immutable_delete
 BEFORE DELETE ON demand_batches WHEN OLD.status='submitted'
BEGIN SELECT RAISE(ABORT,'已提交的需求导入批次不能删除'); END;



-- An immutable import assertion cannot claim that a demand originated from
-- another batch. This is deliberately separate from later corroborating
-- demand_sources associations.
CREATE TRIGGER batch_demand_source_batch_identity_insert
 BEFORE INSERT ON batch_demand_sources
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM demands d
 JOIN demand_batches b ON b.id=d.batch_id
 WHERE d.id=NEW.demand_id AND b.id=NEW.batch_id)
 THEN RAISE(ABORT,'导入批次来源记录必须属于该需求的真实导入批次') END;
END;

CREATE TRIGGER batch_demand_source_immutable_update
 BEFORE UPDATE ON batch_demand_sources
BEGIN SELECT RAISE(ABORT,'原始导入批次的需求来源历史不能改挂'); END;
CREATE TRIGGER batch_demand_source_immutable_delete
 BEFORE DELETE ON batch_demand_sources
BEGIN SELECT RAISE(ABORT,'原始导入批次的需求来源历史不能删除'); END;


-- Index only high-cardinality, expected reverse-lookup relations; do not
-- blindly create indexes for every foreign-key group (many are audit actors).
CREATE INDEX idx_reconciliation_cost_version
 ON cost_reconciliation_versions(cost_version_id);
CREATE INDEX idx_evidence_demand_version
 ON evidence_links(demand_version_demand_id,demand_version_no)
 WHERE demand_version_demand_id IS NOT NULL;
CREATE INDEX idx_evidence_demand_material_version
 ON evidence_links(demand_material_demand_id,demand_material_version_no,demand_material_master_id)
 WHERE demand_material_demand_id IS NOT NULL;
CREATE INDEX idx_approval_scope_demand_version
 ON project_approval_scope_versions(demand_id,demand_version);

CREATE TRIGGER material_root_immutable_update BEFORE UPDATE ON materials
BEGIN SELECT RAISE(ABORT,'物资内部编码和计量单位为不可变稳定身份；修改名称规格请发布版本'); END;
CREATE TRIGGER material_root_immutable_delete BEFORE DELETE ON materials
BEGIN SELECT RAISE(ABORT,'统一物资主数据身份不可删除，停用请发布版本'); END;
CREATE TRIGGER material_version_insert_guard BEFORE INSERT ON material_versions
BEGIN
 SELECT CASE WHEN NEW.version_no<>(SELECT COALESCE(MAX(x.version_no),0)+1
 FROM material_versions x WHERE x.material_id=NEW.material_id)
 THEN RAISE(ABORT,'物资正式版本必须从1连续增加') END;
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM dictionary_items d WHERE d.id=NEW.category_id
 AND d.type_id='material_category')
 THEN RAISE(ABORT,'物资版本类别必须属于物资分类字典') END;
 SELECT CASE WHEN NEW.recorded_at < COALESCE((
 SELECT MAX(x.recorded_at) FROM material_versions x
 WHERE x.material_id=NEW.material_id),(
 SELECT m.created_at FROM materials m WHERE m.id=NEW.material_id))
 THEN RAISE(ABORT,'物资版本登记时间不可倒序') END;
 SELECT CASE WHEN NEW.version_no>1 AND EXISTS(
 SELECT 1 FROM material_versions x WHERE x.material_id=NEW.material_id
 AND x.version_no=NEW.version_no-1
 AND x.name IS NEW.name AND x.model IS NEW.model

 AND x.specification IS NEW.specification AND x.category_id IS NEW.category_id
 AND x.status IS NEW.status AND x.note IS NEW.note)
 THEN RAISE(ABORT,'物资版本必须存在真实内容变化') END;
END;
CREATE TRIGGER material_version_immutable_update BEFORE UPDATE ON material_versions
BEGIN SELECT RAISE(ABORT,'物资主数据正式历史版本不可覆盖'); END;
CREATE TRIGGER material_version_immutable_delete BEFORE DELETE ON material_versions
BEGIN SELECT RAISE(ABORT,'物资主数据正式历史版本不可删除'); END;

-- Reverse lookup from a stable immutable master revision into exact usage
-- evidence (without materializing a separate master-usage summary).
CREATE INDEX idx_demand_material_catalog_version
 ON demand_material_version_items(material_version_id);
CREATE INDEX idx_approved_material_catalog_version
 ON project_approval_material_items(material_version_id);
CREATE INDEX idx_evidence_material_catalog_version
 ON evidence_links(material_version_id) WHERE material_version_id IS NOT NULL;

-- Immutable decision and request facts must not be retroactively changed.
-- Reassessment of a duplicate demand creates a NEW reviewed decision event;
-- the application selects the latest valid decision where appropriate.
CREATE TRIGGER duplicate_review_immutable_update BEFORE UPDATE ON demand_duplicate_reviews
BEGIN SELECT RAISE(ABORT,'疑似重复需求的人工审查决定不能覆盖；应新增有责任人和理由的复核记录'); END;
CREATE TRIGGER duplicate_review_immutable_delete BEFORE DELETE ON demand_duplicate_reviews
BEGIN SELECT RAISE(ABORT,'疑似重复需求的历史审查决定不可删除'); END;
CREATE TRIGGER ledger_request_immutable_update BEFORE UPDATE ON ledger_requests
BEGIN SELECT RAISE(ABORT,'幂等请求的原参数和返回结果不可在确认后覆盖'); END;
CREATE TRIGGER ledger_request_immutable_delete BEFORE DELETE ON ledger_requests
BEGIN SELECT RAISE(ABORT,'已有确认的请求幂等身份不可删除'); END;

-- Voltage classification codes and official descriptions are stable
-- identity data; status/order can be managed without relabeling history.
CREATE TRIGGER voltage_identity_immutable_update
 BEFORE UPDATE OF id,code,name ON voltage_levels
BEGIN SELECT RAISE(ABORT,'电压等级编码和名称属于稳定台账分类，不得无痕改写'); END;
CREATE TRIGGER voltage_identity_immutable_delete BEFORE DELETE ON voltage_levels
BEGIN SELECT RAISE(ABORT,'电压等级稳定身份不可删除'); END;


-- Round 16: authoritative per-location demand work, extracted atomically from
-- the exact immutable demand-version JSON. A root's legacy single locator is
-- ONLY original intake context; new versions use the complete work_locations
-- list and its typed immutable projection. There is NO independent mutable
-- location list and NO duplicated free-running total.
CREATE TABLE demand_version_work_locations (
 demand_id TEXT NOT NULL,
 demand_version INTEGER NOT NULL,
 item_no INTEGER NOT NULL CHECK(item_no>0),
 location_kind TEXT NOT NULL CHECK(
  location_kind IN ('logical_tower','physical_tower','span')),
 logical_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT,
 physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
 span_id TEXT REFERENCES line_spans(id) ON DELETE RESTRICT,
 span_version INTEGER,
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 work_mode TEXT NOT NULL DEFAULT 'unspecified'
  CHECK(work_mode IN ('outage','non_outage','unspecified')),
 site_features_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(site_features_json)
   AND json_type(site_features_json)='object'),
 location_snapshot_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(location_snapshot_json)
   AND json_type(location_snapshot_json)='object'),
 PRIMARY KEY(demand_id,demand_version,item_no),
 FOREIGN KEY(demand_id,demand_version)
  REFERENCES demand_versions(demand_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(span_id,span_version)
  REFERENCES line_span_history(span_id,version_no) ON DELETE RESTRICT,
 CHECK(
  (location_kind='logical_tower' AND logical_tower_id IS NOT NULL
   AND physical_tower_id IS NULL AND span_id IS NULL AND span_version IS NULL)
  OR (location_kind='physical_tower' AND physical_tower_id IS NOT NULL
   AND logical_tower_id IS NULL AND span_id IS NULL AND span_version IS NULL)
  OR (location_kind='span' AND span_id IS NOT NULL AND span_version>0
   AND logical_tower_id IS NULL AND physical_tower_id IS NULL))
) STRICT;
CREATE TRIGGER demand_version_work_locations_publish
 AFTER INSERT ON demand_versions
BEGIN
 SELECT CASE WHEN json_type(NEW.snapshot_json,'$.work_locations')<>'array'
  OR json_array_length(NEW.snapshot_json,'$.work_locations')=0
 THEN RAISE(ABORT,'需求正式版本必须包含完整的非空作业位置明细') END;
 INSERT INTO demand_version_work_locations(
  demand_id,demand_version,item_no,location_kind,logical_tower_id,
  physical_tower_id,span_id,span_version,quantity_scaled,work_mode,site_features_json,
  location_snapshot_json)
 SELECT NEW.demand_id,NEW.version,CAST(x.key AS INTEGER)+1,
   json_extract(x.value,'$.location_kind'),
   json_extract(x.value,'$.logical_tower_id'),
   json_extract(x.value,'$.physical_tower_id'),
   json_extract(x.value,'$.span_id'),
   json_extract(x.value,'$.span_version'),
   json_extract(x.value,'$.quantity_scaled'),
   COALESCE(json_extract(x.value,'$.work_mode'),'unspecified'),
   COALESCE(json_extract(x.value,'$.site_features_json'),'{}'),
   COALESCE(json_extract(x.value,'$.location_snapshot_json'),'{}')
 FROM json_each(NEW.snapshot_json,'$.work_locations') x;
 SELECT CASE WHEN
  (SELECT COALESCE(SUM(x.quantity_scaled),0)
   FROM demand_version_work_locations x
   WHERE x.demand_id=NEW.demand_id AND x.demand_version=NEW.version)
  <>NEW.quantity_scaled
 THEN RAISE(ABORT,'正式需求版本总工作量必须等于全部作业位置数量之和') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM demand_version_work_locations loc
  WHERE loc.demand_id=NEW.demand_id AND loc.demand_version=NEW.version
   AND ((NEW.work_target_type='physical'
      AND loc.location_kind<>'physical_tower')
   OR (NEW.work_target_type='line'
      AND loc.location_kind='physical_tower')))
 THEN RAISE(ABORT,'需求作业位置类型必须与操作类型设备定位方式一致') END;
END;
CREATE TRIGGER demand_work_location_immutable_insert
 BEFORE INSERT ON demand_version_work_locations
 -- Only the authoritative demand-version publish transaction may insert:
 -- enclosing AFTER INSERT trigger still has its immutable parent row.
 -- This extra check prevents fabricated cross-version identity and factors.
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM demand_versions dv
  JOIN json_each(dv.snapshot_json,'$.work_locations') x
  WHERE dv.demand_id=NEW.demand_id AND dv.version=NEW.demand_version
   AND CAST(x.key AS INTEGER)+1=NEW.item_no
   AND json_extract(x.value,'$.location_kind')=NEW.location_kind
   AND json_extract(x.value,'$.logical_tower_id') IS NEW.logical_tower_id
   AND json_extract(x.value,'$.physical_tower_id') IS NEW.physical_tower_id
   AND json_extract(x.value,'$.span_id') IS NEW.span_id
   AND json_extract(x.value,'$.span_version') IS NEW.span_version
   AND json_extract(x.value,'$.quantity_scaled')=NEW.quantity_scaled
   AND COALESCE(json_extract(x.value,'$.work_mode'),'unspecified')=NEW.work_mode
   AND COALESCE(json_extract(x.value,'$.site_features_json'),'{}')
       =NEW.site_features_json
   AND COALESCE(json_extract(x.value,'$.location_snapshot_json'),'{}')
       =NEW.location_snapshot_json
 ) THEN RAISE(ABORT,'需求逐位置明细只能从不可变正式需求版本完整快照原子投影，不得额外插入') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.site_features_json) feature
  LEFT JOIN dictionary_items def ON def.type_id='price_factor'
    AND def.code=feature.key
  LEFT JOIN dictionary_item_versions ver
    ON ver.item_id=def.id
    AND ver.version=json_extract(feature.value,'$.factor_version')
  WHERE def.id IS NULL OR ver.id IS NULL
    OR json_type(feature.value)<>'object'
    OR json_type(feature.value,'$.factor_version')<>'integer'
    OR json_type(feature.value,'$.value') IS NULL
    OR COALESCE(
      (json_extract(ver.fields_json,'$.kind')='enum'
       AND json_type(feature.value,'$.value')='text'
       AND length(trim(json_extract(feature.value,'$.value')))>0)
      OR (json_extract(ver.fields_json,'$.kind')='number'
       AND json_type(feature.value,'$.value')='integer'),0)=0
 ) THEN RAISE(ABORT,'需求现场价格特征必须引用有版本的标准特征字典和合法实际值') END;
END;
CREATE TRIGGER demand_work_location_immutable_update
 BEFORE UPDATE ON demand_version_work_locations
BEGIN SELECT RAISE(ABORT,'需求正式版本的逐位置工作量和现场特征不可覆盖'); END;
CREATE TRIGGER demand_work_location_immutable_delete
 BEFORE DELETE ON demand_version_work_locations
BEGIN SELECT RAISE(ABORT,'需求正式版本的逐位置工作量和现场特征不可删除'); END;

-- This is a legal scope-subdivision, NOT another demand root or execution.
-- A single approved demand can carry separate tower/span quantities, and
-- each approved scope header is merely the signed quantity checksum.
CREATE TABLE project_approval_work_locations (
 approval_scope_version_id TEXT NOT NULL
  REFERENCES project_approval_scope_versions(id) ON DELETE CASCADE,
 demand_id TEXT NOT NULL,
 demand_version INTEGER NOT NULL,
 location_item_no INTEGER NOT NULL CHECK(location_item_no>0),
 approved_quantity_scaled INTEGER NOT NULL CHECK(approved_quantity_scaled>0),
 PRIMARY KEY(approval_scope_version_id,location_item_no),
 FOREIGN KEY(demand_id,demand_version,location_item_no)
  REFERENCES demand_version_work_locations(demand_id,demand_version,item_no)
  ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER project_approval_single_location_seed
 AFTER INSERT ON project_approval_scope_versions
WHEN (SELECT COUNT(*) FROM demand_version_work_locations loc
 WHERE loc.demand_id=NEW.demand_id AND loc.demand_version=NEW.demand_version)=1
BEGIN
 INSERT INTO project_approval_work_locations(
  approval_scope_version_id,demand_id,demand_version,location_item_no,
  approved_quantity_scaled)
 SELECT NEW.id,NEW.demand_id,NEW.demand_version,loc.item_no,
  NEW.quantity_scaled
 FROM demand_version_work_locations loc
 WHERE loc.demand_id=NEW.demand_id AND loc.demand_version=NEW.demand_version;
END;
CREATE TRIGGER project_approval_location_guard
 BEFORE INSERT ON project_approval_work_locations
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM project_approval_scope_versions sc
  JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
  WHERE sc.id=NEW.approval_scope_version_id
    AND sc.demand_id=NEW.demand_id AND sc.demand_version=NEW.demand_version
    AND ap.status='draft')
 THEN RAISE(ABORT,'项目批准位置只能对应同一未批准范围及正式需求版本') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM project_approval_scope_prices chosen
  WHERE chosen.approval_scope_version_id=NEW.approval_scope_version_id)
 THEN RAISE(ABORT,'已选用的正式报价锁定项目逐位置数量；请先取消报价选择再调整草稿') END;
END;
CREATE TRIGGER project_approval_location_guard_update
 BEFORE UPDATE ON project_approval_work_locations
BEGIN SELECT RAISE(ABORT,'批准需求位置工作量不可原地改写；应调整草稿明细后重新插入'); END;
CREATE TRIGGER project_approval_location_guard_delete
 BEFORE DELETE ON project_approval_work_locations
 WHEN EXISTS(
  SELECT 1 FROM project_approval_scope_prices chosen
  WHERE chosen.approval_scope_version_id=OLD.approval_scope_version_id)
 OR EXISTS(
  SELECT 1 FROM project_approval_scope_versions sc
  JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
  WHERE sc.id=OLD.approval_scope_version_id AND ap.status='approved')
BEGIN SELECT RAISE(ABORT,'已批准或已完成正式计价的作业位置和工作量不可删除'); END;
CREATE TRIGGER project_approval_locations_finalize
 BEFORE UPDATE OF status ON project_approval_versions
 WHEN NEW.status='approved' AND OLD.status='draft'
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM project_approval_scope_versions sc
  WHERE sc.approval_version_id=NEW.id AND
    ((SELECT COALESCE(SUM(loc.approved_quantity_scaled),0)
      FROM project_approval_work_locations loc
      WHERE loc.approval_scope_version_id=sc.id)<>sc.quantity_scaled
     OR NOT EXISTS(
      SELECT 1 FROM project_approval_work_locations loc
      WHERE loc.approval_scope_version_id=sc.id))
 ) THEN RAISE(ABORT,'正式项目批准需求的逐位置工作量必须完整且与批准数量一致') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM project_approval_scope_versions sc
  JOIN project_approval_work_locations loc
   ON loc.approval_scope_version_id=sc.id
  WHERE sc.approval_version_id=NEW.id
    AND (loc.demand_id<>sc.demand_id OR loc.demand_version<>sc.demand_version))
 THEN RAISE(ABORT,'批准位置不得引用已在草稿中更换的其他需求版本') END;
END;

-- Round 16: operation feature declarations are a versioned operation rule,
-- not price values. The same dictionary_item_version must appear in actual
-- demand site facts and price applicability predicates.
CREATE TRIGGER operation_pricing_feature_definition_guard
 BEFORE INSERT ON operation_versions
BEGIN
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM json_each(NEW.pricing_features_json) x
 LEFT JOIN dictionary_items f ON f.id=json_extract(x.value,'$.factor_id')
  AND f.type_id='price_factor'
 LEFT JOIN dictionary_item_versions fv ON fv.item_id=f.id
  AND fv.version=json_extract(x.value,'$.factor_version')
 WHERE json_type(x.value)<>'object'
 OR json_type(x.value,'$.factor_id')<>'text'
 OR json_type(x.value,'$.factor_version')<>'integer'
 OR json_type(x.value,'$.required') NOT IN ('true','false')
 OR json_type(x.value,'$.source')<>'text'
 OR json_extract(x.value,'$.source') NOT IN ('asset','manual','either')
 OR f.id IS NULL OR fv.id IS NULL
 OR fv.status<>'active' OR fv.changed_at>NEW.changed_at
 ) THEN RAISE(ABORT,'操作特征声明须引用有效正式价格特征字典、来源和必填规则') END;
 SELECT CASE WHEN EXISTS(
  SELECT json_extract(x.value,'$.factor_id') factor_id
  FROM json_each(NEW.pricing_features_json) x
  GROUP BY factor_id HAVING COUNT(*)>1)
 THEN RAISE(ABORT,'同一操作版本不能重复声明相同作业特征') END;
END;

-- Calculate in the application using decimal cents and scaled quantity.
-- SQL rejects malformed or contradictory published parameters and fee lists.
CREATE TRIGGER reference_price_formula_guard
 BEFORE INSERT ON reference_price_versions
BEGIN
 SELECT CASE WHEN
  (NEW.pricing_mode IN ('fixed','progressive_bracket','group','rate','composite')
    AND NEW.base_fee_fen<>0)
  OR (NEW.pricing_mode IN ('progressive_bracket','group','rate','composite')
    AND NEW.unit_price_fen<>0)
  OR (NEW.pricing_mode='composite' AND json_array_length(NEW.fee_components_json)=0)
  OR (NEW.pricing_mode<>'composite' AND json_array_length(NEW.fee_components_json)<>0)
 THEN RAISE(ABORT,'参考价计价模式与基础费、数量费或费用组合明细冲突') END;
 SELECT CASE WHEN (json_type(NEW.calculation_params_json,'$.min_amount_fen')
    IS NOT NULL AND json_type(NEW.calculation_params_json,'$.min_amount_fen')<>'integer')
  OR (json_type(NEW.calculation_params_json,'$.max_amount_fen')
    IS NOT NULL AND json_type(NEW.calculation_params_json,'$.max_amount_fen')<>'integer')
  OR COALESCE(json_extract(NEW.calculation_params_json,'$.min_amount_fen'),0)<0
  OR COALESCE(json_extract(NEW.calculation_params_json,'$.max_amount_fen'),0)<0
  OR (json_type(NEW.calculation_params_json,'$.max_amount_fen')='integer'
  AND json_extract(NEW.calculation_params_json,'$.min_amount_fen')>
      json_extract(NEW.calculation_params_json,'$.max_amount_fen'))
 THEN RAISE(ABORT,'参考价最低收费和最高封顶须为非负金额且区间合法') END;
 SELECT CASE WHEN NEW.pricing_mode='group' AND (
  json_type(NEW.calculation_params_json,'$.group_size_scaled')<>'integer'
  OR json_extract(NEW.calculation_params_json,'$.group_size_scaled')<=0
  OR json_type(NEW.calculation_params_json,'$.group_fee_fen')<>'integer'
  OR json_extract(NEW.calculation_params_json,'$.group_fee_fen')<0)
 THEN RAISE(ABORT,'成组计价需要有效的每组数量及收费金额') END;
 SELECT CASE WHEN NEW.pricing_mode='rate' AND (
  json_type(NEW.calculation_params_json,'$.rate_basis_points')<>'integer'
  OR json_extract(NEW.calculation_params_json,'$.rate_basis_points')<0
  OR json_extract(NEW.calculation_params_json,'$.rate_basis_points')>10000
  OR COALESCE(json_type(NEW.calculation_params_json,'$.rate_basis'),'missing')<>'text'
  OR COALESCE(json_extract(NEW.calculation_params_json,'$.rate_basis'),'missing')
     NOT IN ('labor','materials','machinery','approved_subtotal')
  OR (json_extract(NEW.calculation_params_json,'$.rate_basis')='approved_subtotal'
      AND NEW.pricing_scope='work_location'))
 THEN RAISE(ABORT,'费率计价必须给出合法费率及明确计费基数') END;
 SELECT CASE WHEN NEW.pricing_mode='progressive_bracket'
 AND (json_type(NEW.calculation_params_json,'$.tiers')<>'array'
   OR json_array_length(NEW.calculation_params_json,'$.tiers')=0
   OR EXISTS(
     SELECT 1 FROM json_each(NEW.calculation_params_json,'$.tiers') x
     WHERE json_type(x.value)<>'object'
      OR json_type(x.value,'$.unit_price_fen')<>'integer'
      OR json_extract(x.value,'$.unit_price_fen')<0
      OR json_type(x.value,'$.up_to_quantity_scaled') NOT IN ('integer','null')
      OR (json_type(x.value,'$.up_to_quantity_scaled')='integer'
         AND json_extract(x.value,'$.up_to_quantity_scaled')<=0))
   OR EXISTS(
     SELECT 1 FROM json_each(NEW.calculation_params_json,'$.tiers') a
     JOIN json_each(NEW.calculation_params_json,'$.tiers') b
      ON CAST(a.key AS INTEGER)<CAST(b.key AS INTEGER)
     WHERE json_type(a.value,'$.up_to_quantity_scaled')='null'
      OR (json_type(b.value,'$.up_to_quantity_scaled')='integer'
        AND json_extract(a.value,'$.up_to_quantity_scaled')>=
            json_extract(b.value,'$.up_to_quantity_scaled'))))
 THEN RAISE(ABORT,'累进计价必须采用依次升高的边际数量阈值，最终可开放上限') END;
 SELECT CASE WHEN NEW.pricing_mode='composite' AND (
  EXISTS(
   SELECT 1 FROM json_each(NEW.fee_components_json) comp
   WHERE json_type(comp.value)<>'object'
    OR json_type(comp.value,'$.coverage_key')<>'text'
    OR length(trim(json_extract(comp.value,'$.coverage_key'))) =0
    OR json_extract(comp.value,'$.formula_mode')
      NOT IN ('fixed','per_unit','base_plus_unit','quantity_bracket',
              'progressive_bracket','group','rate')
    OR json_type(comp.value,'$.parameters')<>'object')
  OR EXISTS(
   SELECT 1 FROM json_each(NEW.fee_components_json) comp
   WHERE
    (json_extract(comp.value,'$.formula_mode') IN ('fixed','per_unit')
     AND (json_type(comp.value,'$.parameters.unit_price_fen')<>'integer'
       OR json_extract(comp.value,'$.parameters.unit_price_fen')<0))
    OR (json_extract(comp.value,'$.formula_mode')='base_plus_unit'
     AND (json_type(comp.value,'$.parameters.unit_price_fen')<>'integer'
       OR json_type(comp.value,'$.parameters.base_fee_fen')<>'integer'
       OR json_extract(comp.value,'$.parameters.unit_price_fen')<0
       OR json_extract(comp.value,'$.parameters.base_fee_fen')<0))
    OR (json_extract(comp.value,'$.formula_mode')='group'
     AND (json_type(comp.value,'$.parameters.group_size_scaled')<>'integer'
       OR json_type(comp.value,'$.parameters.group_fee_fen')<>'integer'
       OR json_extract(comp.value,'$.parameters.group_size_scaled')<=0
       OR json_extract(comp.value,'$.parameters.group_fee_fen')<0))
    OR (json_extract(comp.value,'$.formula_mode')='quantity_bracket'
     AND (json_type(comp.value,'$.parameters.brackets')<>'array'
       OR json_array_length(comp.value,'$.parameters.brackets')=0))
    OR (json_extract(comp.value,'$.formula_mode')='progressive_bracket'
     AND (json_type(comp.value,'$.parameters.tiers')<>'array'
       OR json_array_length(comp.value,'$.parameters.tiers')=0))
    OR (json_extract(comp.value,'$.formula_mode')='rate'
     AND (json_type(comp.value,'$.parameters.rate_basis_points')<>'integer'
       OR json_type(comp.value,'$.parameters.rate_basis')<>'text'
       OR json_extract(comp.value,'$.parameters.rate_basis_points')<0
       OR json_extract(comp.value,'$.parameters.rate_basis_points')>10000))
  )
  OR EXISTS(
   SELECT 1 FROM json_each(NEW.fee_components_json) comp
   GROUP BY json_extract(comp.value,'$.coverage_key')
   HAVING COUNT(*)>1))
 THEN RAISE(ABORT,'组合参考价的费用覆盖编码必须唯一且每项须有合法公式及参数') END;
END;

-- A reference-price evaluation belongs either to an entire immutable demand
-- version (standalone preview/formal demand quote), or to a specific approved
-- PROJECT SCOPE VERSION (the latter can have partial quantities per location).
-- No snapshot of "current total" on a mutable demand, scope or project root.
CREATE TABLE reference_price_evaluations (
 id TEXT NOT NULL PRIMARY KEY,
 demand_id TEXT NOT NULL,
 demand_version INTEGER NOT NULL CHECK(demand_version>0),
 approval_scope_version_id TEXT
  REFERENCES project_approval_scope_versions(id) ON DELETE RESTRICT,
 pricing_date TEXT NOT NULL CHECK(length(pricing_date)=10 AND
  COALESCE(strftime('%Y-%m-%d',julianday(pricing_date))=pricing_date,0)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
 engine_version TEXT NOT NULL CHECK(length(trim(engine_version))>0),
 input_basis_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(input_basis_json)
   AND json_type(input_basis_json)='object'),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(length(created_at)=24
  AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)),
 finalized_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 finalized_at TEXT CHECK(finalized_at IS NULL OR
  (length(finalized_at)=24 AND
   COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(finalized_at))=finalized_at,0))),
 FOREIGN KEY(demand_id,demand_version)
  REFERENCES demand_versions(demand_id,version) ON DELETE RESTRICT,
 CHECK((status='draft' AND finalized_by IS NULL AND finalized_at IS NULL)
    OR (status='final' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL))
) STRICT;

-- Each whole price RULE may have several fee components within its immutable
-- version. Each evaluated location + coverage_key is unique, preventing
-- accidental double inclusion of labor/materials/transport in one quote.
-- A fee amount is always a factual result of application-side arithmetic;
-- no executable formula, tax engine or project report is hidden in SQLite.
CREATE TABLE reference_price_evaluation_lines (
 id TEXT NOT NULL PRIMARY KEY,
 evaluation_id TEXT NOT NULL
  REFERENCES reference_price_evaluations(id) ON DELETE CASCADE,
 location_item_no INTEGER NOT NULL CHECK(location_item_no>0),
 coverage_key TEXT NOT NULL CHECK(length(trim(coverage_key))>0),
 reference_price_version_id TEXT NOT NULL
  REFERENCES reference_price_versions(id) ON DELETE RESTRICT,
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled>0),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
 calculation_inputs_json TEXT NOT NULL
  CHECK(json_valid(calculation_inputs_json)
    AND json_type(calculation_inputs_json)='object'),
 calculation_trace_json TEXT NOT NULL
  CHECK(json_valid(calculation_trace_json)
    AND json_type(calculation_trace_json)='object'),
 UNIQUE(evaluation_id,location_item_no,coverage_key)
) STRICT;
CREATE TRIGGER reference_price_evaluation_insert_guard
 BEFORE INSERT ON reference_price_evaluations
BEGIN
 SELECT CASE WHEN NEW.approval_scope_version_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM project_approval_scope_versions sc
  JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
  WHERE sc.id=NEW.approval_scope_version_id
   AND sc.demand_id=NEW.demand_id
   AND sc.demand_version=NEW.demand_version
   AND ap.status='draft')
 THEN RAISE(ABORT,'项目价格核算必须对应同一未批准项目范围及真实需求版本') END;
 SELECT CASE WHEN NEW.status<>'draft'
 THEN RAISE(ABORT,'新建价格核算只能从草稿开始，逐位置核算完整后才能正式确认') END;
END;
CREATE TRIGGER reference_price_evaluation_line_guard
 BEFORE INSERT ON reference_price_evaluation_lines
BEGIN
 -- One comprehensive fee (main) is exclusive with narrower fee classes.
 -- A composite price rule can contain many INTERNAL distinct coverage parts,
 -- but it is represented as one comprehensive output line per location.
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM reference_price_evaluation_lines old
  WHERE old.evaluation_id=NEW.evaluation_id
   AND old.location_item_no=NEW.location_item_no
   AND (old.coverage_key='main' OR NEW.coverage_key='main'))
 THEN RAISE(ABORT,'综合参考价与分项费用不得在同一作业位置叠加重复计价') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reference_price_evaluations ev
  JOIN demand_versions dv ON dv.demand_id=ev.demand_id AND dv.version=ev.demand_version
  JOIN demand_version_work_locations loc
   ON loc.demand_id=ev.demand_id AND loc.demand_version=ev.demand_version
    AND loc.item_no=NEW.location_item_no
  JOIN reference_price_versions pr ON pr.id=NEW.reference_price_version_id
   AND pr.operation_id=dv.operation_id
   AND pr.operation_version=dv.operation_version
   AND pr.unit_id=dv.unit_id AND pr.unit_version=dv.unit_version
   AND pr.status='active' AND pr.pricing_scope='work_location'
   AND (pr.work_mode='both' OR pr.work_mode=loc.work_mode)
   AND pr.effective_on<=ev.pricing_date AND pr.created_at<=ev.created_at
  WHERE ev.id=NEW.evaluation_id AND ev.status='draft'
   AND (ev.approval_scope_version_id IS NULL OR EXISTS(
     SELECT 1 FROM project_approval_work_locations approved
     JOIN project_approval_scope_versions sc
      ON sc.id=approved.approval_scope_version_id
     JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
      AND ap.status='draft'
     WHERE approved.approval_scope_version_id=ev.approval_scope_version_id
       AND approved.location_item_no=NEW.location_item_no))
   AND NEW.quantity_scaled=COALESCE(
    (SELECT approved.approved_quantity_scaled
     FROM project_approval_work_locations approved
     WHERE approved.approval_scope_version_id=ev.approval_scope_version_id
       AND approved.location_item_no=NEW.location_item_no),
     loc.quantity_scaled))
 THEN RAISE(ABORT,'参考价逐位置结果必须匹配正式操作版本、适用日期、计量单位和当次需求工作量') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM reference_price_evaluations ev
 JOIN demand_versions dv ON dv.demand_id=ev.demand_id
  AND dv.version=ev.demand_version
 JOIN operation_versions ov ON ov.operation_id=dv.operation_id
  AND ov.version=dv.operation_version
 JOIN reference_price_versions pr ON pr.id=NEW.reference_price_version_id
 JOIN json_each(pr.additional_conditions_json) condition
 WHERE ev.id=NEW.evaluation_id AND NOT EXISTS(
  SELECT 1 FROM json_each(ov.pricing_features_json) declared
  JOIN dictionary_items factor ON factor.id=json_extract(declared.value,'$.factor_id')
  WHERE factor.code=condition.key
    AND json_extract(declared.value,'$.factor_version')=
        json_extract(condition.value,'$.factor_version'))
 ) THEN RAISE(ABORT,'使用的价格适用因素必须由同版操作类型正式声明') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM reference_price_evaluations ev
 JOIN demand_versions dv ON dv.demand_id=ev.demand_id
  AND dv.version=ev.demand_version
 JOIN operation_versions ov ON ov.operation_id=dv.operation_id
  AND ov.version=dv.operation_version
 JOIN demand_version_work_locations loc ON loc.demand_id=ev.demand_id
  AND loc.demand_version=ev.demand_version AND loc.item_no=NEW.location_item_no
 JOIN json_each(ov.pricing_features_json) declared
 JOIN dictionary_items factor ON factor.id=json_extract(declared.value,'$.factor_id')
 WHERE ev.id=NEW.evaluation_id
  AND json_extract(declared.value,'$.required')=1
  AND NOT EXISTS(
   SELECT 1 FROM json_each(loc.site_features_json) actual
   WHERE actual.key=factor.code
    AND json_extract(actual.value,'$.factor_version')=
        json_extract(declared.value,'$.factor_version'))
 ) THEN RAISE(ABORT,'需求作业位置未完整提供操作类型要求的正式价格特征') END;
END;
CREATE TRIGGER reference_price_evaluation_line_immutable_update
 BEFORE UPDATE ON reference_price_evaluation_lines
BEGIN SELECT RAISE(ABORT,'参考价计算明细不允许覆盖，请替换草稿明细或重新正式计价'); END;
CREATE TRIGGER reference_price_evaluation_line_guard_delete
 BEFORE DELETE ON reference_price_evaluation_lines
WHEN EXISTS(
 SELECT 1 FROM reference_price_evaluations ev
 WHERE ev.id=OLD.evaluation_id AND ev.status='final')
BEGIN SELECT RAISE(ABORT,'正式参考价计算明细不可删除'); END;
CREATE TRIGGER reference_price_evaluation_finalize_guard
 BEFORE UPDATE OF status ON reference_price_evaluations
 WHEN NEW.status='final' AND OLD.status='draft'
BEGIN
 SELECT CASE WHEN NEW.demand_id IS NOT OLD.demand_id
  OR NEW.demand_version IS NOT OLD.demand_version
  OR NEW.approval_scope_version_id IS NOT OLD.approval_scope_version_id
  OR NEW.pricing_date IS NOT OLD.pricing_date
  OR NEW.engine_version IS NOT OLD.engine_version
  OR NEW.input_basis_json IS NOT OLD.input_basis_json
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
 THEN RAISE(ABORT,'参考价确认时不可暗改需求、项目范围或报价输入依据') END;
 SELECT CASE WHEN NEW.finalized_at<NEW.created_at
 THEN RAISE(ABORT,'正式参考价确认时间不得早于计价创建时间') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM reference_price_evaluation_lines l
  WHERE l.evaluation_id=NEW.id)
 THEN RAISE(ABORT,'无计价规则或未计价需求不得虚构零元完整参考价') END;
 SELECT CASE WHEN NEW.approval_scope_version_id IS NULL AND EXISTS(
  SELECT 1 FROM demand_version_work_locations loc
  WHERE loc.demand_id=NEW.demand_id AND loc.demand_version=NEW.demand_version
   AND NOT EXISTS(
     SELECT 1 FROM reference_price_evaluation_lines l
     WHERE l.evaluation_id=NEW.id AND l.location_item_no=loc.item_no))
 THEN RAISE(ABORT,'需求参考价必须覆盖全部正式作业位置') END;
 SELECT CASE WHEN NEW.approval_scope_version_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM project_approval_work_locations loc
  WHERE loc.approval_scope_version_id=NEW.approval_scope_version_id
   AND NOT EXISTS(
    SELECT 1 FROM reference_price_evaluation_lines l
    WHERE l.evaluation_id=NEW.id AND l.location_item_no=loc.location_item_no))
 THEN RAISE(ABORT,'项目承接参考价必须覆盖本次批准的全部作业位置') END;
 SELECT CASE WHEN NEW.approval_scope_version_id IS NOT NULL AND
 (SELECT status FROM project_approval_versions ap
 JOIN project_approval_scope_versions sc ON sc.approval_version_id=ap.id
 WHERE sc.id=NEW.approval_scope_version_id)<>'draft'
 THEN RAISE(ABORT,'已批准项目不能追加新的草稿计价结果') END;
END;
CREATE TRIGGER reference_price_evaluation_immutable_update
 BEFORE UPDATE ON reference_price_evaluations
 WHEN OLD.status='final'
  OR NEW.status<>'final' OR OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'已正式确认的参考价历史不可修改；草稿只能正式确认'); END;
CREATE TRIGGER reference_price_evaluation_immutable_delete
 BEFORE DELETE ON reference_price_evaluations
 WHEN OLD.status='final'
BEGIN SELECT RAISE(ABORT,'正式参考价计算结果历史不可删除'); END;

-- Approval scope chooses one finalized evaluation, or none (UNPRICED).
-- No associated quote is never the same as a quoted zero-fen amount.
CREATE TABLE project_approval_scope_prices (
 approval_scope_version_id TEXT NOT NULL PRIMARY KEY
  REFERENCES project_approval_scope_versions(id) ON DELETE CASCADE,
 evaluation_id TEXT NOT NULL UNIQUE
  REFERENCES reference_price_evaluations(id) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER project_approval_scope_price_guard
 BEFORE INSERT ON project_approval_scope_prices
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM project_approval_scope_versions sc
  JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
  JOIN reference_price_evaluations ev ON ev.id=NEW.evaluation_id
  WHERE sc.id=NEW.approval_scope_version_id
   AND sc.id=ev.approval_scope_version_id
   AND sc.demand_id=ev.demand_id AND sc.demand_version=ev.demand_version
   AND ev.status='final' AND ap.status='draft')
 THEN RAISE(ABORT,'批准参考价只可引用同一正式需求范围已确认且不可变的计价结果') END;
END;
CREATE TRIGGER project_approval_scope_price_immutable_update
 BEFORE UPDATE ON project_approval_scope_prices
BEGIN SELECT RAISE(ABORT,'批准范围计价依据不可改写；草稿须撤回选择后重新关联'); END;
CREATE TRIGGER project_approval_scope_price_guard_delete
 BEFORE DELETE ON project_approval_scope_prices
 WHEN EXISTS(
 SELECT 1 FROM project_approval_scope_versions sc
 JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
 WHERE sc.id=OLD.approval_scope_version_id AND ap.status='approved')
BEGIN SELECT RAISE(ABORT,'已批准项目的正式参考价依据不可删除'); END;

-- A FINAL quote is immutable, but the surrounding approval draft may have
-- been changed since it was priced. On approval re-check exact location IDs,
-- quantities, demand version and the selected result; a stale quote is NOT an
-- approved price. Unpriced scope is allowed but must remain explicitly NULL.
CREATE TRIGGER project_approval_reference_freshness_finalize
 BEFORE UPDATE OF status ON project_approval_versions
 WHEN NEW.status='approved' AND OLD.status='draft'
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM project_approval_scope_prices chosen
  JOIN project_approval_scope_versions sc
   ON sc.id=chosen.approval_scope_version_id
  JOIN reference_price_evaluations ev ON ev.id=chosen.evaluation_id
  WHERE sc.approval_version_id=NEW.id
   AND (ev.status<>'final' OR ev.approval_scope_version_id<>sc.id
    OR ev.demand_id<>sc.demand_id OR ev.demand_version<>sc.demand_version
    OR EXISTS(
      SELECT 1 FROM project_approval_work_locations loc
      WHERE loc.approval_scope_version_id=sc.id
       AND NOT EXISTS(
        SELECT 1 FROM reference_price_evaluation_lines priced
        WHERE priced.evaluation_id=ev.id
          AND priced.location_item_no=loc.location_item_no
          AND priced.quantity_scaled=loc.approved_quantity_scaled))
    OR EXISTS(
      SELECT 1 FROM reference_price_evaluation_lines priced
      WHERE priced.evaluation_id=ev.id AND NOT EXISTS(
        SELECT 1 FROM project_approval_work_locations loc
        WHERE loc.approval_scope_version_id=sc.id
          AND loc.location_item_no=priced.location_item_no
          AND loc.approved_quantity_scaled=priced.quantity_scaled))))
 THEN RAISE(ABORT,'本次项目需求范围已调整，选用的正式参考价过期，请重新核价') END;
END;

-- Independent charges applying ONCE to the approved project or a declared
-- work batch. They cannot be hidden under every demand to inflate the sum.
CREATE TABLE project_reference_price_charges (
 id TEXT NOT NULL PRIMARY KEY,
 approval_version_id TEXT NOT NULL
  REFERENCES project_approval_versions(id) ON DELETE RESTRICT,
 reference_price_version_id TEXT NOT NULL
  REFERENCES reference_price_versions(id) ON DELETE RESTRICT,
 charge_scope_key TEXT NOT NULL CHECK(length(trim(charge_scope_key))>0),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
 pricing_inputs_json TEXT NOT NULL CHECK(json_valid(pricing_inputs_json)
  AND json_type(pricing_inputs_json)='object'),
 calculation_trace_json TEXT NOT NULL CHECK(json_valid(calculation_trace_json)
  AND json_type(calculation_trace_json)='object'),
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL CHECK(length(created_at)=24
 AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ',julianday(created_at))=created_at,0)),
 UNIQUE(approval_version_id,charge_scope_key)
) STRICT;
CREATE TRIGGER project_reference_price_charge_guard
 BEFORE INSERT ON project_reference_price_charges
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM project_approval_versions ap
  JOIN reference_price_versions pr ON pr.id=NEW.reference_price_version_id
  WHERE ap.id=NEW.approval_version_id AND ap.status='draft'
   AND pr.status='active'
   AND pr.pricing_scope IN ('work_batch','project')
   AND pr.created_at<=NEW.created_at)
 THEN RAISE(ABORT,'项目独立参考价费用必须对应未批准项目及适用批次或项目作用域价格') END;
END;
CREATE TRIGGER project_reference_price_charge_immutable_update
 BEFORE UPDATE ON project_reference_price_charges
BEGIN SELECT RAISE(ABORT,'项目独立参考费用计算事实不可覆盖'); END;
CREATE TRIGGER project_reference_price_charge_guard_delete
 BEFORE DELETE ON project_reference_price_charges
 WHEN EXISTS(SELECT 1 FROM project_approval_versions ap
  WHERE ap.id=OLD.approval_version_id AND ap.status='approved')
BEGIN SELECT RAISE(ABORT,'已批准项目独立参考费用不得删除'); END;

-- Non-aggregated fact projections only. Application MUST compute the total,
-- null/unpriced status, per-demand fees and project-level charge composition;
-- these are NOT financial budgets or settlement fees.
CREATE VIEW v_demand_reference_quote_current AS
SELECT ev.* FROM reference_price_evaluations ev
JOIN v_demand_current d ON d.id=ev.demand_id
 AND d.current_version=ev.demand_version
WHERE ev.approval_scope_version_id IS NULL AND ev.status='final'
 AND ev.id=(
  SELECT x.id FROM reference_price_evaluations x
  WHERE x.demand_id=ev.demand_id AND x.demand_version=ev.demand_version
    AND x.approval_scope_version_id IS NULL AND x.status='final'
  ORDER BY x.finalized_at DESC,x.id DESC LIMIT 1);

CREATE VIEW v_project_approval_reference_basis_current AS
SELECT sc.approval_version_id,sc.id AS approval_scope_version_id,
 sc.project_scope_id,sc.demand_id,sc.demand_version,
 choice.evaluation_id,ev.engine_version,ev.pricing_date
FROM v_approval_scope_current sc
LEFT JOIN project_approval_scope_prices choice
 ON choice.approval_scope_version_id=sc.id
LEFT JOIN reference_price_evaluations ev ON ev.id=choice.evaluation_id;

CREATE INDEX idx_ref_evaluation_demand_version
 ON reference_price_evaluations(demand_id,demand_version,finalized_at);

-- One site per physical tower / logical tower / span within one immutable
-- work-operation demand version. Duplicate entries would collect its
-- one-location base charge multiple times.
CREATE UNIQUE INDEX uq_demand_location_physical
 ON demand_version_work_locations(demand_id,demand_version,physical_tower_id)
 WHERE physical_tower_id IS NOT NULL;
CREATE UNIQUE INDEX uq_demand_location_logical
 ON demand_version_work_locations(demand_id,demand_version,logical_tower_id)
 WHERE logical_tower_id IS NOT NULL;
CREATE UNIQUE INDEX uq_demand_location_span
 ON demand_version_work_locations(demand_id,demand_version,span_id)
 WHERE span_id IS NOT NULL;
