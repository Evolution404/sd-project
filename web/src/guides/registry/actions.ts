import type { GuideAction, GuideModuleId, GuideRole } from "../core/types";
import { extraGuideActions } from "./extra-actions.ts";
import { nativeGuideActions } from "./native-actions.ts";
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
  ["dashboard.open","进入业务模块","使用工作台顶部快捷入口进入专业需求、子项目或费用与结算", "当前账号具有相应入口权限","打开相应业务列表","由用户选择具体记录"],
  ["dashboard.filter","切换费用趋势区间","选择实际费用趋势的统计月份区间", "已登录系统","切换图表统计区间","图表是只读汇总，不会变更费用"],
  ["dashboard.alert","查看项目预警","在需要关注区查看项目预警与差异","需要进一步核实时，通过子项目列表按项目名称检索","通过项目详情核实","预警不直接自动调整预算"],
 ]],
 ["demands",[
  ["demands.export-selection","导出所选需求","导出已明确勾选的需求","取消选择已删除记录，一次最多 100 条","下载所选需求的 Excel","核对所选范围再交接",all],
  ["demands.batch-confirm","批量确认需求","预检已选需求再正式确认","已选记录包括待确认需求","成功记录进入待承接，其他记录保留供核对","先读无法办理的原因",verify],
  ["demands.batch-link","批量承接需求","为多个待承接需求选择同一项目","需求已确认且尚无承接项目","按预检结果建立整条承接关系","当前归属仍在提交时复核",write],
  ["demands.duplicate-check","核对疑似重复","逐条比对正式需求与当前录入位置","打开疑似重复面板后核对正式记录","只勾选已人工复核的结论","若确实重复，请返回继续修改",write],
  ["demands.duplicate-back","返回继续修改","带原草稿回到需求表单","疑似重复面板已打开","可调整重复位置或说明","原草稿保持",write],
  ["demands.duplicate-save","确认独立并保存","证明新需求属于另一项确切任务","逐条核对并填写独立保留依据","保存正式需求及复核原因","系统在正式提交时重新检查",write],
  ["demands.create","新增需求","记录一项待确认的现场专业需求","先有操作类型和计量单位","生成待确认正式需求版本","不能自行等同审核",write,["empty","pending"],".page-heading-actions"],
  ["demands.edit","修订需求","更新现场事实并新增不可变正式版本",generic,"创建新需求正式版本",immutable,write,["pending","returned","active"]],
  ["demands.location-add","添加作业位置","从真实设备台账跨页多选逻辑杆塔、物理杆塔或档距","台账身份合法","加入位置及准确数量","同塔多回不得混淆",write],
  ["demands.batch","批量填写共同信息","统一填写已选位置的数量与附加属性","明确选中位置","批量更新草稿各位置","每处可独立修正，避免误覆盖",write],
  ["demands.source","维护需求来源","记录巡视、工单及其他证据来源","有正式需求草稿","形成可追溯来源","不可静默删除未涉及的来源",write],
  ["demands.material-batch-edit","直接编辑预计物资","进入预计物资页签直接填写通用工作表","需求草稿已有预计物资","支持粘贴、填充及撤销草稿","禁止修改单位和物资身份，须正式保存需求",write],
  ["demands.material-finish-edit","完成预计物资录入","切换页签或保存需求，结束当前工作表单元格编辑","预计物资数量通过冻结计量单位精度校验","保留尚未保存的草稿；保存需求才创建正式版本","不得将结束编辑等同正式保存",write],
  ["demands.material","预计物资","记录计划物资和采用单位","物资有合法版本","保存需求预计物资","不得静默折算或舍入",write],
  ["demands.confirm","确认需求有效","审核现场依据后正式确认","需求待确认或已退回","需求进入有效状态并记审计事件","需要审核权限和版本检查",verify,["pending","returned"]],
  ["demands.return","退回修改","把已确认但未承接的需求退回补正","在需求详情选择「退回需求」。已承接的需求不能直接退回，须遵守承接及项目生命周期规则","保留原版本和退回办理事件","退回后经修订和重新确认才能承接",verify,["active"]],
  ["demands.cancel","取消需求","终止未承接需求","在需求详情选择「取消需求」。须核对承接关系","需求进入已取消，可查看历史","已有承接时须先按项目规则处理关联",verify],
  ["demands.link","关联子项目","选已有项目或原子新建项目承接需求","需求有效且未被其他项目承接","创建唯一当前承接关系","批准范围须另行审核",write,["active"]],
  ["demands.quote","参考价格试算","依据冻结操作和各位置属性计算价格","所需计价属性齐备","显示试算依据和覆盖范围","试算不等于正式报价或结算",write],
  ["demands.history","历史记录","对比需求版本，查看承接、正式参考报价及来源","需求存在","仅展示审计与正式版本","历史记录不可直接删除",all],
  ["demands.delete","删除需求","从正常列表移除可删除的当前对象","必须通过引用和状态保护","保留删除事件及既有历史","已承接或正式批准时可能受阻",admin],
 ]],
 ["projects",[
  ["projects.export-selection","导出所选项目","导出明确选择的项目","取消选择已删除记录，一次最多 100 条","下载项目筛选数据","项目可能选自多页，请核对范围",all],
  ["projects.batch-stock","批量入库","预检后办理选中的储备项目","至少有一条有效储备项目","成功项目入库并锁定年度框架","未通过项继续保留",verify],
  ["projects.add-candidate","新增候选需求","在变更草稿加入待采用的完整需求","选择已确认且未被承接的完整需求","批准后才建立正式承接关系","提交时重新核对归属与正式需求版本",write],
  ["projects.reload-closure","重新读取结项核对","刷新结项阻塞、未解决量及金额差额","当前结项核对已打开","按最新正式事实更新结项预览","请核对变化后再确认",verify],
  ["projects.create","新增子项目","在年度框架内建立项目身份","年度框架存在","建立储备子项目","不等于入库或批准",write,["reserve"],".page-heading-actions"],
  ["projects.link","承接专业需求","关联有效未被其他项目承接的需求","待确认需求可先关联储备项目，确认有效后才能正式立项","形成单一归属","不可重复承接",write],
  ["projects.stock","确认入库","将合规储备项目正式入库","项目已有合法业务范围","更新项目阶段","须经过明确确认",verify,["reserve"]],
  ["projects.approval-draft","编制立项范围","按整条需求核对全部位置和数量，再填写批准物资及预算","已入库且范围可批准","保存独立批准草稿","旧批准范围需继承并显示差异",write],
  ["projects.approve","正式批准","审核批准草稿和范围差异","具有审批权限且版本未冲突","冻结正式批准版本","预算、数量与范围变化会进入审计历史",verify,["stocked","approved"]],
  ["projects.change","编制正式变更","以最新批准为基线调整范围预算","已有批准版本","生成变更草稿","不得静默覆盖前次批准",write,["approved"]],
  ["projects.funding","维护项目资金归属","在项目档案选择年度框架及可选的同框架执行协议","协议有效且在生效期内；入库后框架锁定","记录正式资金归属；无协议时直接归属框架","额度差额不自动封顶",write],
  ["projects.quote","批准范围核价","根据正式批准范围和版本报价","覆盖全部已选择合法位置","明确参考价及规则指纹","不得对同位置重复计价",write],
  ["projects.release","解除承接","解除一条需求与该项目的当前承接关系","打开项目的「承接需求」，核对具体需求。已正式批准项目在正式结项前不得解除承接，即使变更移出范围也不得提前释放；储备阶段按服务端规则办理","保留旧承接及批准历史","结项按实际解决数量释放剩余工作量，历史批准及原需求身份仍保留",write],
  ["projects.close","结项","完成费用和结算核对后正式结项","必需的结算审核和核对已完成","冻结结项审计事实","结项前需预览尚有差异",verify,["approved"]],
  ["projects.history","完整历史","查询档案、批准、变更、费用及结项","项目存在","展示不可改写历史","不能误把草稿当已批准",all],
  ["projects.delete","删除项目","移除可删除的未受正式引用对象","完成引用保护","保留历史审计","批准及结项项目不得简单删除",admin],
 ]],
 ["frameworks",[
  ["frameworks.delete","删除年度框架","提交年度框架删除预检","先核对引用项目和执行协议","通过状态和引用核对后登记删除","确认页面显示实际影响范围",admin],
  ["frameworks.projects","查看框架关联项目","从本框架打开关联项目概览","先打开框架并选具体项目","进入项目概览","可返回原框架",all],
  ["frameworks.finance","打开框架项目财务","查看所选项目的费用与结算","选择框架下的具体项目","进入该项目财务工作区","办理仍按账号权限",all],
  ["frameworks.create","新增年度框架","建立年度执行框架与正式额度","选择财政年度","形成框架正式版本","额度不代表实际发生",write,["empty"],".page-heading-actions"],
  ["frameworks.edit","修改正式框架","修订框架名称、额度或状态","具备编辑权限和版本","新正式版本保留历史",immutable,write],
  ["frameworks.detail","查看资金概览","查看协议、项目及实际发生结算","已有框架","只读资金概况","预算占用差是参考",all],
  ["frameworks.history","框架历史","追溯正式额度与版本","框架存在","展示变更链",immutable,all],
 ]],
 ["agreements",[
  ["agreements.delete","删除执行协议","提交执行协议删除预检","先核对受影响项目和历史引用","通过状态和引用核对后登记删除","确认页面显示实际影响范围",admin],
  ["agreements.finance","打开协议项目财务","查看所选协议项目的费用与结算","先选择协议下的具体项目","进入该项目财务工作区","办理仍按账号权限",all],
  ["agreements.create","新增执行协议","在年度框架下建立额度和期限","年度框架已建立","建立协议正式身份","不得跨框架采用",write,["empty"],".page-heading-actions"],
  ["agreements.edit","编辑执行协议","修订协议正式版本","当前协议有效","新协议正式版本","历史保留且项目资金采用受控",write],
  ["agreements.projects","查看关联子项目","核查项目归属及额度差","协议与项目存在","导航到所属项目","额度差不自动限制项目合法费用",all],
  ["agreements.history","执行协议历史","查看合同号、额度和生效期历史","协议存在","只读正式历史",immutable,all],
 ]],
 ["finance",[
  ["finance.settlement-section","定位结算单","定位项目财务中的结算单分区","打开项目费用与结算工作区","滚动到项目结算列表","办理按具体单据状态和权限",all],
  ["finance.reconciliation-section","逐笔对账","打开本单已批准明细的对账记录","从结算列表打开按子费用批准的结算单","展示本单的对账记录","逐笔对账按实际管理需要办理",all],
  ["finance.categories","费用科目","打开项目费用科目维护区","切换到项目财务中的实际费用","展示科目层级与关联费用","按项目总额结算可直接填整单金额",all],
  ["finance.reload-approvals","重新读取批准历史","恢复结算表单采用的正式批准版本选项","结算草稿打开且批准历史读取失败","重新读取合法版本并保留录入","只有选用本项目正式批准版本才可提交",write],
  ["finance.project-mode","按项目办理","进入项目费用科目、实际费用和分次结算","项目存在","定位项目完整财务流程","跨项目查询不代表可直接办理",all,["any"],".finance-work-mode"],
  ["finance.cross","跨项目查询","独立查看费用、结算、核对记录","有读取权限","显示单据当前正式版本","不得误把记录身份当项目身份",all],
  ["finance.cost","核定费用","记录真实发生费用与科目及依据","项目和费用科目合法","产生正式费用记录","实际费用不等同批准预算",verify],
  ["finance.settlement-draft","新增结算","按项目总额填本次金额，或按子费用填明细；需求解决量选填","子项目已批准并采用本项目的正式批准版本","保存独立结算草稿","结算批准后才更新项目已结金额",write],
  ["finance.submit","提交结算审核","提交独立结算草稿供审核","金额有效；如填解决量须符合采用的批准版本","进入审核办理阶段","不允许无权限自审",write],
  ["finance.approve","审核结算","审核整单金额、净变化和选填解决量","打开待审核结算的审核页","当前批准版本计入项目已结金额","分期结算按各单据分别追溯",verify],
  ["finance.return","退回结算","把待审核结算退回补正并记录原因","进入单据审核页，填写审核意见","待审版本退回，原已批准金额继续有效","原批准金额继续计入项目进度",verify],
  ["finance.resubmit","原版重新提交","对比退回意见，按原版本重新送审","结算已退回且没有修订草稿，在对应结算行办理","沿用同一正式版本，产生新的提交事件","需要改金额或明细时请修订结算",write],
  ["finance.revise-settlement","修订结算","按原单内容建立下一版草稿","打开对应结算行。结算待审核期间禁止修订","新版本保存影响说明并重新送审","原已批准金额在新版批准前继续有效",write],
  ["finance.withdraw-settlement","撤回结算草稿","结束当前未提交草稿","进入结算审核办理，核对草稿身份","保留撤回历史和原批准版本","已经提交待审核的单据须走审核流程",write],
  ["finance.reconcile","新增正式核对","配对实际费用与本单已批准的结算明细","进入该项目的费用核对办理区","登记对应金额及依据","结算进度按批准预算计算",verify],
  ["finance.void","撤销或注销单据","处理可撤回的费用或结算","业务版本允许","产生撤销事件","正式历史保留",verify],
  ["finance.history","单据历史","核对每次结算、审核和修订","单据存在","展示所有版本和审核身份","不可将历史覆盖",all],
 ]],
 ["ledger",[
  ["ledger.bulk","批量维护设备资料","选定当前页或勾选设备后进入独立工作表","管理员；最多100条可维护设备","校验版本并原子生成正式设备版本","身份、同杆、拓扑、状态及历史不可批量修改",admin],
  ["ledger.bulk-save","保存设备批量修改","统一校验所有编辑并提交","核对正式字典与数量精度","一次事务写入全部变化","任一失败整批回滚，保留草稿",admin],
  ["ledger.line","新增线路","登记输电线路与电压等级","已有电压等级","形成线路身份","不得凭重名猜测设备",admin,["empty"],".page-heading-actions"],
  ["ledger.physical","物理杆塔","维护真实物理资产身份","核实现场和台账中对应的设备身份","建立物理杆塔","共塔多回须复用实物",admin],
  ["ledger.logical","逻辑杆塔","在线路内配置杆塔号和实物关联","线路存在","建立线路-杆塔逻辑身份","与物理杆塔不能互换",admin],
  ["ledger.span","档距","登记首尾逻辑杆塔和档距长度","相邻杆塔真实存在","建立档距身份","长度统一米展示但底层高精度",admin],
  ["ledger.replace","整基更换","更换物理杆塔并保护历史引用","已确认更换事实","生成新的正式物理身份","不能直接修改历史设备",admin],
  ["ledger.history","设备历史","追溯线路、杆塔、档距沿革","设备存在","显示冻结身份和事件",immutable,all],
 ]],
 ["materials",[
  ["materials.create","新增物资","创建型号规格和计量单位","计量单位已经配置","新增物资主数据","作业对象与物资不是同一身份",admin,["empty"],".page-heading-actions"],
  ["materials.batch-edit","批量编辑物资","切换到 Excel 式批量编辑草稿","管理员且物资列表非空，不包含已删除记录","进入当前页的可编辑草稿","未点击确认保存不会写入正式物资版本，计量单位和状态不能直接改动",admin],
  ["materials.batch-save","保存批量修改","逐条校验后事务性保存物资新正式版本","当前页有合法编辑变更且管理员确认","全部变更成功或全部回滚","每条仍检查正式版本，不允许部分成功",admin],
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
  ["pricing.preview","试算","校验必需属性和金额规则","规则信息完整","只读显示试算结果","试算不等于正式业务报价",admin],
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
  ["excel.template","下载模板","下载带填写示例的 Excel 文件","当前模块支持导入 Excel","打开文件，从第一张业务表开始填写","同一条需求及其位置请填写相同的组号",all,["any"],".page-heading-actions"],
  ["excel.import","导入 Excel","添加或修改文件中的业务记录","已按模板或已下载的修改表填写","可以检查和保存本次改动","保存前可以重新上传修正后的文件",write],
  ["excel.preview","选择 Excel 文件","上传工作簿并检查填写内容","已填好本次需导入的记录","显示可以保存及需要处理的记录","检查后由用户确认保存",write],
  ["excel.issues","下载问题清单","按工作表、行号和字段查看如何修改","文件有需要处理的内容","下载错误位置及修改建议","修正后重新上传",write],
  ["excel.atomic","有问题时整批暂不保存","等待所有记录都检查通过后再保存","所有记录已检查通过","保存本次全部记录","可下载标出错误的原表继续修正",write],
  ["excel.partial","先保存已通过的记录","先处理本次文件里已检查通过的记录","展开导入选项，取消勾选整批暂不保存","保存已通过的记录，并列出待处理项","下载待处理记录后继续修正",write],
  ["excel.retry","重新上传","检查已修正的工作簿","按问题提示修正原表","显示可以保存的记录","已处理的文件可以打开上次结果",write],
  ["excel.result","下载导入结果","查看本次新增、修改或待处理的记录","已有保存结果","下载结果清单","可点击列表中的编号打开业务记录",all],
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

export const guideActions:readonly GuideAction[] = [...baseGuideActions,...extraGuideActions,...nativeGuideActions];
