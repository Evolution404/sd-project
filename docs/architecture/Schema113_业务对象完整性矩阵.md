# Schema 113｜71 张表业务对象完整性矩阵

**治理顺序：功能完备 → 业务关系 → 历史一致性 → 字段精简。** 本矩阵由当前候选 SQL 生成，覆盖全部实际表。

| 业务域 | 数据表 | 字段数 | 外键分量数 | 事实及主要用途 |
| --- | --- | ---: | ---: | --- |
| 输电设备及组织台账 | `line_history` | 13 | 5 | 线路完整属性历史 |
| 输电设备及组织台账 | `line_span_history` | 11 | 5 | 档距及管辖长度历史 |
| 输电设备及组织台账 | `line_spans` | 12 | 5 | 档距身份和当前关联 |
| 输电设备及组织台账 | `logical_tower_history` | 14 | 4 | 逻辑杆塔完整历史；运维班组和单回线路退役事实不可覆盖 |
| 输电设备及组织台账 | `logical_towers` | 17 | 4 | 每回线路逻辑杆塔；运维班组及在运、停用、独立退役 |
| 输电设备及组织台账 | `organizational_units` | 2 | 0 | 组织单位稳定身份和编码，名称、父级及启停历史独立版本化 |
| 输电设备及组织台账 | `organizational_unit_versions` | 9 | 3 | 正式组织单位名称、上级与启停的完整不可变历史版本 |
| 输电设备及组织台账 | `physical_tower_history` | 14 | 2 | 物理杆塔属性历史 |
| 输电设备及组织台账 | `physical_towers` | 17 | 2 | 实体杆塔独立状态（在运、停用、退役），不得在仍有在运逻辑回路时停用 |
| 输电设备及组织台账 | `transmission_lines` | 16 | 5 | 线路本体独立在运、停用、退役状态，完整历史；退役只约束本线逻辑杆塔 |
| 输电设备及组织台账 | `voltage_levels` | 6 | 0 | 电压等级基础定义 |
| 操作类型、字典和标准价格 | `dictionary_item_versions` | 10 | 2 | 字典项定义版本 |
| 操作类型、字典和标准价格 | `dictionary_items` | 4 | 1 | 字典项稳定身份 |
| 操作类型、字典和标准价格 | `dictionary_types` | 2 | 0 | 字典类别身份 |
| 操作类型、字典和标准价格 | `operation_versions` | 21 | 6 | 操作定义、作业对象/位置/单位关系 |
| 操作类型、字典和标准价格 | `operations` | 3 | 0 | 操作类型身份 |
| 操作类型、字典和标准价格 | `reference_price_catalog` | 4 | 1 | 参考单价身份 |
| 操作类型、字典和标准价格 | `reference_price_versions` | 26 | 9 | 参考价精确对应操作版本，支持每件价、每位置基础费+件价、数量区间多档计价，电压塔型及动态因素共同适用 |
| 操作类型、字典和标准价格 | `work_object_versions` | 10 | 2 | 作业对象定义版本 |
| 操作类型、字典和标准价格 | `work_objects` | 3 | 0 | 作业对象身份 |
| 来源、需求和物资 | `batch_demand_sources` | 3 | 3 | 批次与需求、来源的不可变导入断言 |
| 来源、需求和物资 | `demand_batches` | 10 | 2 | 需求导入批次 |
| 来源、需求和物资 | `demand_duplicate_reviews` | 8 | 4 | 疑似重复需求处理决策 |
| 来源、需求和物资 | `demand_lifecycle_events` | 8 | 2 | 需求确认退回撤销事件 |
| 来源、需求和物资 | `demand_material_items` | 8 | 2 | 需求首版编制材料 |
| 来源、需求和物资 | `demand_material_version_items` | 9 | 5 | 各需求版本材料清单 |
| 来源、需求和物资 | `demand_related_logical_towers` | 2 | 2 | 需求多逻辑杆塔关联 |
| 来源、需求和物资 | `demand_revisions` | 7 | 2 | 正式需求修改补丁 |
| 来源、需求和物资 | `demand_sources` | 2 | 2 | 需求来源关联 |
| 来源、需求和物资 | `demand_versions` | 23 | 16 | 正式需求完整定义版本 |
| 来源、需求和物资 | `demands` | 34 | 17 | 需求首次登记身份和原始事实 |
| 来源、需求和物资 | `source_records` | 14 | 3 | 一次性清洗导入或人工录入的原始来源证据，不做外部系统持续同步 |
| 框架、协议、项目与批准 | `agreement_versions` | 14 | 2 | 协议合同及额度版本 |
| 框架、协议、项目与批准 | `agreements` | 4 | 1 | 执行协议身份 |
| 框架、协议、项目与批准 | `framework_versions` | 9 | 2 | 框架批准额度与历史 |
| 框架、协议、项目与批准 | `frameworks` | 4 | 0 | 年度框架身份 |
| 框架、协议、项目与批准 | `project_approval_material_items` | 13 | 8 | 批准物资规格和数量快照 |
| 框架、协议、项目与批准 | `project_approval_scope_versions` | 10 | 5 | 准确关联需求及其当时正式批准范围版本；真实解绑以后仍保留原项目完整历史 |
| 框架、协议、项目与批准 | `project_approval_versions` | 10 | 3 | 项目正式批准要求至少一项有效且当前由本项目独占关联的需求；旧批准范围历史保留，已释放旧承接不阻止新项目承接 |
| 框架、协议、项目与批准 | `project_change_orders` | 12 | 4 | 项目正式变更审批依据，管理员可不填写理由，审核人/时间保留 |
| 框架、协议、项目与批准 | `project_demand_link_events` | 7 | 2 | 专业需求与子项目关联、显式解绑的连续不可变历史；当前仅允许一个有效归口子项目 |
| 框架、协议、项目与批准 | `project_demand_scopes` | 16 | 6 | 子项目与需求的稳定关联身份及拟承接数量；创建即锁定需求，绑定/解绑状态完全取不可变事件，不重复存储可变状态 |
| 框架、协议、项目与批准 | `project_funding_versions` | 7 | 3 | 项目资金协议关联历史 |
| 框架、协议、项目与批准 | `project_management_versions` | 17 | 10 | 完整项目档案（名称、项目类别正式版本）、责任人、子项目归口单位精确组织版本、计划期间与初估历史（非施工或结算单位） |
| 框架、协议、项目与批准 | `project_scope_materials` | 5 | 2 | 项目需求范围物资稳定身份 |
| 框架、协议、项目与批准 | `project_stage_events` | 7 | 2 | 项目储备入库立项关闭事件 |
| 框架、协议、项目与批准 | `projects` | 7 | 2 | 子项目稳定身份、所属框架与阶段事件同步投影，无重复当前名称/类别/时间 |
| 结算文件与审核 | `settlement_scope_results` | 6 | 3 | 每张正式结算单版本关联具体批准需求及本次新增解决数量（允许零表示只补结费用；修订版本全量替代） |
| 结算文件与审核 | `settlement_drafts` | 6 | 3 | 未提交结算草稿 |
| 结算文件与审核 | `settlement_item_versions` | 13 | 4 | 结算正式版本中每个费用科目的本期收费数量和金额；不复用为需求实际解决数量 |
| 结算文件与审核 | `settlement_items` | 5 | 3 | 结算项目范围明细身份 |
| 结算文件与审核 | `settlement_review_events` | 8 | 2 | 提交退回批准历史 |
| 结算文件与审核 | `settlement_versions` | 12 | 5 | 一张结算单各次完整正式版本；对应当次实际解决需求结果及本期收费明细 |
| 结算文件与审核 | `settlements` | 5 | 2 | 结算单稳定身份 |
| 来源、需求和物资主数据 | `materials` | 5 | 2 | 统一物资稳定身份：编码、单位不可无痕改写 |
| 来源、需求和物资主数据 | `material_versions` | 12 | 3 | 统一内部物资定义历史（名称、型号、规格、类别、状态），不保留PMS外部物资映射 |
| 实际费用与正式核对 | `project_cost_nodes` | 5 | 4 | 子项目费用树的稳定节点、父子层级及所属项目，末级可发生费用 |
| 实际费用与正式核对 | `project_cost_node_versions` | 8 | 2 | 费用节点名称和启停状态的不可变版本历史 |
| 实际费用与正式核对 | `cost_entries` | 5 | 4 | 独立于结算的项目实际费用身份 |
| 实际费用与正式核对 | `cost_reconciliation_versions` | 14 | 5 | 费用与结算核对历史 |
| 实际费用与正式核对 | `cost_versions` | 17 | 4 | 真实发生费用与历史，允许超出项目预算；管理员说明可留空 |
| 费用最终结清 | `project_closures` | 7 | 3 | 正式结项时记录实际需求及费用差异审核事实，不强制需求或费用均100%完成 |
| 账户、证据与运行基础 | `allowed_ips` | 5 | 1 | IP 许可配置 |
| 账户、证据与运行基础 | `audit_events` | 9 | 1 | 审计事件 |
| 账户、证据与运行基础 | `evidence_files` | 8 | 1 | 文件哈希与存储元信息 |
| 账户、证据与运行基础 | `evidence_links` | 28 | 25 | 证据附件强类型关联需求、结算中实际解决的需求结果、费用及关闭等具体正式事实 |
| 账户、证据与运行基础 | `ledger_requests` | 5 | 1 | 有真实操作者、参数哈希与不可变响应的接口幂等凭证 |
| 账户、证据与运行基础 | `permission_definitions` | 2 | 0 | 应用层权限项定义 |
| 账户、证据与运行基础 | `role_permissions` | 2 | 1 | 应用层角色权限矩阵 |
| 账户、证据与运行基础 | `sessions` | 4 | 1 | 登录会话身份 |
| 账户、证据与运行基础 | `users` | 6 | 0 | 用户账户身份 |

## 实际业务场景覆盖与边界

| 场景 | 已建模的数据对象 | 验收边界 |
| --- | --- | --- |
| 一次性清洗导入与需求重复识别 | source_records、demand_batches、demand_duplicate_reviews、demand_sources | 已建模；清洗后正式数据仍需导入验证 |
| 线路、物理杆塔、逻辑杆塔、同塔多回、档距管辖 | transmission_lines、physical_towers、logical_towers、line_spans 及各历史 | 已建模；真实设备台账待实施验收 |
| 操作类型、作业对象、位置、计量单位 | operation_versions、work_object_versions、dictionary_item_versions | 正式版本关系可验证 |
| 需求版本与版本物资清单 | demand_versions、demand_material_version_items | 已建模；物资主数据无外部系统编码映射；业务物资批准快照独立保存 |
| 储备、入库、立项与正式项目变更 | project_stage_events、project_approval_versions、project_change_orders | 审批历史及非法变更检查已覆盖 |
| 框架预算与可选执行协议 | framework_versions、agreement_versions、project_funding_versions | 预算仅为软基准，金额可超额 |
| 独立真实费用与批准结算逐笔核对 | cost_entries、cost_versions、settlement_item_versions、cost_reconciliation_versions | 已修复：费用归项目，核对只关联实际已批准的结算明细 |
| 完整结算版本、退回、批准及结项 | settlement_versions、settlement_review_events、project_closures | 正式版本与结项完整性可验证 |
| 月季度报表、25% 季度目标与预警 | cost_versions.occurred_on、framework_versions.limit_fen、project_management_versions | 事实完整；计算由应用层实现，不建报表视图 |
| 应用角色与授权 | users、permission_definitions、role_permissions | 授权由服务层执行，数据库保留身份外键及审计 |
| 真实附件恢复与物资采购库存 | evidence_files、evidence_links；不包含采购库存 | 附件字节恢复与完整仓储流程未纳入本轮实施验收 |

## 仍需明确的业务流程裁决

1. 跨子项目正式调整需求归属：必须明确审批及资金归属；禁止静默重复承接。
2. 正式关闭项目重新授权开启：须独立审批历史，不能简单把状态改回已批准。
3. 用户已确认：同一子项目可多次部分结算，单据金额都是本次结算；不再设预付款/进度/最终的累计口径分类。
4. 仓库库存、供应商采购、实际银行付款和完整发票台账属于新增业务范围，不能混同项目费用发生。
5. 实际源数据一次性清洗导入、客户端权限、文件系统断电与附件恢复尚待实施验证。

## 数据字段去留原则

- 仅删除可由权威事实唯一确定、没有独立历史价值的重复字段，例如已删除的需求根记录常量状态、固定版本与无效修改时间。
- 项目批准物资快照、物资主数据版本、需求历史版本、结算正式全量版本和实际费用更正均为不同业务证据，必须保留。
- 当前设备属性与设备全量历史通过受控触发器同步；不能让用户分别写入两套当前值。
- 实际费用由独立历史保存；物资主数据、需求及批准物资清单各有正式版本。每张结算单只记录本次费用，不引入独立领退料流水或施工完成事实。
- 避免数据库承担权限决策、分析报表、进度预警等应用层职责。

详见 `Schema113_逐字段数据字典.md`。


## 子项目多次部分结算：业务关系已确认

`settlements.project_id` 允许一个子项目拥有多张独立结算单。每次正式生效的结算版本只记录**这一次**结算的费用，`settlement_item_versions.amount_fen` 表示本次金额，不是累计金额。历史版本由同一结算单最新审核生效的版本替代，不重复计账。

正式发生的费用可以先独立登记在 `cost_entries` / `cost_versions`。随后通过 `cost_reconciliation_versions` 把一笔真实费用分多次关联到不同结算明细；每笔真实费用的有效核对总额不超过其自身金额，每条结算明细的有效核对总额不超过该明细金额。应用层计算项目实际费用总额、已结算金额和未结算余额；数据库不保存一份重复的累计值。

**已确认示例：** 实际费用 10 万，先结算 3 万、再结算 4 万、最后结算 3 万，累计结算 10 万，未结算余额 0 元。无额外的“最终结算累计单”。
