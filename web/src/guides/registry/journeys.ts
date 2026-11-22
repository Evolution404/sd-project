import type { GuideCourse } from "../core/types";
export const guideCourses: readonly GuideCourse[] = [
  {id:"L01",title:"基础配置",roles:["admin"],routeName:"dictionaries",purpose:"配置单位、组织、字典及作业对象",checkpoint:"有效计量单位拥有明确的正式数量精度",instructions:["建立计量单位并设定0～4位精度","维护杆塔性质（耐张、直线）与材质（角钢塔、钢管杆）、组织及字典","前往作业标准配置作业对象","检查正式版本后再进入设备阶段"]},
  {id:"L02",title:"设备与物资",roles:["admin","editor"],routeName:"ledger",purpose:"建立设备身份和物资主数据",checkpoint:"真实线路、杆塔、档距和物资存在合法关联",instructions:["创建电压等级和线路","按物理身份建立杆塔，明确共塔关系","建立档距并核对长度单位","进入物资管理添加物资及正式单位"]},
  {id:"L03",title:"作业和计价",roles:["admin"],routeName:"standards",purpose:"配置操作版本、附加属性与参考价格",checkpoint:"正式操作版本和有效价格规则可用",instructions:["建立作业对象和操作类型","核对对象位置、归属单元及基本定义中的固定计量单位","配置需求级与位置级属性","建立价格规则，进行试算并确认适用条件"]},
  {id:"L04",title:"专业需求",roles:["editor","admin"],routeName:"demands",purpose:"创建并修订多位置需求",checkpoint:"需求正式版本固定操作、设备和准确数量",instructions:["新增专业需求并选择操作类型","选取跨线路多个位置","批量填写工作量，再逐位置调整","保存需求版本并检查详情与来源"]},
  {id:"L05",title:"确认需求",roles:["verifier","admin"],routeName:"demands",purpose:"由审核人员确认需求正式有效",checkpoint:"需求状态有效、事件序号及正式历史正确",instructions:["进入待确认需求的详情","核对现场依据和数量精度","使用正式确认操作","检查有效状态和审核人历史"]},
  {id:"L06",title:"年度框架与承接",roles:["admin","editor"],routeName:"frameworks",purpose:"建立框架、协议、子项目及单一需求承接",checkpoint:"执行协议归属框架，需求唯一当前子项目",instructions:["建立年度框架和额度","建立同框架执行协议","从需求详情创建子项目并承接","检查项目资金归属和唯一承接"]},
  {id:"L07",title:"批准与正式变更",roles:["editor","verifier","admin"],routeName:"projects",purpose:"入库、批准完整需求及后续变更",checkpoint:"存在经有权人员审核的正式批准版本",instructions:["在项目概览确认入库","选择整条需求纳入批准范围，核对全部位置和工作量","审核人核对差异并正式批准","编辑正式变更，确认旧版本不被改写"]},
  {id:"L08",title:"真实费用",roles:["editor","verifier","admin"],routeName:"finance",purpose:"核定费用归属、科目和实际金额",checkpoint:"正式费用记录与项目、科目正确关联",instructions:["进入项目费用与结算","维护费用科目树","录入实际费用和证据","通过合法角色核定真实费用"]},
  {id:"L09",title:"多次部分结算",roles:["editor","verifier","admin"],routeName:"finance",purpose:"进行至少两次独立结算并审核",checkpoint:"存在两份不同身份的正式已批准结算",instructions:["编制第一份结算草稿，按项目总额填金额或按子费用录入明细","提交，由审核人员正式审核","按本期实际业务编制第二份结算","检查两份正式单据、累计已结金额与项目结算进度"]},
  {id:"L10",title:"费用核对与结项",roles:["editor","verifier","admin"],routeName:"finance",purpose:"正式核对差异并结项",checkpoint:"正式核对和项目结项历史可追溯",instructions:["核对实际费用、结算与预算差异","记录正式核对依据","查看结项前差异预览","由有权人员结项并检查历史"]},
  {id:"L11",title:"修正 Excel 导入问题",roles:["editor","admin"],routeName:"demands",purpose:"从下载模板到修正错误、保存和查看记录",checkpoint:"完成检查并保存后，可打开已导入的记录",instructions:["下载模板，根据示例填写需求和作业位置","选择 Excel 文件，按工作表和行号查看需要处理的问题","下载标出错误的原表，按修改建议修正后重新上传","确认检查结果后保存，点击业务编号打开记录"]},
  {id:"L12",title:"权限与正式审计",roles:["admin","viewer"],routeName:"system",purpose:"查看权限和业务历史，验证越权拦截",checkpoint:"服务端403与正式业务审计链均得到核验",instructions:["管理员查看账号授权和IP策略","只读人员查看已批准项目与需求历史","验证无权业务修改被服务端拒绝","核对审计记录及历史事件身份"]},
];
