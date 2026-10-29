-- Independent initial reserve estimate. Never overwrite approved execution facts.
ALTER TABLE projects ADD COLUMN preliminary_estimate_fen INTEGER
 CHECK(preliminary_estimate_fen IS NULL OR preliminary_estimate_fen>0);
ALTER TABLE projects ADD COLUMN preliminary_estimate_basis TEXT;
ALTER TABLE projects ADD COLUMN preliminary_estimate_at TEXT;
ALTER TABLE projects ADD COLUMN preliminary_estimate_by TEXT REFERENCES users(id);

-- Project reserve classification is not the same dictionary as demand category.
INSERT OR IGNORE INTO dictionary_types(id,title) VALUES ('project_category','项目类别');
