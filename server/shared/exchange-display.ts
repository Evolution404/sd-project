import type { ExchangeExportOptions, ExchangeReportScope, WorkbookIssue } from "./types/exchange.js";
import { isObject } from "./types/contracts.js";

export const exchangeColumnLabels: Record<string,string> = {
  import_ref: "导入关联号",
  location_ref: "位置关联号",
  primary_source: "主要来源说明",
  primary_source_id: "主要来源身份",
  unit_name: "单位",
  line_kind: "线路类型",
  parent_line_name: "所属主线名称（支线填写）",
  parent_voltage_name: "所属主线电压等级（重名时填写）",
  junction_tower_no: "主线接入杆塔号（支线填写）",
  start_tower_no: "起点杆塔号",
  start_line_name: "起点所属线路（支线接入时填写）",
  start_voltage_name: "起点线路电压等级（重名时填写）",
  end_line_name: "终点所属线路（支线接入时填写）",
  end_voltage_name: "终点线路电压等级（重名时填写）",
  transmission_center_length_mm: "输电中心管辖长度（米）",
  sharing_line_name: "共用实物的已有线路",
  sharing_voltage_name: "共塔线路电压等级",
  sharing_tower_no: "共用实物的已有杆塔号",
  name: "线路名称",
  tower_nature: "杆塔性质",
  line_id: "线路身份",
  voltage_level_id: "电压等级身份",
  parent_line_id: "主线路身份",
  junction_tower_id: "接入杆塔身份",
  start_tower_id: "起点杆塔身份",
  end_tower_id: "终点杆塔身份",
  tower_code: "系统编号",
  purpose: "用途",
  commissioned_on: "投运日期",
  tower_material: "杆塔材质",
  model: "型号",
  height_scaled: "杆塔高度（米）",
  longitude: "经度",
  latitude: "纬度",
  operations_team: "运维班组",
  management_department: "管辖部门",
  status: "状态",
  operation_name: "操作类型名称",
  priority_name: "优先级名称",
  line_name: "线路名称",
  voltage_name: "电压等级名称（同名线路时填写）",
  tower_no: "杆塔号或档距起点杆号",
  end_tower_no: "档距终点杆号",
  asset_no: "独立实物资产铭牌号",
  material_name: "物资名称",
  material_model: "物资型号",
  material_specification: "物资规格",
  project_name: "子项目名称",
  demand_description: "项目需求问题描述",
  document_row: "对应清单行号（多单据时填写）",
  location_row: "作业位置表行号",
  factor_name: "现场特征名称",
  factor_id: "系统特征身份",
  specification: "作业规格",
  field_key: "字段标识",
  field_name: "字段名称",
  value: "实际值",
  cost_node_path: "费用科目完整路径",
  demand_no: "需求编号",
  number: "结算编号",
  id: "系统标识",
  expected_version: "原正式版本",
  expected_edit_version: "原草稿版本",
  operation_id: "操作标识",
  problem_description: "问题描述",
  target_object: "处理部位",
  completion_standard: "验收标准",
  priority_id: "优先级标识",
  expected_on: "预计解决时间",
  action: "明细动作",
  location_kind: "位置类型",
  logical_tower_id: "逻辑塔标识",
  physical_tower_id: "物理塔标识",
  span_id: "档距标识",
  quantity_scaled: "数量（万分之一单位）",
  work_mode: "作业方式",
  material_id: "物资标识",
  note: "备注",
  description: "来源说明",
  discovered_on: "提出日期",
  project_id: "子项目标识",
  approval_version_id: "批准版本标识",
  funding_version_id: "资金版本标识",
  settlement_on: "结算日期",
  basis: "结算依据",
  mode: "结算方式",
  change_type: "版本动作",
  cost_node_id: "费用科目标识",
  project_scope_id: "项目需求范围标识",
  amount_fen: "本次金额（分）",
  unit_price_fen: "单价（分）",
  evidence: "事实依据",
  resolved_quantity_scaled: "本次新增解决量（万分之一单位）",
};
export function issueDetails(issue: WorkbookIssue) {
  const label = issue.field === "quantity_scaled" ? "工作量"
    : issue.field === "amount_fen" ? "本次金额（元）"
    : exchangeColumnLabels[issue.field] ?? (/^[a-zA-Z_][\w.]*$/.test(issue.field) ? "工作表字段" : issue.field);
  const values = isObject(issue.raw_value) ? issue.raw_value : undefined;
  const raw = values
    ? (isObject(values._raw_values) ? values._raw_values[issue.field] : undefined) ?? values[issue.field]
    : issue.raw_value;
  const value = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : "见工作表对应行";
  const integerUnit = issue.reason.match(/^(.+?)只允许整数数量$/)?.[1];
  return {
    label, value,
    reason: issue.reason,
    suggestion: integerUnit ? `${integerUnit}只能填整数，请按实际数量填写。` : issue.suggestion,
  };
}

export function exchangeReportScope(options: ExchangeExportOptions, count: number): ExchangeReportScope {
  if (options.ids?.length) return { label: "勾选的记录", count };
  const conditions = Object.entries(options.listQuery?.filters ?? {})
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key === "display_status" ? "状态" : exchangeColumnLabels[key] ?? "筛选条件"} ${value}`);
  const search = options.listQuery?.q;
  if (search) conditions.unshift("检索 " + search);
  if (options.listQuery?.deleted) conditions.push("包含已删除");
  return { label: conditions.length ? conditions.join("，") + "（全部页）" : "当前分类（全部页）", count };
}
