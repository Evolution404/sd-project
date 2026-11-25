import type { GuideModule, GuideModuleId, GuideStep } from "../core/types";

const configuration: ReadonlyArray<{
  id: GuideModuleId; title: string; summary: string;
  task: string; risk: string;
}> = [
  { id:"dashboard", title:"工作台", summary:"集中查看待办、进度、预警和资金概况。", task:"从待办事项定位有权办理的正式业务", risk:"预警与汇总是查询信息，不等同正式批准或结算" },
  { id:"demands", title:"专业需求", summary:"先记录现场问题、作业位置和工作量，再由有权人员确认与项目承接。", task:"创建多位置需求、确认、查看正式采用版本", risk:"保存需求版本不等同审核确认；操作类型与单位版本冻结" },
  { id:"projects", title:"子项目管理", summary:"管理需求承接、入库、正式批准与变更、费用结项和全部历史。", task:"承接需求并编制正式范围", risk:"批准范围、预算及数量的变更会形成新的正式版本" },
  { id:"frameworks", title:"年度框架", summary:"统筹年度额度和下属协议、项目预算执行情况。", task:"建立年度框架并查询执行占用", risk:"额度差额为参考值，不替代正式费用和合同管理" },
  { id:"agreements", title:"执行协议", summary:"维护归属年度框架、额度、期限及关联子项目。", task:"创建执行协议并与同框架子项目关联", risk:"协议额度和项目实际发生金额不得混为一谈" },
  { id:"finance", title:"费用与结算", summary:"以子项目为主线办理真实费用、独立结算单和费用核对。", task:"分别核定费用、编制多次结算并审核", risk:"草稿、已审核结算和费用核对是不同正式业务事实" },
  { id:"ledger", title:"输电设备台账", summary:"维护线路、物理杆塔、逻辑杆塔和档距等真实设备身份。", task:"建立线路与杆塔并核实共塔多回身份", risk:"物理杆塔与逻辑杆塔不可混淆；历史引用需要保护" },
  { id:"materials", title:"物资管理", summary:"维护物资名称、型号、规格、计量单位及采用版本。", task:"新建物资并维护正式版本", risk:"停用或删除不应破坏既有业务的冻结引用" },
  { id:"standards", title:"作业标准", summary:"配置作业对象、操作类型、固定计量单位和统一附加属性。", task:"设置操作类型并配置需求级和位置级属性", risk:"正式操作版本不可被后续配置静默覆盖" },
  { id:"pricing", title:"参考价格", summary:"用适用条件、计价方式和正式采用属性试算参考报价。", task:"新建价格规则并试算、确认正式参考报价", risk:"参考价格不是合同结算；禁止重复计价和静默补价" },
  { id:"dictionaries", title:"基础数据", summary:"管理计量单位、电压等级、杆塔性质、杆塔材质、组织、类别和优先级等基础事实。", task:"按需补齐被当前业务引用的配置", risk:"冻结单位精度和组织历史不应被新版本悄悄改写" },
  { id:"system", title:"系统管理", summary:"维护账号权限、IP访问限制和操作审计。", task:"管理账号授权与访问策略", risk:"权限控制属于服务端；关闭IP限制不取消登录鉴权" },
];
const overviewSteps = (item: typeof configuration[number]): GuideStep[] => [
  { id:item.id+".purpose", title:"本页面用于什么",description:item.summary,target:".page-heading" },
  { id:item.id+".navigation",title:"业务功能区域",description:"这里按当前业务身份和状态展示相关分区和操作。部分内容可能需要切换页签查看。",target:".el-tabs__header" },
  { id:item.id+".primary",title:"从主要操作开始",description:item.task+"。无权执行的动作会显示禁用状态，不能通过本教程绕过。",target:".page-heading-actions" },
  { id:item.id+".list",title:"查询、筛选与查看",description:"先定位业务对象，再使用详情、列表行操作和正式历史核实当前状态。",target:".business-table-grid .el-table__header-wrapper" },
  { id:item.id+".safety",title:"正式历史与风险",description:item.risk+"。本导览只显示说明，不会执行任何业务变更。",target:"" },
];
export const guideModules: readonly GuideModule[] = configuration.map(item => ({
  id:item.id,title:item.title,summary:item.summary,routeName:item.id,steps:overviewSteps(item),
}));
export function guideModuleForRoute(routeName:string): GuideModule | undefined {
  return guideModules.find(item => item.routeName===routeName);
}
