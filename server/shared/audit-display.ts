export const auditActions: Readonly<Record<string, string>> = {
  create: "新增", revise: "修订", update: "修改", correct: "更正", note: "补充说明", delete: "删除",
  confirm: "确认", approve: "批准", replace: "整基更换", withdraw: "撤回草稿", link: "建立关联",
  linked: "建立关联", released: "解除关联", return: "退回", reject: "驳回", cancel: "取消",
  void: "作废", activate: "启用", import: "导入", upload: "上传", deactivate: "停用",
};
export const auditObjects: Readonly<Record<string, string>> = {
  projects: "子项目", demands: "专业需求", settlements: "结算单", settlement_drafts: "结算草稿",
  costs: "实际费用", cost_nodes: "费用科目", reconciliations: "费用核对", sources: "需求来源",
  users: "账号", ips: "IP 授权", access_policy: "访问限制", manual: "人工记录",
  approval_drafts: "项目批准草稿", audit: "操作审计", evidence: "附件", exchange: "Excel 批量处理",
  tower_replacements: "杆塔实物", tower_identity_decisions: "实物关系", reference_charges: "项目参考费用",
  frameworks: "年度框架", agreements: "执行协议", materials: "物资", operations: "操作类型", objects: "作业对象",
  prices: "参考价格规则", organizations: "归口单位", units: "计量单位", voltages: "电压等级",
  tower_natures: "杆塔性质", tower_materials: "杆塔材质", lines: "线路", towers: "逻辑杆塔",
  physical: "物理杆塔", spans: "档距", priorities: "优先级", categories: "项目类别",
};
