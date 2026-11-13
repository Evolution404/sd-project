import { money, quantity, statusText } from "../api/client";
import { formatVisibleDateTime } from "./datetime";
export const fieldNames: Record<string, string> = {
  work_locations: "作业位置及各位置工作量",
  materials: "预计物资",
  sources: "需求来源",
  attributes: "附加属性",
  attributes_json: "位置附加属性",
  attributes_schema_json: "采用的附加属性定义",
  import_ref: "导入关联号",
  location_ref: "位置关联号",
  custom_fields: "补充现场字段",
  demand_no: "需求编号",
  operation_id: "操作类型",
  operation_version: "操作定义版本",
  quantity_scaled: "工作量",
  amount_fen: "金额",
  unit_price_fen: "单价",
  target_object: "处理部位",
  problem_description: "问题描述",
  completion_standard: "验收标准",
  physical_tower_id: "物理杆塔",
  logical_tower_id: "逻辑杆塔",
  span_id: "档距",
  location_kind: "位置类型",
  work_mode: "作业方式",
  status: "状态",
  evidence: "事实依据",
  resolved_quantity_scaled: "本次新增解决工作量",
  version: "版本",
  version_no: "版本",
  current_version: "当前版本",
  edit_version: "草稿版本",
  created_at: "创建时间",
  recorded_at: "登记时间",
  changed_at: "变更时间",
  approved_at: "批准时间",
  confirmed_at: "核定时间",
  updated_at: "更新时间",
  effective_on: "生效日期",
  occurred_on: "发生日期",
  settlement_on: "结算日期",
  expected_version: "原正式版本",
  expected_edit_version: "原草稿版本",
  document: "整张单据",
  identity_decisions: "实物关系确认",
  replacements: "整基更换历史",
  decision: "确认决定",
  old_version: "原版本",
  new_version: "更换后版本",
  reference_quotes: "正式参考报价",
  costs: "实际费用历史",
  settlements: "分次结算历史",
  lines: "计价明细",
  profiles: "项目档案历史",
  stages: "项目阶段历史",
  approvals: "立项及正式变更",
  closures: "结项决定",
  funding: "资金归属",
  versions: "正式内容版本",
  audit_events: "操作审计",
  version_created_at: "版本创建时间",
  version_created_by: "版本创建人",
  events: "状态决定",
  bindings: "需求关联及解绑",
  cost_nodes: "费用科目历史",
  from_status: "原状态",
  to_status: "新状态",
  phase: "阶段",
  reason: "说明",
  decision_reason: "决定说明",
  change_reason: "变更说明",
  basis: "正式依据",
  note: "备注",
  message: "说明",
  snapshot_json: "当时完整定义",
  snapshot: "当时定义",
  before_json: "更正前",
  after_json: "更正后",
  close_snapshot_json: "结项差异",
  full_definition_json: "完整需求定义",
  name: "名称",
  title: "事项",
  code: "业务编码",
  number: "结算编号",
  project_code: "项目编码",
  line_name: "线路",
  line_name_snapshot: "采用线路名称",
  physical_code: "设备编码",
  tower_no: "杆塔号",
  location_label: "作业位置",
  specification: "规格",
  model: "型号",
  unit_snapshot: "计量单位",
  operation_snapshot: "操作类型",
  work_object_snapshot: "作业对象",
  approved_budget_fen: "批准预算",
  preliminary_estimate_fen: "初步估算",
  limit_fen: "框架额度",
  reconciled_cost_fen: "实际费用份额",
  reconciled_settlement_fen: "核定结算额",
  approved_quantity_scaled: "批准数量",
  remaining_quantity_scaled: "尚未解决数量",
  excess_quantity_scaled: "超出数量",
  is_final: "最终核对",
  change_type: "正式动作",
  action: "操作",
  source_system: "来源方式",
  description: "事实说明",
  discovered_on: "提出日期",
  external_record_id: "原始记录编号",
  filename: "文件名",
  bytes: "字节数",
  deleted: "已删除",
  superseded: "已有更正版",
  created_by: "创建人",
  changed_by: "修改人",
  updated_by: "维护人",
  actor_id: "操作人",
  approved_by: "批准人",
  confirmed_by: "核定人",
  decided_by: "决定人",
  linked_by: "关联人",
  owner_id: "责任人",
  manager_id: "管理人员",
  pricing_mode: "计价模型",
  pricing_scope: "计价范围",
  calculation_params_json: "计价参数",
  fee_components_json: "组合费用",
  quantity_brackets_json: "数量阶梯",
  fields_json: "附加字段定义",
  additional_conditions_json: "适用现场条件",
  location_snapshot_json: "当时设备信息",
  cost_fen: "真实费用",
  settlement_fen: "已批准结算",
  unallocated_cost_fen: "待核对费用",
  budget_difference_fen: "预算差异",
  demands: "需求解决情况",
  items: "结算费用明细",
  resolutions: "本次新增解决情况",
  item_no: "明细序号",
  coverage_key: "费用范围",
  value: "现场值",
  min: "最小值",
  max: "最大值",
  label: "字段名称",
  type: "字段类型",
  required: "必填",
  options: "可选值",
  template: "模板",
  entry_hint: "录入提示",
  default_target_object: "默认处理部位",
  default_quantity_scaled: "建议工作量",
  transmission_center_length_mm: "输电中心管辖长度（米）",
};

const actorFields = new Set([
  "created_by",
  "version_created_by",
  "changed_by",
  "updated_by",
  "actor_id",
  "approved_by",
  "confirmed_by",
  "decided_by",
  "linked_by",
  "owner_id",
  "manager_id",
]);
export function visibleFact(key: string) {
  return (
    actorFields.has(key) ||
    !(
      key === "id" ||
      key === "code" ||
      key.endsWith("_code") ||
      key.endsWith("_code_snapshot") ||
      key.endsWith("_id") ||
      [
        "_sheet",
        "_row",
        "request_key",
        "idempotency_key",
        "request_hash",
        "payload_sha256",
        "sha256",
        "storage_key",
        "password_hash",
      ].includes(key)
    )
  );
}
export const fieldName = (name: string, labels: Record<string, string> = {}) =>
  labels[name] || fieldNames[name] || name;
export function factText(
  value: unknown,
  field = "",
  labels: Record<string, string> = {},
  actors: Record<string, string> = {},
  depth = 0,
): string {
  if (value == null || value === "") return "未填写";
  if (actorFields.has(field)) return actors[String(value)] || "历史账户";
  if (field === "transmission_center_length_mm" && typeof value === "number")
    return (value / 1000).toString() + " 米";
  if (field.endsWith("_fen") && typeof value === "number")
    return money(value) + " 元";
  if (field.endsWith("_scaled") && typeof value === "number")
    return quantity(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" && field.endsWith("_json")) {
    try {
      return factText(
        JSON.parse(value),
        field.slice(0, -5),
        labels,
        actors,
        depth,
      );
    } catch {
      return value;
    }
  }
  if (typeof value !== "object") {
    const displayed = formatVisibleDateTime(value, field);
    return statusText[String(displayed)] || String(displayed);
  }
  if (depth > 5) return "见相关正式明细";
  if (Array.isArray(value))
    return value.length
      ? value
          .map(
            (entry, index) =>
              index +
              1 +
              ". " +
              factText(entry, field, labels, actors, depth + 1),
          )
          .join("；")
      : "无明细";
  const entries = Object.entries(value).filter(([key]) =>
    visibleFact(key),
  );
  return entries.length
    ? entries
        .map(
          ([key, item]) =>
            fieldName(key, labels) +
            " " +
            factText(item, key, labels, actors, depth + 1),
        )
        .join("；")
    : "系统关联记录";
}
