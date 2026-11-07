-- Canonical database V2 index definitions. Do not edit any generated runtime database.

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
CREATE INDEX idx_operations_unit ON operations(default_unit_id,status);
-- UNIQUE(operation_id,version) already owns the only necessary index.

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

CREATE INDEX idx_demand_context_line ON demands(context_line_id);
CREATE INDEX idx_demands_physical ON demands(physical_tower_id,operation_id,status);

CREATE INDEX idx_demand_span ON demands(span_id);

CREATE INDEX idx_duplicate_review_batch ON demand_duplicate_reviews(batch_id);

CREATE INDEX idx_project_changes ON project_change_orders(project_id,status);

CREATE INDEX idx_settlement_project ON project_settlement_entries(project_id,occurred_on);

CREATE INDEX idx_settlement_scope ON project_settlement_entries(project_scope_id);

CREATE INDEX idx_settlement_execution_item ON project_settlement_entries(execution_item_id,occurred_on);

CREATE INDEX idx_settlement_reverse ON project_settlement_entries(reversal_of);

CREATE INDEX idx_settlement_revision_number ON settlement_revisions(settlement_no);

CREATE INDEX idx_plan_budget_drafts_plan ON plan_budget_drafts(execution_id,status);

CREATE INDEX idx_cost_drafts_plan ON cost_drafts(execution_id,status);

CREATE INDEX idx_cost_match_entry ON cost_reconciliation_versions(cost_entry_id);

CREATE INDEX idx_cost_match_settlement ON cost_reconciliation_versions(settlement_entry_id);

-- Actual attachment ownership must resolve through a foreign key.
CREATE INDEX idx_attachments_demand ON attachments(demand_id,created_at);
CREATE INDEX idx_attachments_source ON attachments(source_id,created_at);

-- Reverse FK lookups and scoped financial history reporting.
CREATE INDEX idx_source_record_type ON source_records(type_id);
CREATE INDEX idx_demand_sources_reverse ON demand_sources(source_id,demand_id);
CREATE INDEX idx_cost_drafts_category ON cost_drafts(category_id,status);
CREATE INDEX idx_cost_versions_category ON cost_versions(category_id);
CREATE INDEX idx_change_order_approval ON project_change_orders(base_approval_version_id);
CREATE INDEX idx_budget_drafts_approval ON plan_budget_drafts(project_approval_version_id);
CREATE INDEX idx_plan_scope_status ON project_demand_scopes(project_id,status);

-- Span line filtering for fast demand lookup (including retired spans).
CREATE INDEX idx_spans_line_status ON line_spans(line_id,status);
