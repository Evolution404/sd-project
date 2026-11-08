# 输电项目全流程管理系统

面向输电运检业务的内网项目管理系统，覆盖设备台账、操作类型、需求、项目框架、执行协议、检修计划、费用与结算。项目采用 Node.js 24 + SQLite + Vue 3 + Element Plus，内网终端通过浏览器使用。

## 一、快速启动

**Mac 开发机**

```bash
npm ci
make dev
```

首次启动交互创建管理员。访问 `http://127.0.0.1:8787`。也可使用 `npm start` 启动已构建的服务，或双击 [本地测试启动脚本](scripts/dev/启动本地测试.command)。

**Windows 10 x64 内网电脑（无需预装 Node/npm）**

在开发机执行：

```bash
npm run package:win
```

发布包固定输出到 **`dist/sd-project-win10-x64.zip`**。在 Windows 电脑将 ZIP 完整解压到有写权限的目录（如 `D:\SDProject`），依次双击 `初始化管理员.cmd`、`启动服务.cmd`。本机访问 `http://127.0.0.1:8787`；局域网电脑使用服务器 IP 和相同端口，须配置 Windows 防火墙和系统 IP 授权。

**运行数据只存放在项目/Windows 解压根目录的 `data/`**：

```text
data/
├── business.sqlite          # 主数据库
├── business.sqlite-wal      # SQLite 引擎自动产生
├── business.sqlite-shm      # SQLite 引擎自动产生
├── attachments/             # 业务附件
└── backups/                 # SQLite 和附件备份
```

发布 ZIP 不含 `data/`，覆盖升级程序文件时切勿删除、移动或覆盖该目录。开发测试可以显式指定 `DATA_DIR` 使用隔离数据目录；旧 Mac 用户目录中的开发样本不会被自动搬入新数据目录。

## 二、主要源码目录

```text
server/
├── main.mjs                 # Node 服务入口
├── http/                    # HTTP 路由和请求访问控制
├── application/             # 项目、需求、计划、财务等用例
├── domain/                  # 数量、金额、操作类型等规则
├── database/                # SQLite 连接、Schema、事务、备份、Repository
└── infrastructure/          # Excel 等非数据库设施

web/src/
├── App.vue                  # 应用根工作区
├── app/                     # 认证、布局
├── modules/                 # 业务页面和组件
├── shared/                  # 公共 API、组件和工具
└── styles/                  # Element Plus / 全局视觉规范

scripts/
├── dev/                     # 本地双击启动脚本
├── windows/                 # Windows 发布包入口模板
├── release/                 # Windows 打包脚本
└── import-pms/              # 仅开发用 PMS 导入工具

tests/
├── unit/
├── database/
├── integration/
├── browser/
├── helpers/
└── fixtures/
```

数据库访问已统一收敛到 `server/database/`：2026-11-07 运行 `npm run check:database-boundary`，35 个受保护源文件均无跨层直接 SQL。**这属于当前 Schema 112 应用结构的静态验证，不代表 Schema 113 已接入或生产验收完成**。详见 [仓库收口与治理状态](docs/architecture/Schema113_仓库收口与治理状态_2026-11-07.md)。

## 三、开发检查

```bash
npm run check         # Element Plus 规范门禁、TS/Vite 构建、全部自动化测试
npm run test:browser  # Chrome 浏览器业务及 UI 回归
npm run package:win   # Windows 10 x64 一键交付 ZIP
npm run backup        # 备份当前 DATA_DIR 数据库和附件
```

单元、数据库、接口和浏览器测试均应使用独立临时数据目录；PMS 开发样本、测试库及 `test-results/` 不进入正式发布包。

## 数据库重构状态

当前应用仍使用 **Schema 112**。**Schema 113 是尚未接入前后端的候选数据库设计**，以[第十五轮需求与子项目独占关联裁决](docs/architecture/Schema113_第十五轮_需求状态与子项目独占关联_显式解绑及重新承接_2026-11-08.md)为当前准则：专业需求含待确认/有效/退回/取消四种生命周期状态，项目在**添加需求关联时**立即独占，别的项目必须等原项目明确解绑后才能重新承接；全部历史批准、结算与解决数量均保留。第十四轮的同塔多装置参考价、逐次结算解决需求、需求和费用允许有差异结项、管理员理由可选规则继续有效。**当前候选：71 张表、25 个事实视图、224 个触发器、71 个显式索引、681 个字段、432/432 隔离数据库契约通过。** 仍未修改真实运行库及原有应用。

## 四、文档入口

- [文档导航](docs/README.md)
- [项目开发规范](docs/architecture/系统开发规范.md)
- [已批准架构与目录约束](docs/architecture/repository-layout-2026-11-05.md)
- [数据库 V2 重构实施记录](docs/architecture/数据库V2_模型与重构实施记录_2026-11-05.md)
- [数据库 Schema 112 结构优化验收](docs/architecture/数据库V2_Schema112_结构优化验收_2026-11-06.md)
- [业务设计文档](docs/architecture/项目全流程管理系统_功能设计文档.md)
- [2026-11-05 全面审计报告](docs/architecture/架构与交互全面审计_2026-11-05_重构实施方案.md)
- [操作类型与作业位置规则](docs/business/操作类型维护界面与字段联动_2026-11-03.md)
- [设计裁决](docs/decisions/架构裁决_2026-10-30_四层管理与需求承接.md)

正式业务数据和历史审批/结算记录不可擅自清除。更改业务行为前应同时查看 [AGENTS.md](AGENTS.md) 和适用的设计裁决。
