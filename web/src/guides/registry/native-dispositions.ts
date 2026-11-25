/**
 * Original legacy help identities whose exact control is absent from the production UI.
 * These entries are never counted as direct anchors. Delegation is explanatory only.
 * Missing business controls are disclosed rather than silently treated as implemented.
 */
export interface GuideDisposition { kind:"delegated"|"unavailable"; reason:string; target?:string }
export const nativeGuideDispositions:Readonly<Record<string,GuideDisposition>>={
 "demands.material-batch-edit":{kind:"delegated",target:"demands.material",reason:"预计物资页签直接进入统一工作表，不再额外开启旧批量模式。"},
 "demands.material-finish-edit":{kind:"delegated",target:"common.draft-grid",reason:"通过结束单元格编辑、切换页签或正式保存结束录入，不再有独立完成编辑按钮。"},
 "demands.batch-link":{kind:"delegated",target:"demands.link-submit",reason:"在子项目详情打开关联完整专业需求，跨页勾选后原子提交；不是在需求列表执行。"},
 "demands.batch":{kind:"delegated",target:"common.draft-grid",reason:"在作业位置工作表编辑、粘贴数量、作业方式和手工附加属性；设备台账派生值只读。"},
 "demands.link":{kind:"delegated",target:"projects.link",reason:"关联已有项目须在项目详情办理；从需求详情可创建项目并承接。"},
 "demands.quote":{kind:"delegated",target:"projects.quote",reason:"新版参考核价在项目批准范围中办理，需求列表无独立报价入口。"},
 "demands.delete":{kind:"unavailable",reason:"新版需求详情提供取消需求，不提供独立删除按钮；取消不是删除。"},
 "projects.release":{kind:"unavailable",reason:"新版不提供手工解除承接按钮；正式结项按实际解决量释放剩余需求，禁止通过变更提前释放。"},
 "projects.delete":{kind:"unavailable",reason:"新版子项目页面未提供删除项目入口。"},
 "frameworks.finance":{kind:"delegated",target:"projects.finance",reason:"在框架的项目资金详情选择关联项目，再从项目详情进入费用与结算。"},
 "agreements.finance":{kind:"delegated",target:"projects.finance",reason:"在协议的项目资金详情选择关联项目，再从项目详情进入费用与结算。"},
 "standards.delete":{kind:"unavailable",reason:"新版作业标准未提供删除操作类型按钮；修订定义的状态不是删除历史。"},
 "pricing.delete":{kind:"delegated",target:"pricing.retire",reason:"新版价格编辑可选择停用并保存正式规则，未提供独立删除规则按钮；停用不是删除。"},
 "excel.partial":{kind:"delegated",target:"excel.atomic",reason:"在检查结果取消勾选「有问题时，整批暂不保存」，核对可保存记录后明确提交。"},
 "demands.source-correct":{kind:"unavailable",reason:"新版需求来源只读展示和补充来源；没有独立来源更正入口。"},
 "demands.source-delete":{kind:"unavailable",reason:"新版需求来源没有独立删除入口。"},
 "demands.location-remove":{kind:"delegated",target:"demands.location-remove-bulk",reason:"工作表选中单行或多行后通过原生右键删除选中行，或工具栏移除选中位置。"},
 "demands.location-edit":{kind:"delegated",target:"common.draft-grid",reason:"工作量在作业位置工作表编辑；无法直接批量填写的特殊位置属性通过工具栏位置属性编辑。"},
 "demands.batch-apply":{kind:"delegated",target:"common.draft-grid",reason:"新版通过工作表粘贴范围编辑数量，不提供旧式批量应用属性按钮。"},
 "ledger.delete":{kind:"unavailable",reason:"新版设备列表不提供独立删除入口；资料维护、退役与整基更换不等价于删除。"},
 "finance.category-create":{kind:"delegated",target:"finance.category-root",reason:"费用科目页可新增一级科目；已有科目下使用新增下级。"},
 "projects.include-pending":{kind:"delegated",target:"projects.link",reason:"关联需求候选列表已包含待确认需求；正式立项前必须确认有效，无单独切换开关。"},
 "projects.close-review":{kind:"delegated",target:"projects.close",reason:"通过审核结项进入结项核对，核对剩余量及差额后独立确认。"},
};
