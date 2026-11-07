# Schema 113｜76 张表业务对象完整性矩阵

**治理顺序：功能完备 → 业务关系 → 历史一致性 → 字段精简。** 本矩阵由当前候选 SQL 生成，覆盖全部实际表。

| 业务域 | 数据表 | 字段数 | 外键分量数 | 事实及主要用途 |
| --- | --- | ---: | ---: | --- |
| 输电设备及组织台账 | `line_history` | 13 | 5 | 线路完整属性历史 |
| 输电设备及组织台账 | `line_source_aliases` | 3 | 1 | 外部线路别名映射 |
| 输电设备及组织台账 | `line_span_history` | 11 | 5 | 档距及管辖长度历史 |
| 输电设备及组织台账 | `line_spans` | 12 | 5 | 档距身份和当前关联 |
| 输电设备及组织台账 | `logical_tower_history` | 14 | 4 | 逻辑杆塔及物理关联历史 |
| 输电设备及组织台账 | `logical_towers` | 17 | 4 | 线路回路逻辑杆塔身份 |
| 输电设备及组织台账 | `organizational_units` | 5 | 1 | 部门班组组织层级 |
| 输电设备及组织台账 | `physical_tower_history` | 14 | 2 | 物理杆塔属性历史 |
| 输电设备及组织台账 | `physical_towers` | 17 | 2 | 物理杆塔身份及当前属性 |
| 输电设备及组织台账 | `transmission_lines` | 16 | 5 | 线路身份与当前台账 |
| 输电设备及组织台账 | `voltage_levels` | 6 | 0 | 电压等级基础定义 |
| 操作类型、字典和标准价格 | `dictionary_item_versions` | 10 | 2 | 字典项定义版本 |
| 操作类型、字典和标准价格 | `dictionary_items` | 4 | 1 | 字典项稳定身份 |
| 操作类型、字典和标准价格 | `dictionary_types` | 2 | 0 | 字典类别身份 |
| 操作类型、字典和标准价格 | `operation_versions` | 21 | 5 | 操作定义、作业对象/位置/单位关系 |
| 操作类型、字典和标准价格 | `operations` | 3 | 0 | 操作类型身份 |
| 操作类型、字典和标准价格 | `reference_price_catalog` | 4 | 1 | 参考单价身份 |
| 操作类型、字典和标准价格 | `reference_price_versions` | 21 | 7 | 参考单价正式历史 |
| 操作类型、字典和标准价格 | `work_object_versions` | 10 | 2 | 作业对象定义版本 |
| 操作类型、字典和标准价格 | `work_objects` | 3 | 0 | 作业对象身份 |
| 来源、需求和物资 | `batch_demand_sources` | 3 | 3 | 批次与需求、来源的不可变导入断言 |
| 来源、需求和物资 | `demand_batches` | 10 | 2 | 需求导入批次 |
| 来源、需求和物资 | `demand_duplicate_reviews` | 8 | 4 | 疑似重复需求处理决策 |
| 来源、需求和物资 | `demand_lifecycle_events` | 8 | 2 | 需求确认退回撤销事件 |
| 来源、需求和物资 | `demand_material_items` | 8 | 2 | 需求首版编制材料 |
| 来源、需求和物资 | `demand_material_version_items` | 9 | 4 | 各需求版本材料清单 |
| 来源、需求和物资 | `demand_related_logical_towers` | 2 | 2 | 需求多逻辑杆塔关联 |
| 来源、需求和物资 | `demand_revisions` | 7 | 2 | 正式需求修改补丁 |
| 来源、需求和物资 | `demand_sources` | 2 | 2 | 需求来源关联 |
| 来源、需求和物资 | `demand_versions` | 23 | 13 | 正式需求完整定义版本 |
| 来源、需求和物资 | `demands` | 34 | 14 | 需求首次登记身份和原始事实 |
| 来源、需求和物资 | `source_records` | 14 | 3 | PMS/Excel 原始证据 |
| 框架、协议、项目与批准 | `agreement_versions` | 14 | 2 | 协议合同及额度版本 |
| 框架、协议、项目与批准 | `agreements` | 4 | 1 | 执行协议身份 |
| 框架、协议、项目与批准 | `framework_versions` | 9 | 2 | 框架批准额度与历史 |
| 框架、协议、项目与批准 | `frameworks` | 4 | 0 | 年度框架身份 |
| 框架、协议、项目与批准 | `project_approval_material_items` | 13 | 6 | 批准物资规格和数量快照 |
| 框架、协议、项目与批准 | `project_approval_scope_versions` | 10 | 4 | 批准需求范围与数量快照 |
| 框架、协议、项目与批准 | `project_approval_versions` | 10 | 3 | 正式批准总预算和版本 |
| 框架、协议、项目与批准 | `project_change_orders` | 12 | 4 | 正式范围与预算变更依据 |
| 框架、协议、项目与批准 | `project_demand_scopes` | 16 | 4 | 项目承接需求及候选范围 |
| 框架、协议、项目与批准 | `project_funding_versions` | 7 | 3 | 项目资金协议关联历史 |
| 框架、协议、项目与批准 | `project_management_versions` | 13 | 5 | 责任人、单位、计划期间与估算历史 |
| 框架、协议、项目与批准 | `project_scope_materials` | 5 | 2 | 项目需求范围物资稳定身份 |
| 框架、协议、项目与批准 | `project_stage_events` | 7 | 2 | 项目储备入库立项关闭事件 |
| 框架、协议、项目与批准 | `projects` | 10 | 3 | 子项目稳定身份与阶段 |
| 结算文件与审核 | `settlement_drafts` | 6 | 3 | 未提交结算草稿 |
| 结算文件与审核 | `settlement_item_versions` | 13 | 4 | 版本化结算数量金额明细 |
| 结算文件与审核 | `settlement_items` | 5 | 3 | 结算项目范围明细身份 |
| 结算文件与审核 | `settlement_review_events` | 8 | 2 | 提交退回批准历史 |
| 结算文件与审核 | `settlement_versions` | 12 | 5 | 结算单完整历史版本；每个版本的明细金额仅表示本次部分结算 |
| 结算文件与审核 | `settlements` | 5 | 2 | 结算单稳定身份 |
| 实际完工与材料流水 | `completion_records` | 9 | 3 | 结算前后均可记录的现场完工 |
| 实际完工与材料流水 | `completion_revisions` | 12 | 2 | 完工更正/撤销历史 |
| 实际完工与材料流水 | `material_usage_records` | 11 | 4 | 项目物资多次领退真实流水 |
| 实际完工与材料流水 | `material_usage_revisions` | 10 | 2 | 领退事件更正/撤销 |
| 实际完工与材料流水 | `materials` | 5 | 2 | 统一物资稳定身份：编码、单位不可无痕改写 |
| 实际完工与材料流水 | `material_versions` | 13 | 3 | 物资正式定义历史及可修订的PMS外部编码（当前唯一映射） |
| 实际费用、分摊与核对 | `cost_allocation_versions` | 9 | 3 | 费用分摊更正历史 |
| 实际费用、分摊与核对 | `project_cost_nodes` | 5 | 3 | 子项目费用树的稳定节点、父子层级及所属项目，末级可发生费用 |
| 实际费用、分摊与核对 | `project_cost_node_versions` | 8 | 2 | 费用节点名称和启停状态的不可变版本历史 |
| 实际费用、分摊与核对 | `cost_allocations` | 4 | 2 | 费用到结算明细的分摊身份 |
| 实际费用、分摊与核对 | `cost_entries` | 5 | 3 | 独立于结算的项目实际费用身份 |
| 实际费用、分摊与核对 | `cost_reconciliation_versions` | 14 | 4 | 费用与结算核对历史 |
| 实际费用、分摊与核对 | `cost_versions` | 19 | 5 | 实际成本金额及确认历史 |
| 正式结项与剩余量处置 | `project_closure_dispositions` | 6 | 2 | 结项剩余量逐项处置 |
| 正式结项与剩余量处置 | `project_closures` | 7 | 3 | 正式结项审批与关闭依据 |
| 账户、证据与运行基础 | `allowed_ips` | 5 | 1 | IP 许可配置 |
| 账户、证据与运行基础 | `audit_events` | 9 | 1 | 审计事件 |
| 账户、证据与运行基础 | `evidence_files` | 8 | 1 | 文件哈希与存储元信息 |
| 账户、证据与运行基础 | `evidence_links` | 30 | 24 | 证据文件与正式业务身份关联 |
| 账户、证据与运行基础 | `ledger_requests` | 5 | 0 | 接口幂等写入记录 |
| 账户、证据与运行基础 | `permission_definitions` | 2 | 0 | 应用层权限项定义 |
| 账户、证据与运行基础 | `role_permissions` | 2 | 1 | 应用层角色权限矩阵 |
| 账户、证据与运行基础 | `sessions` | 4 | 1 | 登录会话身份 |
| 账户、证据与运行基础 | `users` | 6 | 0 | 用户账户身份 |

## 实际业务场景覆盖与边界

| 场景 | 已建模的数据对象 | 验收边界 |
| --- | --- | --- |
| PMS/Excel 需求导入及重复识别 | source_records、demand_batches、demand_duplicate_reviews、demand_sources | 已建模；真实台账仍需导入验证 |
| 线路、物理杆塔、逻辑杆塔、同塔多回、档距管辖 | transmission_lines、physical_towers、logical_towers、line_spans 及各历史 | 已建模；真实设备台账待实施验收 |
| 操作类型、作业对象、位置、计量单位 | operation_versions、work_object_versions、dictionary_item_versions | 正式版本关系可验证 |
| 需求版本与版本物资清单 | demand_versions、demand_material_version_items | 已建模；物资主数据版本含PMS外部编码历史；业务物资批准快照独立保存 |
| 储备、入库、立项与正式项目变更 | project_stage_events、project_approval_versions、project_change_orders | 审批历史及非法变更检查已覆盖 |
| 框架预算与可选执行协议 | framework_versions、agreement_versions、project_funding_versions | 预算仅为软基准，金额可超额 |
| 结算前完工、分批完工与更正 | completion_records、completion_revisions | 已修复：归项目需求范围，不依赖结算单 |
| 结算前费用发生、费用分摊与核对 | cost_entries、cost_versions、cost_allocations、cost_reconciliation_versions | 已修复：费用归项目，不先创建虚构结算 |
| 结算前多次领料、退料和历史修正 | material_usage_records、material_usage_revisions | 已修复：领退事件独立记录，可选关联结算 |
| 完整结算版本、退回、批准及结项 | settlement_versions、settlement_review_events、project_closures | 正式版本与结项完整性可验证 |
| 月季度报表、25% 季度目标与预警 | cost_versions.occurred_on、framework_versions.limit_fen、project_management_versions | 事实完整；计算由应用层实现，不建报表视图 |
| 应用角色与授权 | users、permission_definitions、role_permissions | 授权由服务层执行，数据库保留身份外键及审计 |
| 真实附件恢复与物资采购库存 | evidence_files、evidence_links；不包含采购库存 | 附件字节恢复与完整仓储流程未纳入本轮实施验收 |

## 仍需明确的业务流程裁决

1. 跨子项目正式移交剩余需求数量：必须明确审批、实施和资金归属；禁止静默重复承接。
2. 正式关闭项目重新授权开启：须独立审批历史，不能简单把状态改回已批准。
3. 用户已确认：同一子项目可多次部分结算，单据金额都是本次结算；不再设预付款/进度/最终的累计口径分类。
4. 仓库库存、供应商采购、实际银行付款和完整发票台账属于新增业务范围，不能混同项目费用发生。
5. 真实 PMS 数据批量清洗、客户端权限、文件系统断电与附件恢复尚待实施验证。

## 数据字段去留原则

- 仅删除可由权威事实唯一确定、没有独立历史价值的重复字段，例如已删除的需求根记录常量状态、固定版本与无效修改时间。
- 项目批准物资快照、物资主数据版本、需求历史版本、结算正式全量版本和实际费用更正均为不同业务证据，必须保留。
- 当前设备属性与设备全量历史通过受控触发器同步；不能让用户分别写入两套当前值。
- 实际成本、实际完工、领退物资均独立于结算，结算后续核对或关联只是另一项事实。
- 避免数据库承担权限决策、分析报表、进度预警等应用层职责。

详见 `Schema113_逐字段数据字典.md`。


## 子项目多次部分结算：业务关系已确认

`settlements.project_id` 允许一个子项目拥有多张独立结算单。每次正式生效的结算版本只记录**这一次**结算的费用，`settlement_item_versions.amount_fen` 表示本次金额，不是累计金额。历史版本由同一结算单最新审核生效的版本替代，不重复计账。

正式发生的费用可以先独立登记在 `cost_entries` / `cost_versions`。随后通过 `cost_reconciliation_versions` 把一笔真实费用分多次关联到不同结算明细；每笔真实费用的有效核对总额不超过其自身金额，每条结算明细的有效核对总额不超过该明细金额。应用层计算项目实际费用总额、已结算金额和未结算余额；数据库不保存一份重复的累计值。

**已确认示例：** 实际费用 10 万，先结算 3 万、再结算 4 万、最后结算 3 万，累计结算 10 万，未结算余额 0 元。无额外的“最终结算累计单”。
