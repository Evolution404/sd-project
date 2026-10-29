-- Line-first ledgers. Existing identifiers and historical references are preserved.
ALTER TABLE transmission_lines ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'main' CHECK(line_kind IN ('main','branch'));
ALTER TABLE transmission_lines ADD COLUMN parent_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT;
ALTER TABLE transmission_lines ADD COLUMN junction_tower_id TEXT REFERENCES logical_towers(id) ON DELETE RESTRICT;
ALTER TABLE transmission_lines ADD COLUMN setup_status TEXT NOT NULL DEFAULT 'ready' CHECK(setup_status IN ('draft','ready'));
ALTER TABLE transmission_lines ADD COLUMN team TEXT NOT NULL DEFAULT '';
ALTER TABLE transmission_lines ADD COLUMN erection_type TEXT NOT NULL DEFAULT '';
ALTER TABLE transmission_lines ADD COLUMN start_label TEXT NOT NULL DEFAULT '';
ALTER TABLE transmission_lines ADD COLUMN end_label TEXT NOT NULL DEFAULT '';
ALTER TABLE physical_towers ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE physical_towers ADD COLUMN height_scaled INTEGER CHECK(height_scaled IS NULL OR height_scaled>0);
ALTER TABLE physical_towers ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_line_parent ON transmission_lines(parent_line_id);
CREATE TABLE line_spans (
 id TEXT PRIMARY KEY,
 line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
 start_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 end_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
 length_scaled INTEGER CHECK(length_scaled IS NULL OR length_scaled>0),
 status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(start_tower_id<>end_tower_id),CHECK(status<>'active' OR length_scaled IS NOT NULL)
);
CREATE UNIQUE INDEX uq_current_span_pair ON line_spans(line_id,min(start_tower_id,end_tower_id),max(start_tower_id,end_tower_id)) WHERE status<>'retired';
CREATE INDEX idx_span_end ON line_spans(end_tower_id);
CREATE INDEX idx_span_start ON line_spans(start_tower_id);
ALTER TABLE demands ADD COLUMN location_kind TEXT NOT NULL DEFAULT 'tower' CHECK(location_kind IN ('tower','span'));
ALTER TABLE demands ADD COLUMN location_line_id TEXT REFERENCES transmission_lines(id) ON DELETE RESTRICT;
ALTER TABLE demands ADD COLUMN span_id TEXT REFERENCES line_spans(id) ON DELETE RESTRICT;
ALTER TABLE demands ADD COLUMN span_version INTEGER;
ALTER TABLE demands ADD COLUMN span_snapshot_json TEXT;
UPDATE demands SET location_line_id=(SELECT line_id FROM logical_towers WHERE id=demands.logical_tower_id);
CREATE INDEX idx_demand_location_line ON demands(location_line_id);
CREATE INDEX idx_demand_span ON demands(span_id);
CREATE TABLE ledger_requests (
 request_key TEXT PRIMARY KEY,actor_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO dictionary_types(id,title) VALUES ('team','运维班组'),('erection','架设方式'),('tower_structure','杆塔结构类型'),('tower_purpose','杆塔用途');
CREATE TRIGGER valid_branch_insert BEFORE INSERT ON transmission_lines BEGIN
 SELECT CASE WHEN NEW.line_kind='main' AND (NEW.parent_line_id IS NOT NULL OR NEW.junction_tower_id IS NOT NULL) THEN RAISE(ABORT,'主线不能设置上级线路或接入杆塔') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NOT EXISTS(SELECT 1 FROM transmission_lines WHERE id=NEW.parent_line_id AND line_kind='main') THEN RAISE(ABORT,'支线必须归属主线') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NEW.status='active' AND NEW.setup_status='ready' AND NOT EXISTS(SELECT 1 FROM logical_towers WHERE id=NEW.junction_tower_id AND line_id=NEW.parent_line_id AND status='active') THEN RAISE(ABORT,'支线接入杆塔无效') END;
END;
CREATE TRIGGER valid_branch_update BEFORE UPDATE ON transmission_lines BEGIN
 SELECT CASE WHEN NEW.line_kind='main' AND (NEW.parent_line_id IS NOT NULL OR NEW.junction_tower_id IS NOT NULL) THEN RAISE(ABORT,'主线不能设置上级线路或接入杆塔') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NOT EXISTS(SELECT 1 FROM transmission_lines WHERE id=NEW.parent_line_id AND line_kind='main' AND id<>NEW.id) THEN RAISE(ABORT,'支线必须归属主线') END;
 SELECT CASE WHEN NEW.line_kind='branch' AND NEW.status='active' AND NEW.setup_status='ready' AND NOT EXISTS(SELECT 1 FROM logical_towers WHERE id=NEW.junction_tower_id AND line_id=NEW.parent_line_id AND status='active') THEN RAISE(ABORT,'支线接入杆塔无效') END;
END;
