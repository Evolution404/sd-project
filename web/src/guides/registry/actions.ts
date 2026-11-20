import type { GuideAction, GuideModuleId, GuideRole } from "../core/types";
import { extraGuideActions } from "./extra-actions.ts";
type CompactAction = readonly [
  id:string, title:string, purpose:string, prerequisite:string,
  result:string, risk:string, roles?:readonly GuideRole[], states?:readonly string[], target?:string,
];
const all:readonly GuideRole[]=["admin","editor","verifier","viewer"];
const write:readonly GuideRole[]=["admin","editor"];
const verify:readonly GuideRole[]=["admin","verifier"];
const admin:readonly GuideRole[]=["admin"];
const generic = "先确认当前对象、正式版本和当前账号权限";
const immutable = "操作会留下正式历史，既有批准或历史版本不能直接覆盖";
const records: ReadonlyArray<readonly [GuideModuleId|"excel",readonly CompactAction[]]> = [
 ["dashboard",[
  ["dashboard.open","查看待办","在待办理区选择对应的记录或打开该类待办清单", "当前账号有待办职责","可进入需求、项目或结算办理位置","由用户选择具体记录"],
  ["dashboard.filter","刷新工作台","重新获取待办、项目预警和资金报表", "已登录系统","显示最新读取结果","刷新仅重新读取业务数据"],
  ["dashboard.alert","查看项目预警","在需要关注区查看项目预警与差异","有预警时可点击项目名称","打开对应项目核实","预警不直接自动调整预算"],
 ]],
 ["demands",[
  ["demands.create","新增需求","记录一项待确认的现场专业需求","先有操作类型和计量单位","生成待确认正式需求版本","不能自行等同审核",write,["empty","pending"],".page-heading-actions"],
  ["demands.edit","修订需求","更新现场事实并新增不可变正式版本",generic,"创建新需求正式版本",immutable,write,["pending","active"]],
  ["demands.location-add","添加作业位置","从真实设备台账跨页多选逻辑杆塔、物理杆塔或档距","台账身份合法","加入位置及准确数量","同塔多回不得混淆",write],
  ["demands.batch","批量填写共同信息","统一填写已选位置的数量与附加属性","明确选中位置","批量更新草稿各位置","每处可独立修正，避免误覆盖",write],
  ["demands.source","维护需求来源","记录巡视、工单及其他证据来源","有正式需求草稿","形成可追溯来源","不可静默删除未涉及的来源",write],
  ["demands.material","预计物资","记录计划物资和采用单位","物资有合法版本","保存需求预计物资","不得静默折算或舍入",write],
  ["demands.confirm","确认需求有效","审核现场依据后正式确认","需求处于待确认状态","需求进入有效状态并记审计事件","需要审核权限和版本检查",verify,["pending"]],
  ["demands.return","退回或取消","记录明确原因并更新需求办理状态","当前状态允许办理","保留正式历史","取消不等于物理删除",verify],
  ["demands.link","关联子项目","选已有项目或原子新建项目承接需求","需求有效且未被其他项目承接","创建唯一当前承接关系","批准范围须另行审核",write,["active"]],
  ["demands.quote","参考价格试算","依据冻结操作和各位置属性计算价格","所需计价属性齐备","显示试算依据和覆盖范围","试算不等于正式报价或结算",write],
  ["demands.history","完整历史","核对需求版本、来源、采用操作和审核事件","需求存在","仅展示审计与正式版本","历史记录不可直接删除",all],
  ["demands.delete","删除需求","从正常列表移除可删除的当前对象","必须通过引用和状态保护","保留删除事件及既有历史","已承接或正式批准时可能受阻",admin],
 ]],
 ["projects",[
  ["projects.create","新增子项目","在年度框架内建立项目身份","年度框架存在","建立储备子项目","不等于入库或批准",write,["reserve"],".page-heading-actions"],
  ["projects.link","承接专业需求","关联有效未被其他项目承接的需求","需求正式有效","形成单一归属","不可重复承接",write],
  ["projects.stock","确认入库","将合规储备项目正式入库","项目已有合法业务范围","更新项目阶段","须经过明确确认",verify,["reserve"]],
  ["projects.approval-draft","编制立项范围","按整条需求核对全部位置和数量，再填写批准物资及预算","已入库且范围可批准","保存独立批准草稿","旧批准范围需继承并显示差异",write],
  ["projects.approve","正式批准","审核批准草稿和范围差异","具有审批权限且版本未冲突","冻结正式批准版本","预算、数量与范围变化会进入审计历史",verify,["stocked","approved"]],
  ["projects.change","编制正式变更","以最新批准为基线调整范围预算","已有批准版本","生成变更草稿","不得静默覆盖前次批准",write,["approved"]],
  ["projects.funding","维护项目资金归属","在项目档案选择年度框架及可选的同框架执行协议","协议有效且在生效期内；入库后框架锁定","记录正式资金归属；无协议时直接归属框架","额度差额不自动封顶",write],
  ["projects.quote","批准范围核价","根据正式批准范围和版本报价","覆盖全部已选择合法位置","明确参考价及规则指纹","不得对同位置重复计价",write],
  ["projects.close","结项","完成费用和结算核对后正式结项","必需的结算审核和核对已完成","冻结结项审计事实","结项前需预览尚有差异",verify,["approved"]],
  ["projects.history","完整历史","查询档案、批准、变更、费用及结项","项目存在","展示不可改写历史","不能误把草稿当已批准",all],
  ["projects.delete","删除项目","移除可删除的未受正式引用对象","完成引用保护","保留历史审计","批准及结项项目不得简单删除",admin],
 ]],
 ["frameworks",[
  ["frameworks.create","新增年度框架","建立年度执行框架与正式额度","选择财政年度","形成框架正式版本","额度不代表实际发生",write,["empty"],".page-heading-actions"],
  ["frameworks.edit","修改正式框架","修订框架名称、额度或状态","具备编辑权限和版本","新正式版本保留历史",immutable,write],
  ["frameworks.detail","查看资金概览","查看协议、项目及实际发生结算","已有框架","只读资金概况","预算占用差是参考",all],
  ["frameworks.history","框架历史","追溯正式额度与版本","框架存在","展示变更链",immutable,all],
 ]],
 ["agreements",[
  ["agreements.create","新增执行协议","在年度框架下建立额度和期限","年度框架已建立","建立协议正式身份","不得跨框架采用",write,["empty"],".page-heading-actions"],
  ["agreements.edit","编辑执行协议","修订协议正式版本","当前协议有效","新协议正式版本","历史保留且项目资金采用受控",write],
  ["agreements.projects","查看关联子项目","核查项目归属及额度差","协议与项目存在","导航到所属项目","额度差不自动限制项目合法费用",all],
  ["agreements.history","执行协议历史","查看合同号、额度和生效期历史","协议存在","只读正式历史",immutable,all],
 ]],
 ["finance",[
  ["finance.project-mode","按项目办理","进入项目费用科目、实际费用和分次结算","项目存在","定位项目完整财务流程","跨项目查询不代表可直接办理",all,["any"],".finance-work-mode"],
  ["finance.cross","跨项目查询","独立查看费用、结算、核对记录","有读取权限","显示单据当前正式版本","不得误把记录身份当项目身份",all],
  ["finance.cost","核定费用","记录真实发生费用与科目及依据","项目和费用科目合法","产生正式费用记录","实际费用不等同批准预算",verify],
  ["finance.settlement-draft","新增结算草稿","按项目总额填本次金额，或按子费用填明细；需求解决量选填","子项目已批准并采用本项目的正式批准版本","保存独立结算草稿","结算批准后才更新项目已结金额",write],
  ["finance.submit","提交结算审核","提交独立结算草稿供审核","金额有效；如填解决量须符合采用的批准版本","进入审核办理阶段","不允许无权限自审",write],
  ["finance.approve","审核结算","按身份审核金额和解决数量","存在待审核结算","生成正式结算版本","多次部分结算须分笔追溯",verify],
  ["finance.reconcile","费用核对","比较实际费用与正式已批结算","相关正式单据存在","生成核对事实","超量和差额要明确列示",verify],
  ["finance.void","撤销或注销单据","处理可撤回的费用或结算","业务版本允许","产生撤销事件","正式历史保留",verify],
  ["finance.history","单据历史","核对每次结算、审核和修订","单据存在","展示所有版本和审核身份","不可将历史覆盖",all],
 ]],
 ["ledger",[
  ["ledger.line","新增线路","登记输电线路与电压等级","已有电压等级","形成线路身份","不得凭重名猜测设备",admin,["empty"],".page-heading-actions"],
  ["ledger.physical","物理杆塔","维护真实物理资产身份","核实现场和台账中对应的设备身份","建立物理杆塔","共塔多回须复用实物",admin],
  ["ledger.logical","逻辑杆塔","在线路内配置杆塔号和实物关联","线路存在","建立线路-杆塔逻辑身份","与物理杆塔不能互换",admin],
  ["ledger.span","档距","登记首尾逻辑杆塔和档距长度","相邻杆塔真实存在","建立档距身份","长度统一米展示但底层高精度",admin],
  ["ledger.replace","整基更换","更换物理杆塔并保护历史引用","已确认更换事实","生成新的正式物理身份","不能直接修改历史设备",admin],
  ["ledger.history","设备历史","追溯线路、杆塔、档距沿革","设备存在","显示冻结身份和事件",immutable,all],
 ]],
 ["materials",[
  ["materials.create","新增物资","创建型号规格和计量单位","计量单位已经配置","新增物资主数据","作业对象与物资不是同一身份",admin,["empty"],".page-heading-actions"],
  ["materials.edit","维护物资版本","修订名称、型号和规格","当前物资存在","保存新版本","既有需求采用的物资版本不受改写",admin],
  ["materials.disable","停用或删除物资","限制未来选择但保留历史关联","完成引用保护","不再正常可选","已引用物资不能抹除历史",admin],
  ["materials.history","物资历史","查看历史采用版本","物资存在","只读历史版本",immutable,all],
 ]],
 ["standards",[
  ["standards.object","新增作业对象","配置对象位置（本体/通道）与归属单元（物理/逻辑杆塔）","明确工作对象","创建正式对象","物资与对象不可混同",admin,["empty"],".page-heading-actions"],
  ["standards.operation","新增操作类型","采用作业对象正式版本，并配置固定计量单位及录入模板","作业对象和单位存在","生成操作正式版本","后续修改不回写既有需求",admin],
  ["standards.attribute","添加附加属性","定义需求级或位置级的八种字段类型","操作类型草稿可编辑","附加属性纳入唯一操作定义","需明确是否计价及必要性",admin],
  ["standards.version","操作版本历史","查看冻结的对象版本、单位及统一附加属性定义","操作版本存在","展示正式版本和影响","正式定义不可直接覆盖",all],
  ["standards.delete","删除操作类型","停用未被保护的操作","引用关系允许","移出新建选项","已有需求历史仍使用冻结版本",admin],
 ]],
 ["pricing",[
  ["pricing.create","新增参考价格规则","设置适用条件与计价模型","操作类型正式版本存在","创建可用规则","不要重复条件或覆盖错误范围",admin,["empty"],".page-heading-actions"],
  ["pricing.condition","适用条件","按操作和统一属性限定价格","属性定义合法且参与计价","明确价格命中范围","不计价字段不应影响价格",admin],
  ["pricing.preview","保存前检查与试算","校验必需属性和金额规则","规则信息完整","只读显示试算结果","试算不等于正式业务报价",admin],
  ["pricing.history","价格规则历史","追溯版本与适用范围","规则存在","保留旧报价依据",immutable,all],
  ["pricing.delete","停用或删除规则","阻止未来使用已失效价格","已有引用和正式历史可追溯","规则不可再用于新报价","不能改变既有已确认金额",admin],
 ]],
 ["dictionaries",[
  ["dictionaries.voltage","电压等级","创建或维护真实电压等级","管理员权限","可用于线路","不得使用错误电压关联",admin,["empty"],".page-heading-actions"],
  ["dictionaries.unit","计量单位","设置单位名称和0～4位正式精度","确定数量计量方式","形成单位正式版本","不得静默舍入",admin],
  ["dictionaries.tower-nature","杆塔性质","维护物理杆塔的受控性质选项，内置耐张、直线","先核对基础数据已有选项","保存字典正式新版本供物理杆塔引用","停用不删除已关联杆塔及历史",admin],
  ["dictionaries.tower-material","杆塔材质","维护物理杆塔的受控材质选项，内置角钢塔、钢管杆","先核对现有杆塔材质的名称","保存材质正式新版本供物理杆塔和参考价格规则使用","字段替代原塔型自由文本，名称变更不可影响历史引用",admin],
  ["dictionaries.organization","归口单位","维护组织树和层级关系","组织关联可核实","形成组织正式版本","移动需要单独的历史与影响预览",admin],
  ["dictionaries.category","类别及优先级","维护项目和需求可选类别","管理员权限","形成基础数据选项","删除引用须受限",admin],
  ["dictionaries.history","字典历史","查看引用及版本变更","对象存在","仅展示正式历史",immutable,all],
 ]],
 ["system",[
  ["system.user","用户账号","创建或管理账号角色","管理员授权","账号和权限生效","不得删除最后管理员",admin,["any"],".page-heading-actions"],
  ["system.ip","IP访问策略","调整内网IP白名单和启停","明确当前可连接来源","服务端访问策略版本更新","即使关闭IP限制仍需登录鉴权",admin],
  ["system.audit","操作审计","检索操作人、业务身份和正式变更","具备审计权限","展示可追溯事件","无法通过帮助删除审计",admin],
  ["system.password","账号密码","按安全策略修改或重置账号凭据","确认授权身份","更新凭据及会话策略","禁止将密码写入教程进度",admin],
 ]],
 ["excel",[
  ["excel.template","下载Excel模板","下载包含稳定关联号与中文表头的正式模板","当前模块有Excel入口","下载本地xlsx","不可凭物理行号关联",all,["any"],".page-heading-actions"],
  ["excel.import","上传文件","解析工作簿、识别新增/变更及动态属性","文件结构合法","生成本批次候选数据","上传不等于正式入库",write],
  ["excel.preview","预检","执行服务端业务规则和版本冲突检查","成功解析候选文件","生成问题、差异清单","预检必须零正式写入",write],
  ["excel.issues","问题清单","逐个定位字段及身份歧义","预检完成","下载可修复清单","修正后必须重传重新预检",write],
  ["excel.atomic","整批原子提交","合法单据整批成功或整批回滚","全批可提交且版本未冲突","提交当前批次","任何不合法单据会阻断整批",write],
  ["excel.partial","合法部分提交","只提交合法的单据","明确风险并核对失败单据","生成部分正式结果","不能悄悄丢弃失败记录",write],
  ["excel.retry","纠错重传","修正问题后再次生成预检","上批失败结果保留","合法记录幂等处理","不能重复生成相同需求",write],
  ["excel.result","下载结果与回查","根据正式编号和关联号核实提交结果","有合法提交","下载正式结果清单","正式结果应与数据库一致",all],
 ]],
];
const defaultCourses:Readonly<Record<GuideModuleId|"excel",readonly string[]>>={
  dashboard:["L01"],demands:["L04","L05","L11"],projects:["L06","L07","L10"],
  frameworks:["L06"],agreements:["L06"],finance:["L08","L09","L10"],
  ledger:["L02"],materials:["L02"],standards:["L01","L03"],
  pricing:["L03"],dictionaries:["L01"],system:["L12"],excel:["L11"],
};
const baseGuideActions:readonly GuideAction[] = records.flatMap(([module,actions]) =>
  actions.map(([id,title,purpose,prerequisite,result,risk,roles,states,target]) => ({
    id,module,title,aliases:[],purpose,prerequisite:prerequisite||generic,result,risk,
    roles:roles||all,states:typeof states==="string"?[states]:states||["any"],
    target:target||"",courseIds:defaultCourses[module],
  })));

export const guideActions:readonly GuideAction[] = [...baseGuideActions,...extraGuideActions];
