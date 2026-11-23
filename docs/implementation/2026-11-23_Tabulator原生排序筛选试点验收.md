# Tabulator 6.x 原生筛选与排序｜2026-11-23

## 用户最新选择

用户明确要求完全移除此前自绘的 PMS 式列筛选弹窗，直接观察 Tabulator 原生效果。物资管理列表因此使用 Tabulator 原生 headerFilter:list（multiselect:true、clearable:true、valuesLookup 异步取值）和 headerSort（Tristate），不再渲染 ExcelColumnFilter.vue 或自绘筛选图标。

## 交互与业务边界

- 普通列表保持只读，原生表头筛选器和排序箭头与 Excel 区域选择互不干扰。
- sortMode:remote、filterMode:remote 由 Tabulator 管理原生表头交互和当前排序筛选状态，dataFiltering / dataSorting 事件转换为现有 sort/direction/grid_filters，通过 SQLite 查询；当前服务只支持单列排序，关闭多列排序。
- valuesLookup 候选值来自数据库全部筛选范围，不依赖当前30条分页；状态值映射“有效／停用”。候选项超过256种时明确报错而不是静默截断。
- Tabulator 原生 multiselect 与 autocomplete 互斥：原生多选下拉没有 PMS 式候选搜索框、候选数量统计或全选搜索结果。本轮为了让用户比较原生效果不添加自绘功能。
- 正式版本、权限、审计、普通查看／主动批量编辑双模式保持不变；其余旧 BusinessTable 页面尚未迁移。

## 真实测试

- tests/e2e/tabulator-materials-browser.mjs：65条跨页，确认原生表头多选 A型和B型得到45条；原生排序箭头 aria-sort 与 SQLite 服务端排序一致；清除条件后表头恢复；详情和列设置不回归。
- 原生多选在异步 valuesLookup 装载并绑定完毕后，点击弹窗外部提交，不再增加自定义“确定”按钮。
- Chrome 真实浏览器截图放在 test-results/schema113/native-tabulator 目录。
- Command+Z 多行粘贴撤销属于独立的键盘绑定和编辑历史问题，不能因替换筛选菜单就宣称修复；Windows 10 实机验收仍需单独进行。

## 技术债

目前 MaterialsPage 仍使用现有外部分页、URL状态和服务端列表API。Tabulator 负责原生排序筛选状态，SQLite查询仍由Vue业务层适配调用。这是真实的原生表头控件试点，而不是声称已把全系统数据请求完全迁移至 Tabulator 内部的统一 AJAX data loader。后续全系统迁移前应先统一远程筛选、分页和路由状态协议。
