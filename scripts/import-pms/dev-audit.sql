-- DEVELOPMENT-ONLY PMS importer audit tables; not part of the product database schema.
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
