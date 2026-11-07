-- Canonical database V2 trigger definitions. Do not edit any generated runtime database.

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

CREATE TRIGGER immutable_settlement_update
BEFORE UPDATE ON project_settlement_entries
BEGIN SELECT RAISE(ABORT,'原始结算事实不可修改，请通过凭证更正处理'); END;

CREATE TRIGGER immutable_settlement_delete
BEFORE DELETE ON project_settlement_entries
BEGIN SELECT RAISE(ABORT,'原始结算事实不可删除，请通过凭证撤销处理'); END;

CREATE TRIGGER immutable_settlement_revision_update BEFORE UPDATE ON settlement_revisions
BEGIN SELECT RAISE(ABORT,'凭证更正历史不可修改'); END;

CREATE TRIGGER immutable_settlement_revision_delete BEFORE DELETE ON settlement_revisions
BEGIN SELECT RAISE(ABORT,'凭证更正历史不可删除'); END;

CREATE TRIGGER immutable_settlement_command_update BEFORE UPDATE ON settlement_commands
BEGIN SELECT RAISE(ABORT,'凭证操作历史不可修改'); END;

CREATE TRIGGER immutable_settlement_command_delete BEFORE DELETE ON settlement_commands
BEGIN SELECT RAISE(ABORT,'凭证操作历史不可删除'); END;

CREATE TRIGGER immutable_confirmed_budget_draft BEFORE UPDATE ON plan_budget_drafts
WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'已确认或已删除的预算草稿保留历史，请另建调整草稿'); END;

CREATE TRIGGER preserve_budget_draft_delete BEFORE DELETE ON plan_budget_drafts
BEGIN SELECT RAISE(ABORT,'预算草稿请通过删除流程处理'); END;

CREATE TRIGGER immutable_plan_budget_version_update BEFORE UPDATE ON plan_budget_versions
BEGIN SELECT RAISE(ABORT,'预算核定历史不可覆盖，请编制调整草稿'); END;

CREATE TRIGGER immutable_plan_budget_version_delete BEFORE DELETE ON plan_budget_versions
BEGIN SELECT RAISE(ABORT,'预算核定历史不可清除，请明确撤销当前预算'); END;

CREATE TRIGGER immutable_completion_revision_update BEFORE UPDATE ON completion_revisions
BEGIN SELECT RAISE(ABORT,'完成记录更正历史不可覆盖'); END;

CREATE TRIGGER immutable_completion_revision_delete BEFORE DELETE ON completion_revisions
BEGIN SELECT RAISE(ABORT,'完成记录更正历史不可清除'); END;

CREATE TRIGGER immutable_completion_command_update BEFORE UPDATE ON completion_commands
BEGIN SELECT RAISE(ABORT,'完成记录处理历史不可覆盖'); END;

CREATE TRIGGER immutable_completion_command_delete BEFORE DELETE ON completion_commands
BEGIN SELECT RAISE(ABORT,'完成记录处理历史不可清除'); END;

CREATE TRIGGER immutable_cost_draft_update BEFORE UPDATE ON cost_drafts WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'已确认或已删除的费用草稿不可覆盖'); END;

CREATE TRIGGER preserve_cost_draft_delete BEFORE DELETE ON cost_drafts
BEGIN SELECT RAISE(ABORT,'费用草稿请通过删除流程处理'); END;

CREATE TRIGGER immutable_cost_version_update BEFORE UPDATE ON cost_versions
BEGIN SELECT RAISE(ABORT,'已确认费用不可覆盖，请编制更正草稿'); END;

CREATE TRIGGER immutable_cost_version_delete BEFORE DELETE ON cost_versions
BEGIN SELECT RAISE(ABORT,'已确认费用不可清除，请明确撤销'); END;

CREATE TRIGGER immutable_cost_allocation_update BEFORE UPDATE ON cost_allocations
BEGIN SELECT RAISE(ABORT,'历史费用分摊不可覆盖'); END;

CREATE TRIGGER immutable_cost_allocation_delete BEFORE DELETE ON cost_allocations
BEGIN SELECT RAISE(ABORT,'历史费用分摊不可清除'); END;

CREATE TRIGGER immutable_cost_reconciliation_update BEFORE UPDATE ON cost_reconciliation_versions
BEGIN SELECT RAISE(ABORT,'费用结算核对历史不可覆盖'); END;

CREATE TRIGGER immutable_cost_reconciliation_delete BEFORE DELETE ON cost_reconciliation_versions
BEGIN SELECT RAISE(ABORT,'费用结算核对历史不可清除'); END;

-- Operation unit must be an ordinary UNIT dictionary record.
CREATE TRIGGER operation_unit_insert BEFORE INSERT ON operations
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dictionary_items
  WHERE id=NEW.default_unit_id AND type_id='unit')
 THEN RAISE(ABORT,'操作类型必须关联计量单位') END;
END;
CREATE TRIGGER operation_unit_update BEFORE UPDATE OF default_unit_id ON operations
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dictionary_items
  WHERE id=NEW.default_unit_id AND type_id='unit')
 THEN RAISE(ABORT,'操作类型必须关联计量单位') END;
END;
CREATE TRIGGER immutable_operation_version_update BEFORE UPDATE ON operation_versions
BEGIN SELECT RAISE(ABORT,'操作类型历史版本不可修改'); END;
-- The archive is captured in audit_events before deleting a completely unused operation.


-- The first span of a branch must connect its confirmed junction tower on
-- the parent MAIN line to a tower on the branch. Other cross-line edges are
-- invalid, even when both endpoints happen to share a physical structure.
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
CREATE TRIGGER demand_definition_insert BEFORE INSERT ON demands
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operations o
 WHERE o.id=NEW.operation_id AND o.version=NEW.operation_version
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

-- A plan item can only reserve the scope approved for its own project.
CREATE TRIGGER execution_scope_insert BEFORE INSERT ON execution_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM executions e
 JOIN project_demand_scopes s ON s.project_id=e.project_id
 WHERE e.id=NEW.execution_id AND s.id=NEW.project_scope_id)
 THEN RAISE(ABORT,'检修计划不能引用其他子项目的需求范围') END;
END;
CREATE TRIGGER execution_scope_update BEFORE UPDATE OF execution_id,project_scope_id ON execution_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM executions e
 JOIN project_demand_scopes s ON s.project_id=e.project_id
 WHERE e.id=NEW.execution_id AND s.id=NEW.project_scope_id)
 THEN RAISE(ABORT,'检修计划不能引用其他子项目的需求范围') END;
END;

-- A budget draft or confirmation must be based on an approval for the plan's
-- own project; a reapproval does not retroactively rewrite prior plan facts.
CREATE TRIGGER budget_draft_project_insert BEFORE INSERT ON plan_budget_drafts
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM executions e
 JOIN project_approval_versions a ON a.project_id=e.project_id
 WHERE e.id=NEW.execution_id AND a.id=NEW.project_approval_version_id)
 THEN RAISE(ABORT,'预算草稿批准版本不属于本检修计划的子项目') END;
END;
CREATE TRIGGER budget_version_project_insert BEFORE INSERT ON plan_budget_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM executions e
 JOIN project_approval_versions a ON a.project_id=e.project_id
 JOIN plan_budget_drafts d ON d.execution_id=e.id
 WHERE e.id=NEW.execution_id AND a.id=NEW.project_approval_version_id
 AND d.id=NEW.proposal_id)
 THEN RAISE(ABORT,'预算核定版本与草稿或项目批准范围不一致') END;
END;

-- Settlement money cannot be attributed to the wrong project, approval or plan.
CREATE TRIGGER settlement_project_consistency_insert
BEFORE INSERT ON project_settlement_entries
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM project_demand_scopes s
 JOIN project_approval_versions a ON a.project_id=s.project_id
 WHERE s.id=NEW.project_scope_id AND s.project_id=NEW.project_id
 AND a.id=NEW.approval_version_id)
 THEN RAISE(ABORT,'结算项目、需求范围与批准版本不一致') END;
 SELECT CASE WHEN NEW.execution_item_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM execution_items i JOIN executions e ON e.id=i.execution_id
 WHERE i.id=NEW.execution_item_id AND i.project_scope_id=NEW.project_scope_id
 AND e.project_id=NEW.project_id)
 THEN RAISE(ABORT,'结算计划明细与需求范围不一致') END;
 SELECT CASE WHEN NEW.reversal_of IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM project_settlement_entries old
 WHERE old.id=NEW.reversal_of AND old.project_id=NEW.project_id
 AND old.project_scope_id=NEW.project_scope_id
 AND old.entry_kind='payment')
 THEN RAISE(ABORT,'结算冲销须引用同一项目范围内的原始付款凭证') END;
END;

CREATE TRIGGER change_order_project_insert BEFORE INSERT ON project_change_orders
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM project_approval_versions a
 WHERE a.id=NEW.base_approval_version_id AND a.project_id=NEW.project_id)
 THEN RAISE(ABORT,'项目变更单批准基线不属于该子项目') END;
END;


-- Dictionary categories are semantic foreign keys, not interchangeable IDs.
CREATE TRIGGER source_category_insert BEFORE INSERT ON source_records
WHEN NEW.type_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.type_id AND type_id='source')
 THEN RAISE(ABORT,'来源类别必须引用来源字典') END; END;
CREATE TRIGGER source_category_update BEFORE UPDATE OF type_id ON source_records
WHEN NEW.type_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.type_id AND type_id='source')
 THEN RAISE(ABORT,'来源类别必须引用来源字典') END; END;

CREATE TRIGGER project_category_insert BEFORE INSERT ON projects
WHEN NEW.category_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.category_id AND type_id='project_category')
 THEN RAISE(ABORT,'项目类别必须引用项目类别字典') END; END;
CREATE TRIGGER project_category_update BEFORE UPDATE OF category_id ON projects
WHEN NEW.category_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.category_id AND type_id='project_category')
 THEN RAISE(ABORT,'项目类别必须引用项目类别字典') END; END;

CREATE TRIGGER cost_category_draft_insert BEFORE INSERT ON cost_drafts
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.category_id AND type_id='expense_category')
 THEN RAISE(ABORT,'费用类别必须引用费用字典') END; END;
CREATE TRIGGER cost_category_draft_update BEFORE UPDATE OF category_id ON cost_drafts
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.category_id AND type_id='expense_category')
 THEN RAISE(ABORT,'费用类别必须引用费用字典') END; END;
CREATE TRIGGER cost_version_source_insert BEFORE INSERT ON cost_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cost_drafts d
 JOIN cost_entries c ON c.execution_id=d.execution_id
 WHERE d.id=NEW.draft_id AND c.id=NEW.entry_id)
 THEN RAISE(ABORT,'费用确认必须归属草稿原检修计划') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dictionary_items
 WHERE id=NEW.category_id AND type_id='expense_category')
 THEN RAISE(ABORT,'已确认费用类别无效') END;
END;

CREATE TRIGGER cost_allocation_plan_insert BEFORE INSERT ON cost_allocations
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cost_versions v
 JOIN cost_entries c ON c.id=v.entry_id
 JOIN execution_items i ON i.execution_id=c.execution_id
 WHERE v.id=NEW.version_id AND i.id=NEW.execution_item_id)
 THEN RAISE(ABORT,'费用分摊不能指向其他检修计划的需求明细') END; END;

CREATE TRIGGER cost_reconciliation_scope_insert BEFORE INSERT ON cost_reconciliation_versions
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cost_entries c
 JOIN cost_versions v ON v.entry_id=c.id
 JOIN execution_items i ON i.execution_id=c.execution_id
 JOIN project_demand_scopes s ON s.id=i.project_scope_id
 JOIN project_settlement_entries se ON se.project_scope_id=s.id
 WHERE c.id=NEW.cost_entry_id AND v.id=NEW.cost_version_id
 AND i.id=NEW.execution_item_id AND se.id=NEW.settlement_entry_id)
 THEN RAISE(ABORT,'费用结算核对不得跨检修计划或批准范围') END;
END;

CREATE TRIGGER unit_dictionary_type_guard BEFORE UPDATE OF type_id ON dictionary_items
WHEN OLD.type_id='unit' AND NEW.type_id<>'unit'
BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM operations
 WHERE default_unit_id=OLD.id)
 THEN RAISE(ABORT,'计量单位已被操作类型引用，不能改变字典类别') END; END;

CREATE TRIGGER reference_price_unit_insert BEFORE INSERT ON reference_price_catalog
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operations o
 JOIN dictionary_items u ON u.id=o.default_unit_id AND u.type_id='unit'
 WHERE o.id=NEW.operation_id AND o.default_unit_id=NEW.unit_id)
 THEN RAISE(ABORT,'参考价格单位必须与操作类型固定单位一致') END; END;
