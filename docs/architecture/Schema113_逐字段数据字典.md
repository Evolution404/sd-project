# Schema 113｜逐表逐字段正式数据字典

依据：`数据库V3_结算驱动_候选表结构.sql`。本文件列出当前全部基础表、含虚拟生成列的字段、主外键、必填性、默认值和保留理由；准确定义的全部 CHECK/触发器以源 SQL 为准。

金额采用人民币分的 INTEGER；数量采用统一缩放整数；日期采用 YYYY-MM-DD，UTC登记时间采用毫秒 ISO8601；全表 STRICT，不允许混合文本和数值。

**本字典描述数据库业务数据，不包含应用层统计、权限判定或预警功能。**


## `agreement_versions` — 协议合同及额度版本

业务领域：框架、协议、项目与批准。字段数：14；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `agreement_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→agreements.id（组1） | 业务归属执行协议 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `limit_fen` | INTEGER | 是 | — | 见原生CHECK | 框架或协议当前正式额度，人民币分 | 保留：历史/审核事实 |
| `contract_number` | TEXT | 否 | — | 见原生CHECK | 执行协议合同编号 | 保留：历史/审核事实 |
| `counterparty_name` | TEXT | 否 | — | 见原生CHECK | 执行协议合同相对方名称 | 保留：历史/审核事实 |
| `signed_on` | TEXT | 否 | — | 见原生CHECK | 协议合同签订日期 | 保留：历史/审核事实 |
| `effective_from` | TEXT | 否 | — | 见原生CHECK | 合同或版本生效起始业务日期 | 保留：历史/审核事实 |
| `effective_to` | TEXT | 否 | — | 见原生CHECK | 合同或版本生效结束日期 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `agreements` — 执行协议身份

业务领域：框架、协议、项目与批准。字段数：4；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `framework_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→frameworks.id（组0） | 所属年度框架稳定身份 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `allowed_ips` — IP 许可配置

业务领域：账户、证据与运行基础。字段数：5；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `ip` | TEXT | 是 | — | 唯一 | 允许访问的IPv4/IPv6地址 | 保留：独立属性或真实关联 |
| `note` | TEXT | 是 | '' | 见原生CHECK | 与业务对象关联的备注 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `audit_events` — 审计事件

业务领域：账户、证据与运行基础。字段数：9；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `entity` | TEXT | 是 | — | 见原生CHECK | 审计事件对应的业务实体类型 | 保留：历史/审核事实 |
| `entity_id` | TEXT | 是 | — | 见原生CHECK | 审计事件对应实体的稳定身份字符串 | 保留：历史/审核事实 |
| `action` | TEXT | 是 | — | 见原生CHECK | 当前业务记录操作类型 | 保留：历史/审核事实 |
| `before_json` | TEXT | 否 | — | 见原生CHECK | 操作前的结构化审计事实 | 保留：不可追溯重算的历史快照 |
| `after_json` | TEXT | 否 | — | 见原生CHECK | 操作后的结构化审计事实 | 保留：不可追溯重算的历史快照 |
| `reason` | TEXT | 否 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：历史/审核事实 |

## `batch_demand_sources` — 批次与需求、来源的不可变导入断言

业务领域：来源、需求和物资。字段数：3；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `batch_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→demand_batches.id（组2） | 需求导入批次身份 | 保留：独立属性或真实关联 |
| `demand_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `source_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→source_records.id（组0） | 来源记录稳定身份 | 保留：独立属性或真实关联 |

## `cost_entries` — 独立于结算的项目实际费用身份

业务领域：实际费用与正式核对。字段数：5；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 外键→project_cost_nodes.project_id（组0）<escape>|</escape>外键→projects.id（组2） | 子项目稳定身份 | 保留：独立属性或真实关联 |
| `cost_node_id` | TEXT | 是 | — | 外键→project_cost_nodes.id（组0） | 子项目费用树的稳定节点；只有末级能登记实际费用或结算 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组1） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `cost_reconciliation_versions` — 费用与结算核对历史

业务领域：实际费用与正式核对。字段数：14；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `record_id` | TEXT | 是 | — | 组合唯一 | 历史修订归属的原始业务事实 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `cost_version_id` | TEXT | 是 | — | 外键→cost_versions.id（组3） | 实际费用正式确认或修订版本 | 保留：历史/审核事实 |
| `settlement_item_id` | TEXT | 是 | — | 外键→settlement_item_versions.settlement_item_id（组0）<escape>|</escape>外键→settlement_items.id（组2） | 结算明细身份（实际实施登记时可空） | 保留：历史/审核事实 |
| `settlement_item_version_id` | TEXT | 是 | — | 外键→settlement_item_versions.id（组0） | 正式结算明细的完整历史版本 | 保留：历史/审核事实 |
| `reconciled_cost_fen` | INTEGER | 是 | — | 见原生CHECK | 该核对记录确认的真实成本金额 | 保留：历史/审核事实 |
| `reconciled_settlement_fen` | INTEGER | 是 | — | 见原生CHECK | 该核对记录确认的正式结算金额 | 保留：历史/审核事实 |
| `is_final` | INTEGER | 是 | — | 见原生CHECK | 费用核对是否为最终核对 | 保留：历史/审核事实 |
| `evidence` | TEXT | 是 | — | 见原生CHECK | 现场实际或成本确认的书面依据 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组1） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：历史/审核事实 |
| `request_key` | TEXT | 是 | — | 唯一 | 重复请求去重的稳定幂等标识 | 保留：稳定身份或唯一编码 |

## `cost_versions` — 实际费用金额、税务及确认历史；采用费用树历史版本为唯一分类，不重复存类别

业务领域：实际费用与正式核对。字段数：17；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `entry_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→cost_entries.id（组3） | 实际费用稳定身份 | 保留：历史/审核事实 |
| `cost_node_version_id` | TEXT | 是 | — | 外键→project_cost_node_versions.id（组2） | 本次实际费用确认或结算明细采用的费用名称定义历史版本 | 保留：历史/审核事实 |
| `funding_version_id` | TEXT | 否 | — | 外键→project_funding_versions.id（组1） | 真实费用或结算确认时所采用的资金归属版本 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `title` | TEXT | 是 | — | 见原生CHECK | 字典、费用或操作定义标题 | 保留：历史/审核事实 |
| `occurred_on` | TEXT | 是 | — | 见原生CHECK | 本次真实费用等独立业务事实的发生日期 | 保留：历史/审核事实 |
| `amount_fen` | INTEGER | 是 | — | 见原生CHECK | 本条财务事实的金额（人民币分）；结算明细只对应本次结算费用，不保存累计金额 | 保留：历史/审核事实 |
| `tax_mode` | TEXT | 否 | — | 见原生CHECK | 含税、不含税或无税业务口径 | 保留：历史/审核事实 |
| `tax_rate_basis_points` | INTEGER | 否 | — | 见原生CHECK | 税率，万分比整数 | 保留：历史/审核事实 |
| `invoice_number` | TEXT | 否 | — | 见原生CHECK | 实际费用关联的发票单号（不是完整发票台账） | 保留：历史/审核事实 |
| `evidence` | TEXT | 是 | — | 见原生CHECK | 现场实际或成本确认的书面依据 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `confirmed_by` | TEXT | 是 | — | 外键→users.id（组0） | 实际费用确认人员 | 保留：历史/审核事实 |
| `confirmed_at` | TEXT | 是 | — | 见原生CHECK | 实际费用或现场事实的确认UTC时间 | 保留：历史/审核事实 |
| `request_key` | TEXT | 是 | — | 唯一 | 重复请求去重的稳定幂等标识 | 保留：稳定身份或唯一编码 |

## `demand_batches` — 需求导入批次

业务领域：来源、需求和物资。字段数：10；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `draft_json` | TEXT | 是 | — | 见原生CHECK | 尚未提交的业务草稿正文 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'draft' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `version` | INTEGER | 是 | 1 | 见原生CHECK | 正式定义或设备当前连续版本 | 保留：独立属性或真实关联 |
| `idempotency_key` | TEXT | 否 | — | 唯一 | 同一导入请求的幂等标识 | 保留：独立属性或真实关联 |
| `payload_sha256` | TEXT | 否 | — | 见原生CHECK | 来源/请求原始内容SHA-256摘要 | 保留：独立属性或真实关联 |
| `source_id` | TEXT | 否 | — | 外键→source_records.id（组1） | 来源记录稳定身份 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |

## `demand_duplicate_reviews` — 疑似重复需求处理决策

业务领域：来源、需求和物资。字段数：8；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `batch_id` | TEXT | 是 | — | 外键→demand_batches.id（组3） | 需求导入批次身份 | 保留：独立属性或真实关联 |
| `matched_demand_id` | TEXT | 是 | — | 外键→demands.id（组2） | 去重审查中已存在的需求 | 保留：独立属性或真实关联 |
| `new_demand_id` | TEXT | 否 | — | 外键→demands.id（组1） | 去重审查关联的新建需求 | 保留：独立属性或真实关联 |
| `decision` | TEXT | 是 | — | 见原生CHECK | 重复需求审查结果 | 保留：独立属性或真实关联 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：独立属性或真实关联 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `demand_lifecycle_events` — 需求确认退回撤销事件

业务领域：来源、需求和物资。字段数：8；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `demand_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：历史/审核事实 |
| `event_seq` | INTEGER | 是 | — | 组合唯一 | 同一业务对象状态事件的连续序号 | 保留：历史/审核事实 |
| `from_status` | TEXT | 否 | — | 见原生CHECK | 状态事件的原状态 | 保留：历史/审核事实 |
| `to_status` | TEXT | 是 | — | 见原生CHECK | 状态事件的目标状态 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `demand_material_items` — 需求首版编制材料

业务领域：来源、需求和物资。字段数：8；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `demand_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `item_no` | INTEGER | 是 | — | 组合唯一 | 条目在所属正式清单内的顺序 | 保留：独立属性或真实关联 |
| `material_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→materials.id（组0） | 统一物资主数据身份 | 保留：独立属性或真实关联 |
| `quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 工程、需求或真实执行数量的缩放整数 | 保留：独立属性或真实关联 |
| `note` | TEXT | 是 | '' | 见原生CHECK | 与业务对象关联的备注 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |

## `demand_material_version_items` — 各需求版本材料清单

业务领域：来源、需求和物资。字段数：9；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `demand_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→demand_versions.demand_id（组0） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `demand_version` | INTEGER | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→demand_versions.version（组0） | 项目所引用的专业需求正式版本号 | 保留：独立属性或真实关联 |
| `material_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→materials.id（组3） | 统一物资主数据身份 | 保留：独立属性或真实关联 |
| `material_version_id` | TEXT | 是 | — | 外键→material_versions.id（组2） | 正式物资主数据历史版本身份，锁定需求清单或批准物资当时引用的定义 | 保留：独立属性或真实关联 |
| `item_no` | INTEGER | 是 | — | 组合唯一 | 条目在所属正式清单内的顺序 | 保留：独立属性或真实关联 |
| `quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 工程、需求或真实执行数量的缩放整数 | 保留：独立属性或真实关联 |
| `unit_id` | TEXT | 是 | — | 外键→dictionary_items.id（组1） | 计量单位字典项 | 保留：独立属性或真实关联 |
| `unit_snapshot` | TEXT | 是 | — | 见原生CHECK | 正式批准或发生时的单位名称快照 | 保留：不可追溯重算的历史快照 |
| `note` | TEXT | 是 | '' | 见原生CHECK | 与业务对象关联的备注 | 保留：独立属性或真实关联 |

## `demand_related_logical_towers` — 需求多逻辑杆塔关联

业务领域：来源、需求和物资。字段数：2；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `demand_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `logical_tower_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→logical_towers.id（组0） | 逻辑杆塔身份 | 保留：独立属性或真实关联 |

## `demand_revisions` — 正式需求修改补丁

业务领域：来源、需求和物资。字段数：7；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `demand_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `snapshot_json` | TEXT | 是 | — | 见原生CHECK | 正式业务版本整体快照 | 保留：不可追溯重算的历史快照 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `changed_at` | TEXT | 是 | — | 见原生CHECK | 业务定义变更登记UTC时间 | 保留：历史/审核事实 |

## `demand_sources` — 需求来源关联

业务领域：来源、需求和物资。字段数：2；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `demand_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `source_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→source_records.id（组0） | 来源记录稳定身份 | 保留：独立属性或真实关联 |

## `demand_versions` — 正式需求完整定义版本

业务领域：来源、需求和物资。字段数：23；外键分量：16。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `demand_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→demands.id（组12） | 专业需求稳定身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 主键<escape>|</escape>组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 工程、需求或真实执行数量的缩放整数 | 保留：历史/审核事实 |
| `operation_id` | TEXT | 是 | — | 外键→operation_versions.operation_id（组2） | 正式操作类型身份 | 保留：历史/审核事实 |
| `operation_version` | INTEGER | 是 | — | 外键→operation_versions.version（组2） | 操作类型正式版本号 | 保留：历史/审核事实 |
| `work_object_id` | TEXT | 是 | — | 外键→work_objects.id（组11） | 操作类型对应的作业对象身份 | 保留：历史/审核事实 |
| `unit_id` | TEXT | 是 | — | 外键→dictionary_item_versions.item_id（组1）<escape>|</escape>外键→dictionary_items.id（组10） | 计量单位字典项 | 保留：历史/审核事实 |
| `unit_version` | INTEGER | 是 | — | 外键→dictionary_item_versions.version（组1） | 计量单位字典正式版本号 | 保留：历史/审核事实 |
| `snapshot_json` | TEXT | 是 | — | 见原生CHECK | 正式业务版本整体快照 | 保留：不可追溯重算的历史快照 |
| `target_object` | TEXT | 否 | — | 生成列 | 本次具体作业对象或位置 | 派生（不另存） |
| `problem_description` | TEXT | 否 | — | 生成列 | 需处理的隐患或工作问题 | 派生（不另存） |
| `completion_standard` | TEXT | 否 | — | 生成列 | 需求内容的质量或结果验收判据，不是施工完成记录 | 派生（不另存） |
| `work_target_type` | TEXT | 否 | — | 生成列 | 作业对象定位方式，线路逻辑对象或物理设备 | 派生（不另存） |
| `logical_tower_id` | TEXT | 否 | — | 生成列<escape>|</escape>外键→logical_towers.id（组9） | 逻辑杆塔身份 | 派生（不另存） |
| `physical_tower_id` | TEXT | 否 | — | 生成列<escape>|</escape>外键→physical_towers.id（组8） | 实际物理杆塔身份 | 派生（不另存） |
| `observed_physical_tower_id` | TEXT | 否 | — | 生成列<escape>|</escape>外键→physical_towers.id（组7） | 录入时实际观察到的物理杆塔 | 派生（不另存） |
| `context_line_id` | TEXT | 否 | — | 生成列<escape>|</escape>外键→transmission_lines.id（组6） | 共享物理杆塔所在的具体线路背景 | 派生（不另存） |
| `span_id` | TEXT | 否 | — | 生成列<escape>|</escape>外键→line_span_history.span_id（组0）<escape>|</escape>外键→line_spans.id（组5） | 线路档距稳定身份 | 派生（不另存） |
| `span_version` | INTEGER | 否 | — | 生成列<escape>|</escape>外键→line_span_history.version_no（组0） | 需求关联档距的正式版本号 | 派生（不另存） |
| `priority_id` | TEXT | 否 | — | 生成列<escape>|</escape>外键→dictionary_items.id（组4） | 优先级字典项 | 派生（不另存） |
| `expected_on` | TEXT | 否 | — | 生成列 | 专业需求期望办理日期 | 派生（不另存） |
| `recorded_by` | TEXT | 是 | — | 外键→users.id（组3） | 登记正式业务事实的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `demands` — 需求首次登记身份和原始事实

业务领域：来源、需求和物资。字段数：34；外键分量：17。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `demand_no` | TEXT | 是 | — | 唯一 | 专业需求业务编号 | 保留：稳定身份或唯一编码 |
| `batch_id` | TEXT | 否 | — | 外键→demand_batches.id（组13） | 需求导入批次身份 | 保留：独立属性或真实关联 |
| `logical_tower_id` | TEXT | 否 | — | 外键→logical_towers.id（组12） | 逻辑杆塔身份 | 保留：独立属性或真实关联 |
| `physical_tower_id` | TEXT | 否 | — | 外键→physical_towers.id（组11） | 实际物理杆塔身份 | 保留：独立属性或真实关联 |
| `observed_physical_tower_id` | TEXT | 否 | — | 外键→physical_towers.id（组10） | 录入时实际观察到的物理杆塔 | 保留：独立属性或真实关联 |
| `line_name_snapshot` | TEXT | 是 | — | 见原生CHECK | 需求首次登记时看到的线路名称 | 保留：不可追溯重算的历史快照 |
| `tower_no_snapshot` | TEXT | 是 | — | 见原生CHECK | 需求首次登记时的杆塔编号 | 保留：不可追溯重算的历史快照 |
| `physical_code_snapshot` | TEXT | 否 | — | 见原生CHECK | 需求首次登记时的物理杆塔编码 | 保留：不可追溯重算的历史快照 |
| `work_target_type` | TEXT | 是 | — | 见原生CHECK | 作业对象定位方式，线路逻辑对象或物理设备 | 保留：独立属性或真实关联 |
| `operation_id` | TEXT | 是 | — | 外键→operation_versions.operation_id（组1）<escape>|</escape>外键→operations.id（组9） | 正式操作类型身份 | 保留：独立属性或真实关联 |
| `operation_version` | INTEGER | 是 | — | 外键→operation_versions.version（组1） | 操作类型正式版本号 | 保留：独立属性或真实关联 |
| `operation_snapshot` | TEXT | 是 | — | 见原生CHECK | 历史需求关联的操作类型文字 | 保留：不可追溯重算的历史快照 |
| `work_object_id` | TEXT | 是 | — | 外键→work_objects.id（组8） | 操作类型对应的作业对象身份 | 保留：独立属性或真实关联 |
| `work_object_snapshot` | TEXT | 是 | — | 见原生CHECK | 正式需求确认时的作业对象名称 | 保留：不可追溯重算的历史快照 |
| `target_object` | TEXT | 是 | — | 见原生CHECK | 本次具体作业对象或位置 | 保留：独立属性或真实关联 |
| `quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 工程、需求或真实执行数量的缩放整数 | 保留：独立属性或真实关联 |
| `unit_id` | TEXT | 是 | — | 外键→dictionary_item_versions.item_id（组0）<escape>|</escape>外键→dictionary_items.id（组7） | 计量单位字典项 | 保留：独立属性或真实关联 |
| `unit_version` | INTEGER | 是 | — | 外键→dictionary_item_versions.version（组0） | 计量单位字典正式版本号 | 保留：独立属性或真实关联 |
| `unit_snapshot` | TEXT | 是 | — | 见原生CHECK | 正式批准或发生时的单位名称快照 | 保留：不可追溯重算的历史快照 |
| `completion_standard` | TEXT | 是 | — | 见原生CHECK | 需求内容的质量或结果验收判据，不是施工完成记录 | 保留：独立属性或真实关联 |
| `problem_description` | TEXT | 是 | — | 见原生CHECK | 需处理的隐患或工作问题 | 保留：独立属性或真实关联 |
| `priority_id` | TEXT | 否 | — | 外键→dictionary_items.id（组6） | 优先级字典项 | 保留：独立属性或真实关联 |
| `priority_snapshot` | TEXT | 否 | — | 见原生CHECK | 需求确认时的优先级名称 | 保留：不可追溯重算的历史快照 |
| `expected_on` | TEXT | 否 | — | 见原生CHECK | 专业需求期望办理日期 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组5） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `custom_fields_json` | TEXT | 是 | '{}' | 见原生CHECK | 分类扩展业务字段的结构化数据 | 保留：独立属性或真实关联 |
| `field_definitions_json` | TEXT | 是 | '[]' | 见原生CHECK | 来源分类扩展字段定义 | 保留：独立属性或真实关联 |
| `location_kind` | TEXT | 否 | — | 生成列 | 根据档距关联自动推导的虚拟位置类型，不单独存储 | 派生（不另存） |
| `context_line_id` | TEXT | 否 | — | 外键→transmission_lines.id（组4） | 共享物理杆塔所在的具体线路背景 | 保留：独立属性或真实关联 |
| `span_id` | TEXT | 否 | — | 外键→line_span_history.span_id（组2）<escape>|</escape>外键→line_spans.id（组3） | 线路档距稳定身份 | 保留：独立属性或真实关联 |
| `span_version` | INTEGER | 否 | — | 外键→line_span_history.version_no（组2） | 需求关联档距的正式版本号 | 保留：独立属性或真实关联 |
| `span_snapshot_json` | TEXT | 否 | — | 见原生CHECK | 需求关联档距时的冻结历史信息 | 保留：不可追溯重算的历史快照 |

## `dictionary_item_versions` — 字典项定义版本

业务领域：操作类型、字典和标准价格。字段数：10；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `item_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→dictionary_items.id（组1） | 字典项或物资条目稳定身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `sort_order` | INTEGER | 是 | 100 | 见原生CHECK | 数据字典或操作定义展示顺序 | 保留：历史/审核事实 |
| `fields_json` | TEXT | 是 | '[]' | 见原生CHECK | 标准业务字典/操作类型扩展字段 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `changed_at` | TEXT | 是 | — | 见原生CHECK | 业务定义变更登记UTC时间 | 保留：历史/审核事实 |

## `dictionary_items` — 字典项稳定身份

业务领域：操作类型、字典和标准价格。字段数：4；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `type_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→dictionary_types.id（组0） | 数据字典分类身份 | 保留：独立属性或真实关联 |
| `code` | TEXT | 是 | — | 组合唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `dictionary_types` — 字典类别身份

业务领域：操作类型、字典和标准价格。字段数：2；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `title` | TEXT | 是 | — | 见原生CHECK | 字典、费用或操作定义标题 | 保留：独立属性或真实关联 |

## `evidence_files` — 文件哈希与存储元信息

业务领域：账户、证据与运行基础。字段数：8；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `sha256` | TEXT | 是 | — | 唯一 | 证据附件文件内容SHA-256摘要 | 保留：独立属性或真实关联 |
| `storage_key` | TEXT | 是 | — | 唯一 | 附件内容寻址存储路径 | 保留：独立属性或真实关联 |
| `filename` | TEXT | 是 | — | 见原生CHECK | 证据文件原始名称 | 保留：独立属性或真实关联 |
| `mime` | TEXT | 是 | 'application/octet-stream' | 见原生CHECK | 证据文件的MIME媒体类型 | 保留：独立属性或真实关联 |
| `bytes` | INTEGER | 是 | — | 见原生CHECK | 证据文件字节数 | 保留：独立属性或真实关联 |
| `uploaded_by` | TEXT | 是 | — | 外键→users.id（组0） | 证据文件上传用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `evidence_links` — 证据文件与正式业务身份关联

业务领域：账户、证据与运行基础。字段数：27；外键分量：24。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `file_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→evidence_files.id（组20） | 不可变证据文件身份 | 保留：独立属性或真实关联 |
| `material_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→material_versions.id（组19） | 正式物资主数据历史版本身份，锁定需求清单或批准物资当时引用的定义 | 保留：独立属性或真实关联 |
| `source_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→source_records.id（组18） | 来源记录稳定身份 | 保留：独立属性或真实关联 |
| `demand_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→demands.id（组17） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `demand_revision_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→demand_revisions.id（组16） | 专业需求修订历史记录 | 保留：独立属性或真实关联 |
| `demand_version_demand_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→demand_versions.demand_id（组1） | 证据所关联的专业需求版本复合身份 | 保留：独立属性或真实关联 |
| `demand_version_no` | INTEGER | 否 | — | 组合唯一<escape>|</escape>外键→demand_versions.version（组1） | 证据所关联的专业需求正式版本号 | 保留：独立属性或真实关联 |
| `demand_material_demand_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→demand_material_version_items.demand_id（组0） | 物资版本证据所归属的需求身份 | 保留：独立属性或真实关联 |
| `demand_material_version_no` | INTEGER | 否 | — | 组合唯一<escape>|</escape>外键→demand_material_version_items.demand_version（组0） | 版本化物资的需求版本号 | 保留：独立属性或真实关联 |
| `demand_material_master_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→demand_material_version_items.material_id（组0） | 版本物资所引用的统一物资身份 | 保留：独立属性或真实关联 |
| `demand_lifecycle_event_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→demand_lifecycle_events.id（组15） | 需求状态确认/退回历史事件 | 保留：独立属性或真实关联 |
| `project_stage_event_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_stage_events.id（组14） | 子项目储备入库立项结项事件 | 保留：独立属性或真实关联 |
| `project_management_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_management_versions.id（组13） | 子项目责任与计划版本 | 保留：独立属性或真实关联 |
| `project_funding_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_funding_versions.id（组12） | 子项目资金归属版本 | 保留：独立属性或真实关联 |
| `project_approval_material_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_approval_material_items.id（组11） | 具体已批准物资快照的证据归属 | 保留：独立属性或真实关联 |
| `line_span_history_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→line_span_history.id（组10） | 档距历史版本的证据关联 | 保留：独立属性或真实关联 |
| `change_order_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_change_orders.id（组9） | 引起正式批准版本变化的变更单 | 保留：独立属性或真实关联 |
| `project_approval_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_approval_versions.id（组8） | 项目正式批准版本的证据归属 | 保留：独立属性或真实关联 |
| `settlement_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→settlement_versions.id（组7） | 正式结算版本身份 | 保留：独立属性或真实关联 |
| `settlement_review_event_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→settlement_review_events.id（组6） | 具体结算审核事件 | 保留：独立属性或真实关联 |
| `cost_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→cost_versions.id（组5） | 实际费用正式确认或修订版本 | 保留：独立属性或真实关联 |
| `reconciliation_version_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→cost_reconciliation_versions.id（组4） | 费用与结算历史核对版本 | 保留：独立属性或真实关联 |
| `project_closure_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_closures.id（组3） | 正式关闭审批身份 | 保留：独立属性或真实关联 |
| `note` | TEXT | 是 | '' | 见原生CHECK | 与业务对象关联的备注 | 保留：独立属性或真实关联 |
| `linked_by` | TEXT | 是 | — | 外键→users.id（组2） | 提交证据关联的用户 | 保留：独立属性或真实关联 |
| `linked_at` | TEXT | 是 | — | 见原生CHECK | 证据与业务对象建立关联的UTC时间 | 保留：独立属性或真实关联 |

## `framework_versions` — 框架批准额度与历史

业务领域：框架、协议、项目与批准。字段数：9；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `framework_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→frameworks.id（组1） | 所属年度框架稳定身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `limit_fen` | INTEGER | 是 | — | 见原生CHECK | 框架或协议当前正式额度，人民币分 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `frameworks` — 年度框架身份

业务领域：框架、协议、项目与批准。字段数：4；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `fiscal_year` | INTEGER | 是 | — | 见原生CHECK | 所属年度 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `ledger_requests` — 接口幂等写入记录

业务领域：账户、证据与运行基础。字段数：5；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `request_key` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 重复请求去重的稳定幂等标识 | 保留：稳定身份或唯一编码 |
| `actor_id` | TEXT | 是 | — | 见原生CHECK | 执行业务事件的用户 | 保留：独立属性或真实关联 |
| `request_hash` | TEXT | 是 | — | 见原生CHECK | 幂等请求的原始内容摘要 | 保留：独立属性或真实关联 |
| `result_json` | TEXT | 是 | — | 见原生CHECK | 幂等请求已完成的结果快照 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `line_history` — 线路完整属性历史

业务领域：输电设备及组织台账。字段数：13；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `line_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→transmission_lines.id（组4） | 所属线路身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 主键<escape>|</escape>组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `voltage_level_id` | TEXT | 是 | — | 外键→voltage_levels.id（组3） | 线路设备所在电压等级 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `line_kind` | TEXT | 是 | — | 见原生CHECK | 主线、支线或其他线路类型 | 保留：历史/审核事实 |
| `parent_line_id` | TEXT | 否 | — | 外键→transmission_lines.id（组2） | 所属上级线路 | 保留：历史/审核事实 |
| `junction_tower_id` | TEXT | 否 | — | 外键→logical_towers.id（组1） | 线路分支接入点的逻辑杆塔 | 保留：历史/审核事实 |
| `setup_status` | TEXT | 是 | — | 见原生CHECK | 设备建档状态 | 保留：历史/审核事实 |
| `erection_type` | TEXT | 是 | — | 见原生CHECK | 线路/杆塔架设类型 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `line_source_aliases` — 外部线路别名映射

业务领域：输电设备及组织台账。字段数：3；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `line_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→transmission_lines.id（组0） | 所属线路身份 | 保留：独立属性或真实关联 |
| `source_name` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一 | 来源系统的对外名称 | 保留：独立属性或真实关联 |
| `source_kind` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一 | 来源渠道类别 | 保留：独立属性或真实关联 |

## `line_span_history` — 档距及管辖长度历史

业务领域：输电设备及组织台账。字段数：11；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `span_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→line_spans.id（组4） | 线路档距稳定身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `line_id` | TEXT | 是 | — | 外键→transmission_lines.id（组3） | 所属线路身份 | 保留：历史/审核事实 |
| `start_tower_id` | TEXT | 是 | — | 外键→logical_towers.id（组2） | 档距起始逻辑杆塔 | 保留：历史/审核事实 |
| `end_tower_id` | TEXT | 是 | — | 外键→logical_towers.id（组1） | 档距终止逻辑杆塔 | 保留：历史/审核事实 |
| `transmission_center_length_mm` | INTEGER | 否 | — | 见原生CHECK | 输电中心管辖的该档距长度，毫米整数，NULL表示尚未核定，0表示明确无管辖长度 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 否 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `line_spans` — 档距身份和当前关联

业务领域：输电设备及组织台账。字段数：12；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `line_id` | TEXT | 是 | — | 唯一<escape>|</escape>外键→transmission_lines.id（组4） | 所属线路身份 | 保留：独立属性或真实关联 |
| `start_tower_id` | TEXT | 是 | — | 外键→logical_towers.id（组3） | 档距起始逻辑杆塔 | 保留：独立属性或真实关联 |
| `end_tower_id` | TEXT | 是 | — | 外键→logical_towers.id（组2） | 档距终止逻辑杆塔 | 保留：独立属性或真实关联 |
| `transmission_center_length_mm` | INTEGER | 否 | — | 见原生CHECK | 输电中心管辖的该档距长度，毫米整数，NULL表示尚未核定，0表示明确无管辖长度 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `version` | INTEGER | 是 | 1 | 见原生CHECK | 正式定义或设备当前连续版本 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组1） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `updated_by` | TEXT | 否 | — | 外键→users.id（组0） | 修改主数据或可编辑业务草稿的用户 | 保留：独立属性或真实关联 |
| `change_reason` | TEXT | 是 | '首次建档' | 见原生CHECK | 台账设备属性变化原因 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |

## `logical_tower_history` — 逻辑杆塔及物理关联历史

业务领域：输电设备及组织台账。字段数：14；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `logical_tower_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→logical_towers.id（组3） | 逻辑杆塔身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 主键<escape>|</escape>组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `line_id` | TEXT | 是 | — | 外键→transmission_lines.id（组2） | 所属线路身份 | 保留：历史/审核事实 |
| `physical_tower_id` | TEXT | 否 | — | 外键→physical_towers.id（组1） | 实际物理杆塔身份 | 保留：历史/审核事实 |
| `tower_no` | TEXT | 是 | — | 见原生CHECK | 线路内的逻辑杆塔编号 | 保留：历史/审核事实 |
| `display_name` | TEXT | 否 | — | 见原生CHECK | 杆塔或线路面向业务的显示名称 | 保留：历史/审核事实 |
| `sort_rank` | INTEGER | 是 | — | 见原生CHECK | 设备在线路中的拓扑顺序 | 保留：历史/审核事实 |
| `circuit_position` | TEXT | 否 | — | 见原生CHECK | 同塔多回时的回路物理/逻辑位置 | 保留：历史/审核事实 |
| `management_department` | TEXT | 是 | — | 见原生CHECK | 设备主管部门 | 保留：历史/审核事实 |
| `maintenance_team` | TEXT | 是 | — | 见原生CHECK | 负责设备运维的班组 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `logical_towers` — 线路回路逻辑杆塔身份

业务领域：输电设备及组织台账。字段数：17；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `logical_code` | TEXT | 是 | — | 唯一 | 逻辑杆塔稳定编码 | 保留：稳定身份或唯一编码 |
| `line_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→transmission_lines.id（组3） | 所属线路身份 | 保留：独立属性或真实关联 |
| `physical_tower_id` | TEXT | 否 | — | 外键→physical_towers.id（组2） | 实际物理杆塔身份 | 保留：独立属性或真实关联 |
| `tower_no` | TEXT | 是 | — | 组合唯一 | 线路内的逻辑杆塔编号 | 保留：独立属性或真实关联 |
| `display_name` | TEXT | 否 | — | 见原生CHECK | 杆塔或线路面向业务的显示名称 | 保留：独立属性或真实关联 |
| `sort_rank` | INTEGER | 是 | — | 组合唯一 | 设备在线路中的拓扑顺序 | 保留：独立属性或真实关联 |
| `circuit_position` | TEXT | 否 | — | 见原生CHECK | 同塔多回时的回路物理/逻辑位置 | 保留：独立属性或真实关联 |
| `management_department` | TEXT | 是 | '' | 见原生CHECK | 设备主管部门 | 保留：独立属性或真实关联 |
| `maintenance_team` | TEXT | 是 | '' | 见原生CHECK | 负责设备运维的班组 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'draft' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `version` | INTEGER | 是 | 1 | 见原生CHECK | 正式定义或设备当前连续版本 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | strftime('%Y-%m-%dT%H:%M:%fZ', 'now') | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | strftime('%Y-%m-%dT%H:%M:%fZ', 'now') | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组1） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `updated_by` | TEXT | 否 | — | 外键→users.id（组0） | 修改主数据或可编辑业务草稿的用户 | 保留：独立属性或真实关联 |
| `change_reason` | TEXT | 是 | '首次建档' | 见原生CHECK | 台账设备属性变化原因 | 保留：独立属性或真实关联 |

## `material_versions` — 物资正式定义历史及可修订的PMS外部编码（当前唯一映射）

业务领域：来源、需求和物资主数据。字段数：13；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `material_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→materials.id（组2） | 统一物资主数据身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `pms_material_code` | TEXT | 否 | — | 见原生CHECK | PMS外部物资编码映射，随物资正式主数据版本保留修订历史；当前同码不可对应两个物资 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `model` | TEXT | 是 | '' | 见原生CHECK | 设备或物资型号 | 保留：历史/审核事实 |
| `specification` | TEXT | 是 | '' | 见原生CHECK | 物资或参考单价的规格 | 保留：历史/审核事实 |
| `category_id` | TEXT | 否 | — | 外键→dictionary_items.id（组1） | 业务类别字典项 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `note` | TEXT | 是 | '' | 见原生CHECK | 与业务对象关联的备注 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `materials` — 统一物资稳定身份：编码、单位不可无痕改写

业务领域：来源、需求和物资主数据。字段数：5；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `unit_id` | TEXT | 是 | — | 外键→dictionary_items.id（组1） | 计量单位字典项 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 否 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `operation_versions` — 操作定义、作业对象/位置/单位关系

业务领域：操作类型、字典和标准价格。字段数：21；外键分量：6。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `operation_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→operations.id（组4） | 正式操作类型身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `sort_order` | INTEGER | 是 | 100 | 见原生CHECK | 数据字典或操作定义展示顺序 | 保留：历史/审核事实 |
| `work_target_type` | TEXT | 是 | — | 见原生CHECK | 作业对象定位方式，线路逻辑对象或物理设备 | 保留：历史/审核事实 |
| `work_object_id` | TEXT | 是 | — | 外键→work_objects.id（组3） | 操作类型对应的作业对象身份 | 保留：历史/审核事实 |
| `default_unit_id` | TEXT | 是 | — | 外键→dictionary_item_versions.item_id（组0）<escape>|</escape>外键→dictionary_items.id（组2） | 操作类型默认计量单位字典身份 | 保留：历史/审核事实 |
| `default_unit_version` | INTEGER | 是 | — | 外键→dictionary_item_versions.version（组0） | 默认单位名称所在的正式字典版本 | 保留：历史/审核事实 |
| `default_quantity_scaled` | INTEGER | 否 | — | 见原生CHECK | 新增需求时建议的数量缩放整数 | 保留：历史/审核事实 |
| `completion_standard` | TEXT | 否 | — | 见原生CHECK | 需求内容的质量或结果验收判据，不是施工完成记录 | 保留：历史/审核事实 |
| `fields_json` | TEXT | 是 | '[]' | 见原生CHECK | 标准业务字典/操作类型扩展字段 | 保留：历史/审核事实 |
| `allow_tower` | INTEGER | 是 | — | 见原生CHECK | 操作类型是否允许选择杆塔 | 保留：历史/审核事实 |
| `allow_span` | INTEGER | 是 | — | 见原生CHECK | 操作类型是否允许选择档距 | 保留：历史/审核事实 |
| `default_location_kind` | TEXT | 是 | — | 见原生CHECK | 操作类型默认选用位置种类 | 保留：历史/审核事实 |
| `default_target_object` | TEXT | 是 | '' | 见原生CHECK | 操作类型默认作业对象位置说明 | 保留：历史/审核事实 |
| `entry_hint` | TEXT | 是 | '' | 见原生CHECK | 操作类型的录入指引文字 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组1） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `changed_at` | TEXT | 是 | — | 见原生CHECK | 业务定义变更登记UTC时间 | 保留：历史/审核事实 |

## `operations` — 操作类型身份

业务领域：操作类型、字典和标准价格。字段数：3；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `organizational_units` — 部门班组组织层级

业务领域：输电设备及组织台账。字段数：5；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：独立属性或真实关联 |
| `parent_id` | TEXT | 否 | — | 外键→organizational_units.id（组0） | 组织单位或业务对象的父级身份 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'active' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |

## `permission_definitions` — 应用层权限项定义

业务领域：账户、证据与运行基础。字段数：2；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `code` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `title` | TEXT | 是 | — | 见原生CHECK | 字典、费用或操作定义标题 | 保留：独立属性或真实关联 |

## `physical_tower_history` — 物理杆塔属性历史

业务领域：输电设备及组织台账。字段数：14；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `physical_tower_id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→physical_towers.id（组1） | 实际物理杆塔身份 | 保留：历史/审核事实 |
| `version` | INTEGER | 是 | — | 主键<escape>|</escape>组合唯一 | 正式定义或设备当前连续版本 | 保留：历史/审核事实 |
| `asset_no` | TEXT | 否 | — | 见原生CHECK | PMS等系统中的设备资产编号 | 保留：历史/审核事实 |
| `tower_type` | TEXT | 否 | — | 见原生CHECK | 杆塔类型 | 保留：历史/审核事实 |
| `longitude` | REAL | 否 | — | 见原生CHECK | 设备地理经度 | 保留：历史/审核事实 |
| `latitude` | REAL | 否 | — | 见原生CHECK | 设备地理纬度 | 保留：历史/审核事实 |
| `commissioned_on` | TEXT | 否 | — | 见原生CHECK | 设备投运业务日期 | 保留：历史/审核事实 |
| `model` | TEXT | 否 | — | 见原生CHECK | 设备或物资型号 | 保留：历史/审核事实 |
| `height_scaled` | INTEGER | 否 | — | 见原生CHECK | 设备高度整数缩放值 | 保留：历史/审核事实 |
| `purpose` | TEXT | 否 | — | 见原生CHECK | 设备用途或访问授权用途 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `physical_towers` — 物理杆塔身份及当前属性

业务领域：输电设备及组织台账。字段数：17；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `tower_code` | TEXT | 是 | — | 唯一 | 物理杆塔业务编码 | 保留：稳定身份或唯一编码 |
| `asset_no` | TEXT | 否 | — | 见原生CHECK | PMS等系统中的设备资产编号 | 保留：独立属性或真实关联 |
| `tower_type` | TEXT | 否 | — | 见原生CHECK | 杆塔类型 | 保留：独立属性或真实关联 |
| `longitude` | REAL | 否 | — | 见原生CHECK | 设备地理经度 | 保留：独立属性或真实关联 |
| `latitude` | REAL | 否 | — | 见原生CHECK | 设备地理纬度 | 保留：独立属性或真实关联 |
| `commissioned_on` | TEXT | 否 | — | 见原生CHECK | 设备投运业务日期 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'active' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `version` | INTEGER | 是 | 1 | 见原生CHECK | 正式定义或设备当前连续版本 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | strftime('%Y-%m-%dT%H:%M:%fZ', 'now') | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | strftime('%Y-%m-%dT%H:%M:%fZ', 'now') | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组1） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `updated_by` | TEXT | 否 | — | 外键→users.id（组0） | 修改主数据或可编辑业务草稿的用户 | 保留：独立属性或真实关联 |
| `change_reason` | TEXT | 是 | '首次建档' | 见原生CHECK | 台账设备属性变化原因 | 保留：独立属性或真实关联 |
| `model` | TEXT | 是 | '' | 见原生CHECK | 设备或物资型号 | 保留：独立属性或真实关联 |
| `height_scaled` | INTEGER | 否 | — | 见原生CHECK | 设备高度整数缩放值 | 保留：独立属性或真实关联 |
| `purpose` | TEXT | 是 | '' | 见原生CHECK | 设备用途或访问授权用途 | 保留：独立属性或真实关联 |

## `project_approval_material_items` — 批准物资规格和数量快照

业务领域：框架、协议、项目与批准。字段数：13；外键分量：8。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `approval_version_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→project_approval_scope_versions.approval_version_id（组1）<escape>|</escape>外键→project_approval_versions.id（组5） | 项目正式批准版本身份 | 保留：独立属性或真实关联 |
| `project_scope_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→project_scope_materials.project_scope_id（组0）<escape>|</escape>外键→project_approval_scope_versions.project_scope_id（组1）<escape>|</escape>外键→project_demand_scopes.id（组4） | 子项目承接的需求范围身份 | 保留：独立属性或真实关联 |
| `project_material_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→project_scope_materials.id（组0） | 子项目范围内的统一物资稳定身份 | 保留：独立属性或真实关联 |
| `material_version_id` | TEXT | 是 | — | 外键→material_versions.id（组3） | 正式物资主数据历史版本身份，锁定需求清单或批准物资当时引用的定义 | 保留：独立属性或真实关联 |
| `item_no` | INTEGER | 是 | — | 组合唯一 | 条目在所属正式清单内的顺序 | 保留：独立属性或真实关联 |
| `material_code_snapshot` | TEXT | 是 | — | 见原生CHECK | 批准时冻结的物资主数据编码 | 保留：不可追溯重算的历史快照 |
| `material_name` | TEXT | 是 | — | 见原生CHECK | 批准时冻结的物资名称 | 保留：独立属性或真实关联 |
| `material_model` | TEXT | 是 | — | 见原生CHECK | 批准时冻结的物资型号 | 保留：独立属性或真实关联 |
| `specification` | TEXT | 是 | '' | 见原生CHECK | 物资或参考单价的规格 | 保留：独立属性或真实关联 |
| `approved_quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 项目正式批准的物资数量 | 保留：独立属性或真实关联 |
| `unit_id` | TEXT | 是 | — | 外键→dictionary_items.id（组2） | 计量单位字典项 | 保留：独立属性或真实关联 |
| `unit_snapshot` | TEXT | 是 | — | 见原生CHECK | 正式批准或发生时的单位名称快照 | 保留：不可追溯重算的历史快照 |

## `project_approval_scope_versions` — 批准需求范围与数量快照

业务领域：框架、协议、项目与批准。字段数：10；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `approval_version_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→project_approval_versions.id（组3） | 项目正式批准版本身份 | 保留：历史/审核事实 |
| `project_scope_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→project_demand_scopes.id（组2） | 子项目承接的需求范围身份 | 保留：历史/审核事实 |
| `demand_id` | TEXT | 是 | — | 外键→demand_versions.demand_id（组0）<escape>|</escape>外键→demands.id（组1） | 专业需求稳定身份 | 保留：历史/审核事实 |
| `demand_version` | INTEGER | 是 | — | 外键→demand_versions.version（组0） | 项目所引用的专业需求正式版本号 | 保留：历史/审核事实 |
| `quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 工程、需求或真实执行数量的缩放整数 | 保留：历史/审核事实 |
| `unit_price_fen` | INTEGER | 否 | — | 见原生CHECK | 单位数量价格，以人民币分存储 | 保留：历史/审核事实 |
| `approved_amount_fen` | INTEGER | 否 | — | 见原生CHECK | 本次批准的范围金额，NULL表示未核定 | 保留：历史/审核事实 |
| `snapshot_json` | TEXT | 是 | — | 见原生CHECK | 正式业务版本整体快照 | 保留：不可追溯重算的历史快照 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：历史/审核事实 |

## `project_approval_versions` — 正式批准总预算和版本

业务领域：框架、协议、项目与批准。字段数：10；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→projects.id（组2） | 子项目稳定身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `change_order_id` | TEXT | 否 | — | 唯一<escape>|</escape>外键→project_change_orders.id（组1） | 引起正式批准版本变化的变更单 | 保留：历史/审核事实 |
| `snapshot_json` | TEXT | 是 | — | 见原生CHECK | 正式业务版本整体快照 | 保留：不可追溯重算的历史快照 |
| `approved_budget_fen` | INTEGER | 是 | — | 见原生CHECK | 项目本次批准的整体软预算，人民币分 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | 'draft' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `approved_by` | TEXT | 否 | — | 外键→users.id（组0） | 正式批准人用户身份 | 保留：历史/审核事实 |
| `approved_at` | TEXT | 否 | — | 见原生CHECK | 项目正式批准的UTC时间点 | 保留：历史/审核事实 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：历史/审核事实 |

## `project_change_orders` — 正式范围与预算变更依据

业务领域：框架、协议、项目与批准。字段数：12；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 外键→projects.id（组3） | 子项目稳定身份 | 保留：独立属性或真实关联 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `base_approval_version_id` | TEXT | 是 | — | 外键→project_approval_versions.id（组2） | 变更单所依据的前一项目正式批准版本 | 保留：独立属性或真实关联 |
| `proposal_json` | TEXT | 是 | — | 见原生CHECK | 项目范围和预算变更提案内容 | 保留：独立属性或真实关联 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'draft' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组1） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `decided_by` | TEXT | 否 | — | 外键→users.id（组0） | 作出批准或拒绝决定的人 | 保留：独立属性或真实关联 |
| `decided_at` | TEXT | 否 | — | 见原生CHECK | 正式业务决定UTC时间 | 保留：独立属性或真实关联 |
| `decision_reason` | TEXT | 否 | — | 见原生CHECK | 批准或拒绝的书面理由 | 保留：独立属性或真实关联 |

## `project_closures` — 正式结项审批与关闭依据

业务领域：费用最终结清。字段数：7；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 唯一<escape>|</escape>外键→projects.id（组2） | 子项目稳定身份 | 保留：历史/审核事实 |
| `approval_version_id` | TEXT | 是 | — | 外键→project_approval_versions.id（组1） | 项目正式批准版本身份 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `close_snapshot_json` | TEXT | 是 | — | 见原生CHECK | 正式结项时冻结的完整依据 | 保留：不可追溯重算的历史快照 |
| `closed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式关闭的审核人员 | 保留：历史/审核事实 |
| `closed_at` | TEXT | 是 | — | 见原生CHECK | 正式关闭批准UTC时间 | 保留：历史/审核事实 |

## `project_cost_node_versions` — 费用节点名称和启停状态的不可变版本历史

业务领域：实际费用与正式核对。字段数：8；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `node_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→project_cost_nodes.id（组1） | 关联node实体的真实身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `project_cost_nodes` — 子项目费用树的稳定节点、父子层级及所属项目，末级可发生费用

业务领域：实际费用与正式核对。字段数：5；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→project_cost_nodes.project_id（组0）<escape>|</escape>外键→projects.id（组2） | 子项目稳定身份 | 保留：独立属性或真实关联 |
| `parent_id` | TEXT | 否 | — | 外键→project_cost_nodes.id（组0） | 组织单位或业务对象的父级身份 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组1） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `project_demand_scopes` — 项目承接需求及候选范围

业务领域：框架、协议、项目与批准。字段数：16；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→projects.id（组3） | 子项目稳定身份 | 保留：独立属性或真实关联 |
| `demand_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→demand_versions.demand_id（组0）<escape>|</escape>外键→demands.id（组2） | 专业需求稳定身份 | 保留：独立属性或真实关联 |
| `demand_version` | INTEGER | 是 | — | 外键→demand_versions.version（组0） | 项目所引用的专业需求正式版本号 | 保留：独立属性或真实关联 |
| `proposed_quantity_scaled` | INTEGER | 是 | — | 见原生CHECK | 项目拟承接工作量缩放整数 | 保留：尚未批准的独立预计事实 |
| `proposed_unit_price_fen` | INTEGER | 否 | — | 见原生CHECK | 拟承接单价，人民币分 | 保留：尚未批准的独立预计事实 |
| `proposed_amount_fen` | INTEGER | 否 | — | 见原生CHECK | 项目拟承接金额（尚非正式批准值） | 保留：尚未批准的独立预计事实 |
| `price_source` | TEXT | 否 | — | 见原生CHECK | 单价引用的原始来源 | 保留：独立属性或真实关联 |
| `price_date` | TEXT | 否 | — | 见原生CHECK | 参考单价所依据的业务日期 | 保留：独立属性或真实关联 |
| `tax_mode` | TEXT | 否 | — | 见原生CHECK | 含税、不含税或无税业务口径 | 保留：独立属性或真实关联 |
| `note` | TEXT | 是 | '' | 见原生CHECK | 与业务对象关联的备注 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |
| `demand_snapshot_json` | TEXT | 否 | — | 见原生CHECK | 承接时冻结的专业需求定义 | 保留：不可追溯重算的历史快照 |
| `reference_price_version_id` | TEXT | 否 | — | 外键→reference_price_versions.id（组1） | 本次采用的参考单价正式版本 | 保留：独立属性或真实关联 |
| `proposal_status` | TEXT | 是 | 'active' | 见原生CHECK | 未正式批准前的项目拟承接状态 | 保留：独立属性或真实关联 |

## `project_funding_versions` — 项目资金协议关联历史

业务领域：框架、协议、项目与批准。字段数：7；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→projects.id（组2） | 子项目稳定身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `agreement_id` | TEXT | 否 | — | 外键→agreements.id（组1） | 业务归属执行协议 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `project_management_versions` — 责任人、单位、计划期间与估算历史

业务领域：框架、协议、项目与批准。字段数：13；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→projects.id（组4） | 子项目稳定身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `owner_id` | TEXT | 否 | — | 外键→users.id（组3） | 子项目责任人 | 保留：历史/审核事实 |
| `manager_id` | TEXT | 否 | — | 外键→users.id（组2） | 子项目管理人员 | 保留：历史/审核事实 |
| `responsible_unit_id` | TEXT | 否 | — | 外键→organizational_units.id（组1） | 负责实施的部门或班组 | 保留：历史/审核事实 |
| `planned_start_on` | TEXT | 否 | — | 见原生CHECK | 子项目预计开始业务日期 | 保留：历史/审核事实 |
| `planned_end_on` | TEXT | 否 | — | 见原生CHECK | 子项目预计结束业务日期 | 保留：历史/审核事实 |
| `preliminary_estimate_fen` | INTEGER | 否 | — | 见原生CHECK | 子项目初步估算金额（非正式批准） | 保留：尚未批准的独立预计事实 |
| `preliminary_estimate_basis` | TEXT | 否 | — | 见原生CHECK | 子项目初步估算金额的依据 | 保留：尚未批准的独立预计事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `project_scope_materials` — 项目需求范围物资稳定身份

业务领域：框架、协议、项目与批准。字段数：5；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_scope_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→project_demand_scopes.id（组1） | 子项目承接的需求范围身份 | 保留：独立属性或真实关联 |
| `material_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→materials.id（组0） | 统一物资主数据身份 | 保留：独立属性或真实关联 |
| `addition_reason` | TEXT | 是 | '' | 见原生CHECK | 超出需求原材料清单的新增理由 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `project_stage_events` — 项目储备入库立项关闭事件

业务领域：框架、协议、项目与批准。字段数：7；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→projects.id（组1） | 子项目稳定身份 | 保留：历史/审核事实 |
| `stage` | TEXT | 是 | — | 组合唯一 | 项目储备入库立项结项阶段 | 保留：历史/审核事实 |
| `project_version` | INTEGER | 是 | — | 组合唯一<escape>|</escape>组合唯一 | 项目阶段变更的连续序号 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：历史/审核事实 |

## `projects` — 子项目稳定身份与阶段

业务领域：框架、协议、项目与批准。字段数：10；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：独立属性或真实关联 |
| `framework_id` | TEXT | 是 | — | 外键→frameworks.id（组2） | 所属年度框架稳定身份 | 保留：独立属性或真实关联 |
| `category_id` | TEXT | 否 | — | 外键→dictionary_items.id（组1） | 业务类别字典项 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'reserve' | 见原生CHECK | 当前状态或历史版本审核状态 | 投影：阶段事件同步维护，禁止独立修改 |
| `version` | INTEGER | 是 | 1 | 见原生CHECK | 正式定义或设备当前连续版本 | 投影：阶段事件同步维护，禁止独立修改 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |

## `reference_price_catalog` — 参考单价身份

业务领域：操作类型、字典和标准价格。字段数：4；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `reference_price_versions` — 参考单价正式历史

业务领域：操作类型、字典和标准价格。字段数：21；外键分量：9。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `catalog_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→reference_price_catalog.id（组6） | 标准参考价格的目录稳定身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `title` | TEXT | 是 | — | 见原生CHECK | 字典、费用或操作定义标题 | 保留：历史/审核事实 |
| `operation_id` | TEXT | 是 | — | 外键→operation_versions.operation_id（组1）<escape>|</escape>外键→operations.id（组5） | 正式操作类型身份 | 保留：历史/审核事实 |
| `operation_version` | INTEGER | 是 | — | 外键→operation_versions.version（组1） | 操作类型正式版本号 | 保留：历史/审核事实 |
| `unit_id` | TEXT | 是 | — | 外键→dictionary_item_versions.item_id（组0）<escape>|</escape>外键→dictionary_items.id（组4） | 计量单位字典项 | 保留：历史/审核事实 |
| `unit_version` | INTEGER | 是 | — | 外键→dictionary_item_versions.version（组0） | 计量单位字典正式版本号 | 保留：历史/审核事实 |
| `voltage_level_id` | TEXT | 否 | — | 外键→voltage_levels.id（组3） | 线路设备所在电压等级 | 保留：历史/审核事实 |
| `work_mode` | TEXT | 是 | 'both' | 见原生CHECK | 作业方式，停电或不停电等 | 保留：历史/审核事实 |
| `specification` | TEXT | 是 | '' | 见原生CHECK | 物资或参考单价的规格 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `unit_price_fen` | INTEGER | 是 | — | 见原生CHECK | 单位数量价格，以人民币分存储 | 保留：历史/审核事实 |
| `price_source` | TEXT | 是 | — | 见原生CHECK | 单价引用的原始来源 | 保留：历史/审核事实 |
| `price_date` | TEXT | 是 | — | 见原生CHECK | 参考单价所依据的业务日期 | 保留：历史/审核事实 |
| `tax_mode` | TEXT | 是 | — | 见原生CHECK | 含税、不含税或无税业务口径 | 保留：历史/审核事实 |
| `effective_on` | TEXT | 是 | — | 见原生CHECK | 正式业务批准的生效日期 | 保留：历史/审核事实 |
| `basis` | TEXT | 是 | — | 见原生CHECK | 价格、结算或估算的依据说明 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组2） | 登记业务对象的用户 | 保留：历史/审核事实 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：历史/审核事实 |

## `role_permissions` — 应用层角色权限矩阵

业务领域：账户、证据与运行基础。字段数：2；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `role` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一 | 应用层角色名称 | 保留：独立属性或真实关联 |
| `permission_code` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>外键→permission_definitions.code（组0） | 应用层权限点编码 | 保留：独立属性或真实关联 |

## `sessions` — 登录会话身份

业务领域：账户、证据与运行基础。字段数：4；外键分量：1。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `token_hash` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 登录会话令牌单向哈希 | 保留：独立属性或真实关联 |
| `user_id` | TEXT | 是 | — | 外键→users.id（组0） | 登录会话对应的用户 | 保留：独立属性或真实关联 |
| `expires_at` | TEXT | 是 | — | 见原生CHECK | 登录会话或授权到期UTC时间 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `settlement_drafts` — 未提交结算草稿

业务领域：结算文件与审核。字段数：6；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `settlement_id` | TEXT | 是 | — | 主键<escape>|</escape>唯一<escape>|</escape>外键→settlements.id（组2） | 结算单稳定身份（对实际工作可空） | 保留：独立属性或真实关联 |
| `based_on_version_id` | TEXT | 否 | — | 外键→settlement_versions.id（组1） | 草稿所依据的上一正式结算版本 | 保留：独立属性或真实关联 |
| `draft_json` | TEXT | 是 | — | 见原生CHECK | 尚未提交的业务草稿正文 | 保留：独立属性或真实关联 |
| `edit_version` | INTEGER | 是 | 1 | 见原生CHECK | 草稿编辑并发版本序号 | 保留：独立属性或真实关联 |
| `updated_by` | TEXT | 是 | — | 外键→users.id（组0） | 修改主数据或可编辑业务草稿的用户 | 保留：独立属性或真实关联 |
| `updated_at` | TEXT | 是 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |

## `settlement_item_versions` — 版本化结算数量金额明细

业务领域：结算文件与审核。字段数：13；外键分量：4。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `settlement_version_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→settlement_versions.id（组3） | 正式结算版本身份 | 保留：历史/审核事实 |
| `settlement_item_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→settlement_items.id（组2） | 结算明细身份（实际实施登记时可空） | 保留：历史/审核事实 |
| `cost_node_version_id` | TEXT | 是 | — | 外键→project_cost_node_versions.id（组1） | 本次实际费用确认或结算明细采用的费用名称定义历史版本 | 保留：历史/审核事实 |
| `approval_scope_version_id` | TEXT | 否 | — | 外键→project_approval_scope_versions.id（组0） | 本条结算明细对应的正式批准范围版本 | 保留：历史/审核事实 |
| `quantity_scaled` | INTEGER | 是 | 0 | 见原生CHECK | 工程、需求或真实执行数量的缩放整数 | 保留：历史/审核事实 |
| `amount_fen` | INTEGER | 是 | — | 见原生CHECK | 本条财务事实的金额（人民币分）；结算明细只对应本次结算费用，不保存累计金额 | 保留：历史/审核事实 |
| `unit_price_fen` | INTEGER | 否 | — | 见原生CHECK | 单位数量价格，以人民币分存储 | 保留：历史/审核事实 |
| `work_mode` | TEXT | 否 | — | 见原生CHECK | 作业方式，停电或不停电等 | 保留：历史/审核事实 |
| `tax_mode` | TEXT | 否 | — | 见原生CHECK | 含税、不含税或无税业务口径 | 保留：历史/审核事实 |
| `tax_rate_basis_points` | INTEGER | 否 | — | 见原生CHECK | 税率，万分比整数 | 保留：历史/审核事实 |
| `evidence` | TEXT | 是 | — | 见原生CHECK | 现场实际或成本确认的书面依据 | 保留：历史/审核事实 |
| `scope_snapshot_json` | TEXT | 是 | — | 见原生CHECK | 结算或审批时冻结的业务范围快照 | 保留：不可追溯重算的历史快照 |

## `settlement_items` — 结算项目范围明细身份

业务领域：结算文件与审核。字段数：5；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `settlement_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→settlements.id（组2） | 结算单稳定身份（对实际工作可空） | 保留：独立属性或真实关联 |
| `project_scope_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→project_demand_scopes.id（组1） | 子项目承接的需求范围身份 | 保留：独立属性或真实关联 |
| `cost_node_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→project_cost_nodes.id（组0） | 子项目费用树的稳定节点；只有末级能登记实际费用或结算 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `settlement_review_events` — 提交退回批准历史

业务领域：结算文件与审核。字段数：8；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `settlement_version_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→settlement_versions.id（组1） | 正式结算版本身份 | 保留：历史/审核事实 |
| `event_seq` | INTEGER | 是 | — | 组合唯一 | 同一业务对象状态事件的连续序号 | 保留：历史/审核事实 |
| `action` | TEXT | 是 | — | 见原生CHECK | 当前业务记录操作类型 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | '' | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `actor_id` | TEXT | 是 | — | 外键→users.id（组0） | 执行业务事件的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |
| `effective_on` | TEXT | 否 | — | 见原生CHECK | 正式业务批准的生效日期 | 保留：历史/审核事实 |

## `settlement_versions` — 结算单完整历史版本；每个版本的明细金额仅表示本次部分结算

业务领域：结算文件与审核。字段数：12；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>组合唯一<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `settlement_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>组合唯一<escape>|</escape>外键→settlements.id（组4） | 结算单稳定身份（对实际工作可空） | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `previous_version_id` | TEXT | 否 | — | 外键→settlement_versions.id（组3） | 当前结算版本的上一历史版本 | 保留：历史/审核事实 |
| `approval_version_id` | TEXT | 是 | — | 外键→project_approval_versions.id（组2） | 项目正式批准版本身份 | 保留：历史/审核事实 |
| `funding_version_id` | TEXT | 否 | — | 外键→project_funding_versions.id（组1） | 真实费用或结算确认时所采用的资金归属版本 | 保留：历史/审核事实 |
| `change_type` | TEXT | 是 | — | 见原生CHECK | 本次正式版本属于新增、修订还是作废 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `basis` | TEXT | 是 | '' | 见原生CHECK | 价格、结算或估算的依据说明 | 保留：历史/审核事实 |
| `settlement_on` | TEXT | 否 | — | 见原生CHECK | 结算业务确认日期 | 保留：历史/审核事实 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `settlements` — 结算单稳定身份

业务领域：结算文件与审核。字段数：5；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `project_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→projects.id（组1） | 子项目稳定身份 | 保留：独立属性或真实关联 |
| `number` | TEXT | 是 | — | 组合唯一 | 项目内结算单编号 | 保留：稳定身份或唯一编码 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `source_records` — PMS/Excel 原始证据

业务领域：来源、需求和物资。字段数：14；外键分量：3。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `type_id` | TEXT | 否 | — | 外键→dictionary_items.id（组2） | 数据字典分类身份 | 保留：独立属性或真实关联 |
| `type_snapshot` | TEXT | 否 | — | 见原生CHECK | 业务确认时的来源类别文字 | 保留：不可追溯重算的历史快照 |
| `proposed_by` | TEXT | 否 | — | 见原生CHECK | 线索提出人员 | 保留：尚未批准的独立预计事实 |
| `discovered_on` | TEXT | 否 | — | 见原生CHECK | 问题被发现的业务日期 | 保留：独立属性或真实关联 |
| `description` | TEXT | 否 | — | 见原生CHECK | 来源线索或原始记录描述 | 保留：独立属性或真实关联 |
| `source_system` | TEXT | 是 | 'manual' | 组合唯一 | 外部业务系统或Excel来源名称 | 保留：独立属性或真实关联 |
| `external_record_id` | TEXT | 否 | — | 组合唯一 | PMS等外部来源系统的唯一记录编号 | 保留：独立属性或真实关联 |
| `source_file_id` | TEXT | 否 | — | 组合唯一<escape>|</escape>外键→evidence_files.id（组1） | 原始输入证据文件身份 | 保留：独立属性或真实关联 |
| `worksheet_name` | TEXT | 否 | — | 组合唯一 | 来源Excel工作表名称 | 保留：独立属性或真实关联 |
| `row_number` | INTEGER | 否 | — | 组合唯一 | Excel/PMS来源所在数据行号 | 保留：独立属性或真实关联 |
| `source_payload_sha256` | TEXT | 否 | — | 见原生CHECK | 原始来源记录SHA-256内容摘要 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组0） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `transmission_lines` — 线路身份与当前台账

业务领域：输电设备及组织台账。字段数：16；外键分量：5。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `line_code` | TEXT | 是 | — | 唯一 | 线路稳定业务编码 | 保留：稳定身份或唯一编码 |
| `voltage_level_id` | TEXT | 是 | — | 外键→voltage_levels.id（组4） | 线路设备所在电压等级 | 保留：独立属性或真实关联 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'active' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `version` | INTEGER | 是 | 1 | 见原生CHECK | 正式定义或设备当前连续版本 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | strftime('%Y-%m-%dT%H:%M:%fZ', 'now') | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |
| `updated_at` | TEXT | 是 | strftime('%Y-%m-%dT%H:%M:%fZ', 'now') | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |
| `created_by` | TEXT | 是 | — | 外键→users.id（组3） | 登记业务对象的用户 | 保留：独立属性或真实关联 |
| `updated_by` | TEXT | 否 | — | 外键→users.id（组2） | 修改主数据或可编辑业务草稿的用户 | 保留：独立属性或真实关联 |
| `change_reason` | TEXT | 是 | '首次建档' | 见原生CHECK | 台账设备属性变化原因 | 保留：独立属性或真实关联 |
| `line_kind` | TEXT | 是 | 'main' | 见原生CHECK | 主线、支线或其他线路类型 | 保留：独立属性或真实关联 |
| `parent_line_id` | TEXT | 否 | — | 外键→transmission_lines.id（组1） | 所属上级线路 | 保留：独立属性或真实关联 |
| `junction_tower_id` | TEXT | 否 | — | 外键→logical_towers.id（组0） | 线路分支接入点的逻辑杆塔 | 保留：独立属性或真实关联 |
| `setup_status` | TEXT | 是 | 'ready' | 见原生CHECK | 设备建档状态 | 保留：独立属性或真实关联 |
| `erection_type` | TEXT | 是 | '' | 见原生CHECK | 线路/杆塔架设类型 | 保留：独立属性或真实关联 |

## `users` — 用户账户身份

业务领域：账户、证据与运行基础。字段数：6；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `username` | TEXT | 是 | — | 唯一 | 登录用户名 | 保留：独立属性或真实关联 |
| `password_hash` | TEXT | 是 | — | 见原生CHECK | 账户密码的单向散列（不存明文） | 保留：独立属性或真实关联 |
| `role` | TEXT | 是 | — | 见原生CHECK | 应用层角色名称 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'active' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## `voltage_levels` — 电压等级基础定义

业务领域：输电设备及组织台账。字段数：6；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：独立属性或真实关联 |
| `status` | TEXT | 是 | 'active' | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：独立属性或真实关联 |
| `sort_order` | INTEGER | 是 | 100 | 见原生CHECK | 数据字典或操作定义展示顺序 | 保留：独立属性或真实关联 |
| `updated_at` | TEXT | 否 | — | 见原生CHECK | 允许更新的草稿或主数据最后修改UTC时间 | 保留：独立属性或真实关联 |

## `work_object_versions` — 作业对象定义版本

业务领域：操作类型、字典和标准价格。字段数：10；外键分量：2。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `work_object_id` | TEXT | 是 | — | 组合唯一<escape>|</escape>外键→work_objects.id（组1） | 操作类型对应的作业对象身份 | 保留：历史/审核事实 |
| `version_no` | INTEGER | 是 | — | 组合唯一 | 历史记录版本序号 | 保留：历史/审核事实 |
| `name` | TEXT | 是 | — | 见原生CHECK | 业务名称 | 保留：历史/审核事实 |
| `work_target_type` | TEXT | 是 | — | 见原生CHECK | 作业对象定位方式，线路逻辑对象或物理设备 | 保留：历史/审核事实 |
| `status` | TEXT | 是 | — | 见原生CHECK | 当前状态或历史版本审核状态 | 保留：历史/审核事实 |
| `sort_order` | INTEGER | 是 | 100 | 见原生CHECK | 数据字典或操作定义展示顺序 | 保留：历史/审核事实 |
| `reason` | TEXT | 是 | — | 见原生CHECK | 登记、修订、审批或撤销的正式理由 | 保留：历史/审核事实 |
| `changed_by` | TEXT | 是 | — | 外键→users.id（组0） | 执行正式变更的用户 | 保留：历史/审核事实 |
| `recorded_at` | TEXT | 是 | — | 见原生CHECK | 历史业务事件录入数据库的UTC时间点 | 保留：历史/审核事实 |

## `work_objects` — 作业对象身份

业务领域：操作类型、字典和标准价格。字段数：3；外键分量：0。

| 字段 | 类型 | 必填 | 默认值 | 关联/约束 | 业务含义 | 保留判定 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 是 | — | 主键<escape>|</escape>唯一 | 不可复用的对象稳定主键 | 保留：稳定身份或唯一编码 |
| `code` | TEXT | 是 | — | 唯一 | 唯一业务编码 | 保留：稳定身份或唯一编码 |
| `created_at` | TEXT | 是 | — | 见原生CHECK | 对象首次登记UTC时间 | 保留：登记/发生时间 |

## 数据字典核验摘要

基础数据表数：69；字段总数（含生成列）：659；需要人工补写独立描述的字段名：0。

业务字段是否需要新增必须结合真实台账和业务需求验证，**不能凭字段数量推断功能已经完全覆盖**。详情见业务对象完整性矩阵。
