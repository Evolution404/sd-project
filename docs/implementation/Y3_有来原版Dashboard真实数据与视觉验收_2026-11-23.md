# Y3 样板｜有来原版 Dashboard 真实数据与视觉验收（2026-11-23）

分支 codex/youlai-fullstack-rebuild-20261123，唯一仓库 项目仓库。

## 已实现与验证

- 正式工作台直接启用上游 v4.13.0 的 web-next/src/views/dashboard/index.vue；删除已废弃的 business/Dashboard.vue 联调卡片并恢复 /dashboard 原版路由。
- 上游 Dashboard 样式文本完整保留。通过 SHA-256 比对 fcd096f 中原版 CSS 与当前 CSS，结果均为 1dcdc44def0bc4cc10d97243ab2990bd7f1084c0219a2a66177f38cc46bf9255。只调整内容与数据接入，不修改原版 Dashboard 样式或自造主题。
- API /api/dashboard 继续服务端 Cookie 校验。4 个原版统计卡使用专业需求、待确认需求、子项目、在办项目的实际值；实际费用趋势源于月份和金额分，切换近 6/12 个月，零值表示该月无实际发生。
- 业务概览、风险预警、项目动态分别取后端 pending_demands、alerts 和 portfolio；空数据使用原版 el-empty，不允许虚构访客、任务或审计事件。
- 原版推广外链改为业务站内链接。尚未迁移的业务链接进入明确标识的待实施页面，不表示相应模块已经完成。
- 尚未接入服务端公告的 NoticeCenter 暂从工具栏移除，避免空请求带来的“请求失败”通知。桌面产品的 760px 分屏保持桌面图标侧栏：仅将设备断点由 768 调整至 720，不修改主题或 CSS。
- 实际 Chrome 浏览器通过 Y1 集成测试：Cookie 登录及刷新恢复、实时业务摘要、原版四指标、没有演示访客、无页面错误通知。四窗口宽度 1440/1280/960/760px 均无页面横向溢出。截图保存于 test-results/youlai-y1/admin-dashboard-1440.png、admin-dashboard-1280.png、admin-dashboard-960.png、admin-dashboard-760.png。
- 有来 Node24 + pnpm 严格 TypeScript/Vite 生产构建通过。

## 尚未完成

- Y3 当前完成原版工作台和物资原版 CRUD/批量编辑样板；需求专业详情、多点位和结算全量工作表仍待迁移。完整 Y4—Y8 的 12 个模块、14 条旅程、Windows 正式/演示包及 Windows 物理实机验收均未完成。
- 本报告不将视觉验收视为所有业务已完成。服务端错误应给真实提示，禁止虚构趋势。
