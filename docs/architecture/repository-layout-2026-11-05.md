# 已批准架构与发布目录（2026-11-05）

> **历史关联条款废止声明（2026-11-09）** 本文中涉及 PMS、一次性专用导入、外部编码、映射或兼容的设想全部废止，仅作为历史审计记录。现行系统独立管理业务，技术编码由服务端生成，执行 docs/decisions/2026-11-09_系统独立_自动编码_最少录入.md。

## 架构裁决

- 模块化单体，Node.js 24 + SQLite + Vue 3 + Element Plus。保留已有内网浏览器访问机制、IP 白名单、角色权限与事务安全约束。
- 唯一持久化模块为 `server/database/`，不得放在 HTTP API 或 Vue 前端下。连接、Schema、事务、备份及最终全部业务 Repository/SQL、Read Model 都由这个模块维护，对外只有 `index.mjs`。
- `server/domain/` 放不依赖持久化的领域约束；`server/application/` 负责应用用例和事务边界；`server/http/` 负责请求和响应；`server/infrastructure/` 放文件与 Excel 等非数据库设施。
- 业务侧不持有 DatabaseSync 或任意 SQL；API 不能直接读写数据库。后端逐模块按领域重构，不通过双写、兼容别名或巨型 db.mjs 假装完成重构。
- 前端 `web/src/modules/` 业务模块化，`web/src/shared/` 公共组件/API，`web/src/styles/` 设计规范；业务 UI 统一 Element Plus。

## 项目根目录约定

```text
sd_project/
├── data/                      # 运行数据，禁止进 Git/ZIP
│   ├── business.sqlite
│   ├── business.sqlite-wal    # SQLite 自动管理，存在时保留
│   ├── business.sqlite-shm
│   ├── attachments/
│   └── backups/
├── dist/                      # 构建/发布结果
│   ├── index.html
│   ├── assets/
│   └── sd-project-win10-x64.zip
├── server/
│   ├── database/              # 唯一数据模块
│   │   ├── index.mjs
│   │   ├── connection.mjs
│   │   ├── data-path.mjs
│   │   ├── bootstrap.mjs
│   │   ├── schema-version.mjs
│   │   ├── schema/
│   │   │   ├── tables.sql
│   │   │   ├── indexes.sql
│   │   │   ├── views.sql
│   │   │   └── constraints.sql
│   │   ├── transaction.mjs
│   │   ├── backup.mjs
│   │   ├── repositories/      # 下一阶段逐业务抽取
│   │   └── queries/           # 下一阶段统计读模型
│   ├── domain/                # 后续重构
│   ├── application/           # 后续重构
│   ├── http/                  # 后续重构
│   └── infrastructure/        # 后续重构
├── web/
│   └── src/
│       ├── app/
│       ├── modules/
│       ├── shared/
│       └── styles/
├── scripts/
├── tests/
├── docs/
└── .build/                    # 打包中间文件、官方运行时缓存
```

以上包含未来目标目录；只有已有源文件的目录才应实际创建，不允许空文件夹充当“完成重构”。

## Windows 一键交付要求

1. 在 Mac 开发机执行 `npm run package:win`：先完成 Vite/类型检查构建，再从官方发行 ZIP 提取 Windows x64 Node.js 运行时并验证 SHA-256，隔离安装生产依赖、构建 ZIP。
2. 成品固定在 `dist/sd-project-win10-x64.zip`。发布包包含 `runtime/node.exe`、`server/`、`dist/index.html`、`dist/assets/`、生产依赖、管理员初始化、启动和备份脚本；绝不含 `data/`。
3. Windows 解压到 D:\SDProject 等可写目录后，程序入口 `启动服务.cmd`、`初始化管理员.cmd`、`备份数据库.cmd` 全部使用 `%~dp0data`，其中 PowerShell 使用 `Join-Path $root 'data'`。
4. 数据库、WAL/SHM、附件、备份均保存到该目录。升级时只替换程序文件，不能覆盖/删除 `data/`。不依赖目标电脑事先安装 Node/npm。
5. 开发机的运行默认路径也是项目根 `data/`；`DATA_DIR` 可显式指定测试隔离目录，但 Windows 双击启动脚本强制固定根目录 `data/`。
6. Vite 正常构建可能清空 `dist/` 中以前的发布 ZIP，因此“生成最终包”必须放在构建之后；不可在含旧 ZIP 的 dist 中无限递归套包。
7. Windows 实机验收仍需做：首次创建管理员、重启数据保留、局域网访问、防火墙/授权 IP、附件上传、备份和覆盖升级。Mac 的 ZIP 结构校验不等于 Windows 实机通过。

## 当前实施状态（2026-11-05，目录重构后）

### 已完成

- 按上述分层结构迁移原后端平铺文件：`server/main.mjs`、`http/`、`application/`、`domain/`、`database/`、`infrastructure/`；原 `server/server.mjs` 的路由逻辑移至 `server/http/router.mjs`，服务监听改由 `server/main.mjs` 负责。原 `server/db.mjs` 已移除。
- 前端旧 `web/src/components/`、`web/src/pages/`、`web/src/api/`、`web/src/utils/` 平铺文件已归入 `app/`、`modules/`、`shared/`，组件及测试引用同步更新。
- 测试已分类进入 `tests/unit/`、`tests/database/`、`tests/integration/`、`tests/browser/`、`tests/helpers/`、`tests/fixtures/`。
- Windows CMD 模板位于 `scripts/windows/`，发布构建 `scripts/release/`，本地双击启动 `scripts/dev/`，开发专用 PMS 导入 `scripts/import-pms/`。
- 根目录只保留 README、AGENTS、配置/构建入口；原开发/历史设计文档完整归档至 `docs/architecture`、`docs/business`、`docs/decisions`、`docs/archive`，`docs/README.md` 提供导航。
- 原 `release/` 截图与 Windows 旧发布包、原 `.local-test-data/` 的开发测试数据、旧服务日志和 PID **没有删除**，迁入被 Git 忽略的 `test-results/legacy-*` 留存。
- `npm run check` 的 102 个测试及前端构建通过；数据目录默认根 `data/`、打包输出根 `dist/`、正式包不包含 `data/` 的约束不变。

### 仍需完成（结构移动不等于彻底架构治理）

1. 旧 `server/application/` 的业务模块还混有 SQL；`server/http/router.mjs` 仍集中处理过多 HTTP 分支并存在 SQL 调用。下一阶段需从这些文件逐域提取真正的 `database/repositories/` 与 `database/queries/`，移除 Application/HTTP 的 SQL 与原始 db 访问，完成清晰的 Repository API 和跨域事务。
2. 前端 `web/src/App.vue` 仍有大量业务状态与页面模板；后续应按路由与功能切成独立页面和应用服务，应用根组件最终只负责提供者/布局/路由容器。
3. Windows 目标电脑真实初始化、启动、重启数据保留与防火墙等实机验收尚需在目标 Windows 机进行；Mac ZIP 完整性测试不能代替。
4. 历史开发记录中的旧路径和旧 Schema 数字均按当轮事实保留在 `docs/archive/`，当前规范与运行方式以根 README、AGENTS 及本文件为准。

**数据保护裁决：**重构不得改写用户现有 SQLite 业务库、已批准及结算历史，不能清空或导入开发样本以模拟正式数据。

## 2026-11-05 数据库 V2 首批更新

- 当前唯一 Schema 为 `server/database/schema/` 下的 `tables.sql`、`indexes.sql`、`views.sql` 和 `constraints.sql`；版本 **111**。旧 `server/database/schema.sql` 已移除。
- 操作类型的当前作业位置能力由 `operation_location_settings` 结构化管理；`dictionary_item_versions` 中的配置快照只保留历史用途。
- 开发专用 PMS 导入审计表不再包含于正式数据库 Schema。新库加强了杆塔/档距位置互斥、操作对象及位置范围的 CHECK 和触发器约束。
- HTTP 中的字典/操作定义核心写入 SQL 已移至 `server/database/repositories/dictionaries.mjs`；**其他业务模块中的 SQL 仍待逐域移入**。
- 详见 [数据库 V2 详细记录](数据库V2_模型与重构实施记录_2026-11-05.md)。

## 数据库 V2 第二阶段（2026-11-05）

- 新初始化契约为 **Schema 111**。`attachments` 现在以二选一真实外键绑定需求或来源，取消了原 `owner_type/owner_id` 的多态无约束引用；附件上传 API 不增加用户步骤。
- HTTP 路由不再直接包含 SQL：访问会话/IP、基础台账、字典、需求明细、需求修订、附件、统计等分别调用数据库 Repository/Query。标准数据库事务/审计由数据库模块提供。
- `application/demand-batches.mjs`、`reference-prices.mjs`、`dictionary-workspace.mjs`、`dictionary-order.mjs` 已不直接包含 SQL；相关读写归口于 `server/database/` 下的领域模块。
- `scripts/init-admin.mjs` 与 `scripts/dev-start.mjs` 已移除 SQL；用户初始化集中在 `repositories/users.mjs`，在同一写事务内拒绝重复创建管理员。
- `npm run check:database-boundary` 强制保护已迁移目录，作为新的技术债硬门禁。
- 其余 Application 模块仍有未治理 SQL；独立操作类型实体、需求作业位置归一、预算/实施数据结构重构仍未完成，不能将本轮命名为全系统数据库最终重构。

### 第二阶段最终回归摘要

- 自动化测试：107/107 通过；Chrome 业务回归：17 组通过；数据库边界门禁：17 个受保护源文件通过。
- 发布包：`dist/sd-project-win10-x64.zip`，官方 Windows x64 Node.js 校验通过，内含 Schema 111，排除 `data/`；解包暂存路径初始化与 SQLite 外键核验通过。
- 17 个 Application 文件尚含历史 SQL，下一阶段继续逐业务完整转移，而不是扩大临时豁免。真实 Windows 内网机器仍需安装/防火墙/重启/备份验收。


## 数据库 V2 第三阶段：Application 全 SQL 收口（2026-11-05）

- 原 17 个含 SQL 的 Application 业务模块已全部通过专用 Repository/Query 访问数据，包括：项目、变更单、执行计划、计划预算、实际费用、完成量、结算凭证、资金框架/协议、台账拓扑、整塔更换、业务审计等。
- HTTP、Application、Domain、Infrastructure 和主要启动脚本不再有 SQL 及原始 SQLite 驱动访问。`npm run check:database-boundary` 递归扫描完整 `server/application/`，新增源文件自动纳入。
- Application 保留工作量、资金预算、审批版本、冻结历史、事务、幂等与拓扑合法性规则；Repository 负责受限 SQL 写入，Query 负责单一读模型。
- Schema 仍为 **111**，`data/` 不被修改。独立 `operations` 实体、需求位置归一及性能复核仍待实施，不能把数据访问收口称作全数据库模型重构完成。


### 第三阶段完整复验

- `npm run check`：107/107 项通过；完整数据库层次边界：35 个受保护文件通过；`npm run test:browser`：17 组 Chrome 脚本通过。
- Windows 包重新发布为 `dist/sd-project-win10-x64.zip`（67,905,734 字节）。隔离初始化 Schema 111、外键核验和完整性核验通过，ZIP 不含 `data/`。
- 本轮未修改原 Mac 业务数据目录。真实 Windows 内网访问与备份恢复需要现场验证。

## 2026-11-06 最新数据库结构：Schema 112

> 上方的 Schema 110/111 记录属于逐阶段历史，当前唯一权威源为 `server/database/schema/{tables,indexes,views,constraints}.sql`。

- 结构优化已切换为 `operations` + `operation_versions`，不再依托普通 `dictionary_items` 或旧 `operation_location_settings` 保存操作定义。
- 需求只定位一项权威设备（逻辑杆塔/共用物理杆塔/档距）；`location_kind` 由数据库生成，档距不再冗余保存起点杆塔。支线第一档的合法接入杆塔例外仍受严格约束。
- 框架与执行协议、项目/计划/批准范围、预算、结算、费用/核对、操作历史强外键和跨表触发器已落实；索引计划实测见 [Schema 112 结构优化验收](数据库V2_Schema112_结构优化验收_2026-11-06.md)。
