-- Canonical database V2 view definitions. Do not edit any generated runtime database.

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

CREATE VIEW effective_settlement_entries AS SELECT * FROM settlement_current WHERE status='active';

CREATE VIEW plan_budget_current AS SELECT v.* FROM plan_budget_versions v
 WHERE v.version_no=(SELECT MAX(h.version_no) FROM plan_budget_versions h WHERE h.execution_id=v.execution_id);

CREATE VIEW completion_current AS
SELECT c.id,c.execution_item_id,c.confirmed_by,c.confirmed_at,c.idempotency_key,c.payload_hash,
 COALESCE(r.version,1) AS version,COALESCE(r.status,'active') AS status,
 COALESCE(r.quantity_scaled,c.quantity_scaled) AS quantity_scaled,
 COALESCE(r.occurred_on,c.occurred_on) AS occurred_on,COALESCE(r.evidence,c.evidence) AS evidence,
 COALESCE(r.changed_at,c.confirmed_at) AS updated_at
FROM completion_records c LEFT JOIN completion_revisions r
 ON r.record_id=c.id AND r.version=(SELECT MAX(h.version) FROM completion_revisions h WHERE h.record_id=c.id);

CREATE VIEW effective_completion_records AS SELECT * FROM completion_current WHERE status='active';

CREATE VIEW cost_current AS SELECT v.*,e.execution_id FROM cost_versions v JOIN cost_entries e ON e.id=v.entry_id
 WHERE v.version_no=(SELECT MAX(h.version_no) FROM cost_versions h WHERE h.entry_id=v.entry_id);

CREATE VIEW effective_cost_allocations AS SELECT a.*,v.entry_id,v.execution_id FROM cost_allocations a
 JOIN cost_current v ON v.id=a.version_id WHERE v.status='active';

CREATE VIEW cost_reconciliation_current AS SELECT v.* FROM cost_reconciliation_versions v
 WHERE v.version_no=(SELECT MAX(h.version_no) FROM cost_reconciliation_versions h WHERE h.record_id=v.record_id);
