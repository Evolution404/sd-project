# 有来 vue3-element-admin v4.13.0 源码移植及实际复用清单

前半部分是 2026-11-23 旧前端局部移植记录。原版应用的运行状态与替换范围见末节及《有来重构交接复核与业务验收》。

## 源码基线、版权、第三方依赖

- 上游仓库：<https://github.com/youlaitech/vue3-element-admin>
- 采用版本：v4.13.0 / SHA `38189e5fdf7f7b98eac283001b2a089a89f11889`，使用 `git fetch --depth 1 origin <SHA>` 直接取得指定提交，**未**自动跟随上游主干。
- MIT 许可：`docs/vendor/vue3-element-admin-4.13.0/LICENSE`，随产品源码交付保留。
- 保留的上游原文件在同一目录：`LeftLayout.vue`、`LayoutNavbar.vue`、`LayoutSidebar.vue`、`LayoutMain.vue`、`Pagination.vue`、`CrudSearch.vue`、`CrudTable.vue`、`layout.scss`；SCSS 主题原文件置于 `web/src/vendor/youlai/theme.scss` 并由 `web/src/main.ts` **实际导入运行**。
- 新增构建依赖：`sass@1.93.2`，锁文件固定；未引入上游 Pinia、UnoCSS 全家桶或上游权限 API，避免绕开本系统现有 Vue Router/权限与 Windows 离线运行契约。

## 实际运行复用及本地适配边界

| 上游实现 | 运行文件 | 实际使用入口 | 有意识的项目改动 |
|---|---|---|---|
| `src/layouts/modes/LeftLayout.vue` | `web/src/vendor/youlai/layout/LeftLayout.vue` | `web/src/app/App.vue` 中登录后全系统外壳 | 仍保留上游左栏/主区域结构；侧栏宽度、折叠、拖动改接原有偏好状态 |
| `src/layouts/components/LayoutNavbar.vue` | `web/src/vendor/youlai/layout/LayoutNavbar.vue` | 所有模块顶部 | 适配本系统的登录账户、角色、当前路由、帮助/深浅主题，而非连接上游 Pinia |
| `src/layouts/components/LayoutSidebar.vue` | `web/src/vendor/youlai/layout/LayoutSidebar.vue` | 12 个入口共用 | 保留项目既有 `NavigationMenu` 层级、访问权限、会话及键盘折叠交互 |
| `src/layouts/components/LayoutMain.vue` | `web/src/vendor/youlai/layout/LayoutMain.vue` | 全部路由内容容器 | 使用现有 `RouterView` 以保留深链接、回退、草稿离开确认 |
| `src/styles/theme.scss` | `web/src/vendor/youlai/theme.scss` | 全站实际加载 | 原文件直接复用；项目 `theme.css` 继续兼容业务组件及暗色控件变量 |
| `src/components/Pagination/index.vue` | `web/src/vendor/youlai/components/Pagination.vue` | 物资标准列表 | Element Plus 分页接口适配项目页码查询，保持原版排布和页码策略 |
| `src/components/Crud/CrudTable.vue` | `web/src/vendor/youlai/components/CrudSurface.vue` | 物资列表外层容器 | 只复用上游 CRUD 卡片、工具栏、分页布局；数据表格仍由原业务 `TabulatorGrid` 负责以保留筛选和列设置 |
| `src/components/Crud/CrudSearch.vue` | 原版仅保存在 docs/vendor | 暂未直接接入业务列表 | 此上游组件强绑定上游表单配置和 CRUD API；当前列表使用项目原筛选实现，不冒充已直接复用 |

上述 `layout` 文件是**基于上游原组件设计移植的适配版本，不是将未修改的上游 .vue 直接放入运行时**；上游源码仍有完整可核对的原始副本。全系统 12 个入口通过共享布局一次接入，不重新编写每个模块业务界面。工作台、物资、需求详情、结算草稿为第一批实物样板；正式结算的可编辑区域仍采用项目原有 `BusinessDraftGrid`/Tabulator。

## 业务行为不变约束

1. 12 入口：工作台、专业需求、子项目、年度框架、执行协议、费用与结算、输电设备台账、物资、作业标准、参考价格、基础数据、系统管理。
2. 展示态沿用项目业务列表；具体记录在详情抽屉打开、正式事项在办理页打开。菜单切换、深链接、返回筛选、页面分页和会话勾选由本项目现有路由/业务状态负责。
3. 结算工作量工作表与金额分开保存；权限、批准范围、冻结单位精度、结项及冲突仍在现有服务端实施，不依赖上游模板逻辑。
4. 侧栏可折叠、拖宽、键盘改变宽度且偏好持久化；窄屏按项目既有导航抽屉处理。
5. Windows 版本打包随代码带上 `sass` 的构建产物，**运行时不需要 Sass/UnoCSS/Pinia 或外网拉取组件**。

## 浏览器取证位置

- `test-results/schema113/youlai-desktop/dashboard-{1440,1280,960,760}-{light,dark}.png`
- `test-results/schema113/youlai-desktop/materials-{1440,1280,960,760}-{light,dark}.png`
- `test-results/schema113/settlement-worksheet/1440-{light,dark}-worksheet.png`
- 12 模块/8 种尺寸主题专项：`node tests/e2e/youlai-desktop-browser.mjs`
- 上游源文件与源码运行适配件对照以 `git diff`、`git status` 及上表实际文件为准；不能将仅留存在 docs/vendor 的 `CrudSearch`/`CrudTable` 说成生产上已运行。

## 待优化

保留业务自有大型表格和数据权限层，暂不将上游 `CrudSearch` 和 `CrudTable` 的上游状态管理完整迁移到所有标准列表；这是可审计的兼容取舍，而非已完成的整页替换。若未来迁移，需要先证明原生筛选、服务端排序、列设置、批处理历史和 Windows 离线门禁全部不退化。

## 原版应用的实际接入与清理

- `codex/youlai-fullstack-rebuild-20261123` 使用同一上游提交的 `web-next/` 应用。生产构建使用 Node24、Vue Router 5、Pinia 4、Vite 8 和上游 Layout、Navbar、Sidebar、TagsView、CrudPage、CrudSearch、CrudTable、CrudForm、Pagination。普通列表连接真实业务 API。结算工作量和物资批量编辑使用 Tabulator。
- `src/router/views.ts` 只发现业务页、角色管理和错误页；服务端菜单从实际会话授权挑选组件。结算和项目办理的隐藏路由授予对应业务命令权限。列表通过上游 LayoutMain 的 KeepAlive 保持办理前的界面，Tabulator 负责冻结工作表的专业编辑。
- 原版示例、代码生成、BPMN 工作流、低代码表单、二维码登录、富文本公告及关联插件、类型声明和依赖已移除。入口不再注册低代码表单，Vite 移除专用预构建及分包配置。修改保留上游布局、主题、CRUD 组件和 MIT 许可。生产应用仍运行原项目的正式业务及现有权限校验。
- 正式入口已移到 `web/`，根工作区用 Node 24、pnpm 10.34.5 和唯一锁文件编译到 `dist/web`。旧版页面和旧 Vite 配置保存在测试资料目录，仅用于在隔离目录复现实测行为。正式包不纳入旧版源码或构建产物。
- 原版 CRUD 表单、搜索和批量导入导出表单统一由 Element Plus 处理校验。未使用的公开注册和自助身份绑定已移除。正式构建的版本标识由源码摘要产生，部署后继续使用原版版本检查。
