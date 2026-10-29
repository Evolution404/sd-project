-- Strict ownership: framework -> agreement -> single project; stock and approval share project identity.
CREATE TABLE frameworks (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
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
CREATE INDEX idx_agreement_framework ON agreements(framework_id);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 agreement_id TEXT REFERENCES agreements(id) ON DELETE RESTRICT,
 category_id TEXT REFERENCES dictionary_items(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'reserve' CHECK(status IN ('reserve','stocked','approved','closed')),
 version INTEGER NOT NULL DEFAULT 1,
 estimate_fen INTEGER, approved_budget_fen INTEGER,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(estimate_fen IS NULL OR estimate_fen>=0),
 CHECK(approved_budget_fen IS NULL OR approved_budget_fen>=0),
 CHECK(status NOT IN ('approved','closed') OR agreement_id IS NOT NULL)
);
CREATE INDEX idx_projects_agreement ON projects(agreement_id,status);
CREATE TABLE project_demand_scopes (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 demand_version INTEGER NOT NULL CHECK(demand_version>0),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_price_fen INTEGER CHECK(unit_price_fen>=0),
 price_source TEXT,
 price_date TEXT,
 tax_mode TEXT CHECK(tax_mode IN ('inclusive','exclusive','none')),
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,demand_id)
);
CREATE INDEX idx_project_scope_demand ON project_demand_scopes(demand_id);
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
