# Schema 113｜触发器与约束责任全量审计

本清单从最新候选 SQL 重建，数据库触发器职责限于真实外键之外的数据一致性、历史不可变、版本顺序和正式事实边界。应用操作权限、报表、预警不由 SQLite 触发器执行。

## 分类数量

| 责任类别 | 当前数量 |
| --- | ---: |
| 不可变历史或身份 | 113 |
| 历史快照原子同步 | 16 |
| 正式历史版本约束 | 27 |
| 正式批准/结项一致性 | 5 |
| 物资业务身份及关联 | 9 |
| 状态事件合法性 | 2 |
| 设备历史一致性 | 12 |
| 费用身份及核对约束 | 2 |
| 跨表关联和身份完整性 | 23 |


## 完整触发器清单

| 数据表 | 触发器 | 阶段/动作 | 类别 |
| --- | --- | --- | --- |
| `agreement_versions` | `agreement_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `agreement_versions` | `agreement_versions_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `agreement_versions` | `agreement_versions_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `agreements` | `agreement_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `agreements` | `agreement_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `audit_events` | `immutable_audit_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `audit_events` | `immutable_audit_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `batch_demand_sources` | `batch_demand_source_batch_identity_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `batch_demand_sources` | `batch_demand_source_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `batch_demand_sources` | `batch_demand_source_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `cost_entries` | `cost_entry_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `cost_entries` | `cost_entry_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `cost_entries` | `cost_entry_node_insert_guard` | BEFORE/INSERT | 费用身份及核对约束 |
| `cost_reconciliation_versions` | `cost_reconciliation_amount_cap` | BEFORE/INSERT | 费用身份及核对约束 |
| `cost_reconciliation_versions` | `cost_reconciliation_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `cost_reconciliation_versions` | `immutable_cost_reconciliation_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `cost_reconciliation_versions` | `reconciliation_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `cost_versions` | `cost_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `cost_versions` | `cost_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `cost_versions` | `immutable_cost_version_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_batches` | `batch_source_provenance_update_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `demand_batches` | `demand_batch_draft_edit_version_guard` | BEFORE/UPDATE | 正式历史版本约束 |
| `demand_batches` | `demand_batch_submitted_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_batches` | `demand_batch_submitted_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_duplicate_reviews` | `duplicate_review_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_duplicate_reviews` | `duplicate_review_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_lifecycle_events` | `demand_adopted_cancel_guard` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `demand_lifecycle_events` | `demand_lifecycle_initial_guard` | BEFORE/INSERT | 状态事件合法性 |
| `demand_lifecycle_events` | `demand_lifecycle_no_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_lifecycle_events` | `demand_lifecycle_no_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_material_items` | `demand_material_seed_frozen_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_material_items` | `demand_material_seed_frozen_insert` | BEFORE/INSERT | 不可变历史或身份 |
| `demand_material_items` | `demand_material_seed_frozen_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_material_items` | `demand_material_v1_delete` | AFTER/DELETE | 物资业务身份及关联 |
| `demand_material_items` | `demand_material_v1_insert` | AFTER/INSERT | 物资业务身份及关联 |
| `demand_material_items` | `demand_material_v1_update` | AFTER/UPDATE | 物资业务身份及关联 |
| `demand_material_items` | `material_master_inactive_new_demand` | BEFORE/INSERT | 物资业务身份及关联 |
| `demand_material_version_items` | `demand_material_version_no_change_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_material_version_items` | `demand_material_version_no_change_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_material_version_items` | `demand_material_version_source_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `demand_revisions` | `demand_revision_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_revisions` | `demand_revision_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_revisions` | `demand_revision_publish` | AFTER/INSERT | 正式历史版本约束 |
| `demand_revisions` | `demand_revision_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `demand_sources` | `demand_source_identity_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demand_sources` | `demand_source_identity_protected_delete` | BEFORE/DELETE | 跨表关联和身份完整性 |
| `demand_versions` | `demand_version_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `demand_versions` | `demand_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demand_versions` | `demand_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demands` | `demand_definition_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `demands` | `demand_initial_version_publish` | AFTER/INSERT | 正式历史版本约束 |
| `demands` | `demand_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `demands` | `demand_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `demands` | `demand_work_object_match_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `dictionary_item_versions` | `dictionary_item_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `dictionary_item_versions` | `dictionary_item_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `dictionary_item_versions` | `dictionary_item_version_sequence` | BEFORE/INSERT | 正式历史版本约束 |
| `dictionary_items` | `dictionary_item_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `dictionary_items` | `dictionary_item_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `evidence_files` | `evidence_file_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `evidence_files` | `evidence_file_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `evidence_links` | `evidence_link_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `evidence_links` | `evidence_link_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `framework_versions` | `framework_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `framework_versions` | `framework_versions_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `framework_versions` | `framework_versions_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `frameworks` | `framework_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `frameworks` | `framework_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `ledger_requests` | `ledger_request_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `ledger_requests` | `ledger_request_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `line_history` | `line_history_identity_insert` | BEFORE/INSERT | 设备历史一致性 |
| `line_history` | `line_history_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `line_history` | `line_history_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `line_span_history` | `span_history_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `line_span_history` | `span_history_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `line_spans` | `span_first_version_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `line_spans` | `span_history_create` | AFTER/INSERT | 设备历史一致性 |
| `line_spans` | `span_history_update` | AFTER/UPDATE | 设备历史一致性 |
| `line_spans` | `span_history_update_guard` | BEFORE/UPDATE | 设备历史一致性 |
| `line_spans` | `span_line_consistency_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `line_spans` | `span_line_consistency_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `logical_tower_history` | `logical_tower_history_identity_insert` | BEFORE/INSERT | 设备历史一致性 |
| `logical_tower_history` | `logical_tower_history_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `logical_tower_history` | `logical_tower_history_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `logical_towers` | `active_span_logical_tower_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `logical_towers` | `logical_tower_history_append` | AFTER/UPDATE | 设备历史一致性 |
| `logical_towers` | `logical_tower_history_initial` | AFTER/INSERT | 设备历史一致性 |
| `logical_towers` | `logical_tower_history_version_guard` | BEFORE/UPDATE | 正式历史版本约束 |
| `logical_towers` | `logical_tower_identity_immutable` | BEFORE/UPDATE | 不可变历史或身份 |
| `material_versions` | `material_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `material_versions` | `material_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `material_versions` | `material_version_insert_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `materials` | `material_master_unit_insert` | BEFORE/INSERT | 物资业务身份及关联 |
| `materials` | `material_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `materials` | `material_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `operation_versions` | `immutable_operation_version_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `operation_versions` | `immutable_operation_version_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `operation_versions` | `object_type_guard_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `operation_versions` | `operation_unit_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `operation_versions` | `operation_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `operations` | `operation_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `operations` | `operation_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `organizational_unit_versions` | `org_unit_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `organizational_unit_versions` | `org_unit_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `organizational_unit_versions` | `org_unit_version_insert_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `organizational_units` | `org_unit_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `organizational_units` | `org_unit_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `physical_tower_history` | `physical_tower_history_identity_insert` | BEFORE/INSERT | 设备历史一致性 |
| `physical_tower_history` | `physical_tower_history_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `physical_tower_history` | `physical_tower_history_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `physical_towers` | `active_physical_tower_retire_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `physical_towers` | `physical_tower_history_append` | AFTER/UPDATE | 设备历史一致性 |
| `physical_towers` | `physical_tower_history_initial` | AFTER/INSERT | 设备历史一致性 |
| `physical_towers` | `physical_tower_history_version_guard` | BEFORE/UPDATE | 正式历史版本约束 |
| `physical_towers` | `physical_tower_identity_immutable` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_approval_material_items` | `approved_material_identity_insert` | BEFORE/INSERT | 物资业务身份及关联 |
| `project_approval_material_items` | `approved_material_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_approval_material_items` | `approved_material_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_approval_material_items` | `approved_material_scope_insert` | BEFORE/INSERT | 物资业务身份及关联 |
| `project_approval_material_items` | `draft_approval_material_valid_update` | BEFORE/UPDATE | 物资业务身份及关联 |
| `project_approval_material_items` | `project_approval_material_frozen_after_approval` | BEFORE/INSERT | 不可变历史或身份 |
| `project_approval_scope_versions` | `approved_scope_demand_version_relation` | BEFORE/INSERT | 正式历史版本约束 |
| `project_approval_scope_versions` | `approved_scope_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_approval_scope_versions` | `approved_scope_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_approval_scope_versions` | `approved_scope_project_guard` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `project_approval_scope_versions` | `draft_approval_scope_valid_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `project_approval_scope_versions` | `project_approval_scope_frozen_after_approval` | BEFORE/INSERT | 不可变历史或身份 |
| `project_approval_versions` | `immutable_approval_version_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_approval_versions` | `immutable_approval_version_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_approval_versions` | `project_approval_finalize_guard` | BEFORE/UPDATE | 正式批准/结项一致性 |
| `project_approval_versions` | `project_approval_version_insert_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `project_approval_versions` | `project_demand_exclusive_approval` | BEFORE/UPDATE | 历史快照原子同步 |
| `project_change_orders` | `approved_change_order_immutable` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_change_orders` | `approved_change_order_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_change_orders` | `change_order_approval_metadata_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `project_change_orders` | `change_order_project_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `project_closures` | `closure_project_version_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `project_closures` | `project_closure_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_closures` | `project_closure_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_cost_node_versions` | `project_cost_node_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_cost_node_versions` | `project_cost_node_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_cost_node_versions` | `project_cost_node_version_insert_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `project_cost_nodes` | `project_cost_node_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_cost_nodes` | `project_cost_node_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_cost_nodes` | `project_cost_node_insert_guard` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `project_demand_scopes` | `frozen_approved_project_scope` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_demand_scopes` | `settled_project_scope_identity_delete` | BEFORE/DELETE | 跨表关联和身份完整性 |
| `project_funding_versions` | `project_funding_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_funding_versions` | `project_funding_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_funding_versions` | `project_funding_insert_guard` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `project_management_versions` | `management_version_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `project_management_versions` | `management_version_no_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_management_versions` | `management_version_no_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_management_versions` | `project_management_category_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `project_scope_materials` | `project_material_identity_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_scope_materials` | `project_material_identity_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_scope_materials` | `project_material_identity_insert` | BEFORE/INSERT | 物资业务身份及关联 |
| `project_stage_events` | `project_stage_event_apply` | AFTER/INSERT | 状态事件合法性 |
| `project_stage_events` | `project_stage_event_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `project_stage_events` | `project_stage_event_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `project_stage_events` | `project_stage_event_transition` | BEFORE/INSERT | 正式批准/结项一致性 |
| `projects` | `project_approved_status_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `projects` | `project_close_guard` | BEFORE/UPDATE | 正式批准/结项一致性 |
| `projects` | `project_closed_no_reopen_without_decision` | BEFORE/UPDATE | 正式批准/结项一致性 |
| `projects` | `project_home_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `projects` | `project_home_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `projects` | `project_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `projects` | `project_status_projection_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `reference_price_catalog` | `reference_price_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `reference_price_catalog` | `reference_price_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `reference_price_versions` | `immutable_reference_price_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `reference_price_versions` | `immutable_reference_price_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `reference_price_versions` | `reference_price_unit_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `reference_price_versions` | `reference_price_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `settlement_drafts` | `settlement_draft_project_guard` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `settlement_drafts` | `settlement_draft_project_guard_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `settlement_item_versions` | `settlement_item_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `settlement_item_versions` | `settlement_item_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `settlement_item_versions` | `settlement_item_version_insert_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `settlement_items` | `settlement_item_identity_delete` | BEFORE/DELETE | 跨表关联和身份完整性 |
| `settlement_items` | `settlement_item_identity_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `settlement_items` | `settlement_item_identity_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `settlement_review_events` | `settlement_review_event_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `settlement_review_events` | `settlement_review_event_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `settlement_review_events` | `settlement_review_event_insert_guard` | BEFORE/INSERT | 正式批准/结项一致性 |
| `settlement_versions` | `settlement_version_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `settlement_versions` | `settlement_version_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `settlement_versions` | `settlement_version_insert_guard` | BEFORE/INSERT | 正式历史版本约束 |
| `settlements` | `settlement_identity_delete` | BEFORE/DELETE | 跨表关联和身份完整性 |
| `settlements` | `settlement_identity_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `settlements` | `settlement_root_insert_only_active` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `source_records` | `source_category_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `source_records` | `source_category_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `source_records` | `source_identity_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `source_records` | `source_identity_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `transmission_lines` | `active_span_line_guard` | BEFORE/UPDATE | 历史快照原子同步 |
| `transmission_lines` | `line_history_append` | AFTER/UPDATE | 设备历史一致性 |
| `transmission_lines` | `line_history_initial` | AFTER/INSERT | 设备历史一致性 |
| `transmission_lines` | `line_history_version_guard` | BEFORE/UPDATE | 正式历史版本约束 |
| `transmission_lines` | `line_identity_immutable` | BEFORE/UPDATE | 不可变历史或身份 |
| `transmission_lines` | `valid_branch_insert` | BEFORE/INSERT | 跨表关联和身份完整性 |
| `transmission_lines` | `valid_branch_update` | BEFORE/UPDATE | 历史快照原子同步 |
| `voltage_levels` | `voltage_identity_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `voltage_levels` | `voltage_identity_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `work_object_versions` | `work_object_version_sequential_insert` | BEFORE/INSERT | 正式历史版本约束 |
| `work_object_versions` | `work_object_versions_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `work_object_versions` | `work_object_versions_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |
| `work_objects` | `work_object_root_immutable_delete` | BEFORE/DELETE | 不可变历史或身份 |
| `work_objects` | `work_object_root_immutable_update` | BEFORE/UPDATE | 不可变历史或身份 |

## 当前约束裁决

- 已清除 4 个重复触发器：失效的历史定义 UPDATE 校验、重复协议框架身份保护、已被真实外键处理的引用物资删除检查。
- 新增版本物资相关约束：材料根身份不可覆盖/删除、正式版本递增、记录时间有序、无实质变化不得制造新版本、正式版本不可修改/删除、历史物资关联只引用有效版本。
- 需求、项目审批、结算和真实费用的已有完整性保护保持有效。
- 此前费用树增加了父子关系、末级入账、版本不可变及费用类别匹配等 7 项完整性触发器。按后续业务裁决移除施工与物资领退相关触发器后，**该阶段的历史总数为 198 项（当前为 207 项）**；结算余额仍由应用层计算，不创建金额累计触发器。
- 对每个触发器是否进一步缩减，必须有等价 FK/UNIQUE/CHECK 证明及非法数据反例；不追求将数量硬压到固定值。

## 最近裁决：不再保留独立施工完成对象

取消检修计划与施工完成流程之后，移除了对应完工历史和剩余工作量处置的 9 项触发器；项目关闭仍按全部有效费用与结算最终核对的真实历史进行检查。

## 最新裁决：不建独立物资领退历史

用户确认不需要实际领料、退料流水。随 `material_usage_records` 与 `material_usage_revisions` 两张表移除六项相关触发器；保留统一物资主数据、需求物资、项目批准物资与各自正式历史约束。


## 第十轮：唯一费用科目与树历史约束强化

费用分类唯一权威为 `project_cost_nodes` + `project_cost_node_versions`；`cost_versions` 删除平行分类字段及索引，但**不改变当前触发器数量 204**。原有 `project_cost_node_insert_guard` 增加“从直属父级到根的整条科目路径均处于启用状态”检查；`project_cost_node_version_insert_guard` 增加时间顺序与同内容空版本拒绝；`cost_version_sequential_insert`、`settlement_item_version_insert_guard` 均拒绝引用比财务确认/结算版本登记更晚的费用节点定义。新增费用身份及结算行的现有身份约束也已扩展为**整条科目路径必须启用**，不是只检查直接末级状态。所有约束均是可重复验证的真实历史完整性，不维护统计金额或应用状态。

## 第十一轮：删除独立分摊历史，强化正式核对撤销

撤销 `cost_allocations` 与 `cost_allocation_versions` 的独立经济金额，连同六个仅服务分摊的触发器一起删除；金额关系统一由 `cost_reconciliation_versions` 与 `v_effective_cost_reconciliations` 保存和审核。`cost_reconciliation_amount_cap` 只限制新增有效金额；`reconciliation_version_sequential_insert` 验证正式撤销必须保留上一条核对的准确费用、单据身份和双金额。仍不建立数据库侧报表及统计余额。


## 第十二轮：全量历史审计与责任清单重建

- 当前准确规模为 **209 个触发器**；本文上方按真实 `sqlite_master` 重建了每个对象所属表、执行动作和职责类别，新增组织正式版本、项目根身份、疑似重复需求人工结论、幂等回执等必要约束。
- 对框架、协议、子项目资金关联、项目档案、结算审核、实际费用、各类型字典与参考价统一保护根身份、版本顺序和不可倒签时间，合理拒绝无内容变化的历史版本。
- 预算额度不参与实际费用和结算金额硬限制，季度指标与预算差额仅由应用层计算，SQL 不复制累加余额。


**额外边界反例（第十二轮继续审计）**：正式操作类型定义 `operation_versions` 即使没有任何需求引用，也不得 DELETE；电压等级身份即使当前没有线路使用，也不能无痕删除。两项此前真实可复现的删除漏洞均已通过独立阻断测试；历史任何是否有引用都不改变定义不可删除的原则。
