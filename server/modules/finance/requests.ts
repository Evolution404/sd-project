import { str, optStr, optNullableStr, num, optNum } from "../../shared/input-shape.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { FinanceListKind } from "../../shared/types/finance.js";
import type {
  CostNodeInput, ActualCostInput, SettlementSubmitInput,
  SettlementReviewInput, SettlementReviewAction, SettlementResubmitInput, ReconciliationInput,
} from "../../shared/types/finance-workflows.js";

function optBool(value: unknown, label: string): boolean | undefined {
  requireValue(value === undefined || typeof value === "boolean", label + "必须为布尔值");
  return value;
}
export function financeKind(value:string):FinanceListKind {
  requireValue(value==="costs"||value==="settlements"||value==="reconciliations",
    "费用查询类型不存在",404);
  return value;
}
export function financeVersion(input:Record<string,unknown>) {
  return {expected_version:num(input.expected_version,"正式版本"),
    reason:optStr(input.reason,"说明")};
}
export function financeDeleteCost(input:Record<string,unknown>) {
  return {...financeVersion(input),
    expected_reconciliations:optNum(input.expected_reconciliations,"有效费用核对数")};
}
export function financeSubmit(input:Record<string,unknown>):SettlementSubmitInput {
  return {expected_version:num(input.expected_version,"结算版本"),
    expected_edit_version:num(input.expected_edit_version,"结算草稿编辑版本")};
}
export function financeResubmit(input:Record<string,unknown>):SettlementResubmitInput {
  return {expected_version:num(input.expected_version,"结算版本"),
    expected_event_seq:num(input.expected_event_seq,"审核事件版本")};
}
export function financeDeleteSettlement(input:Record<string,unknown>) {
  return {...financeVersion(input),
    expected_edit_version:optNum(input.expected_edit_version,"结算草稿编辑版本")};
}
export function financeReview(input:Record<string,unknown>):SettlementReviewInput {
  requireValue(input.action==="approve"||input.action==="return"||input.action==="reject",
    "审核动作无效",422);
  const action:SettlementReviewAction=input.action;
  return {expected_version:num(input.expected_version,"结算版本"),
    expected_event_seq:num(input.expected_event_seq,"审核事件版本"),action,
    effective_on:optNullableStr(input.effective_on,"生效日期"),
    reason:optStr(input.reason,"审核意见")};
}
export function financeCostNode(input:Record<string,unknown>):CostNodeInput {
  const status=input.status;
  requireValue(status===undefined||status==="active"||status==="inactive","费用科目状态无效");
  return {
    name:str(input.name,"费用科目名称"),parent_id:optNullableStr(input.parent_id,"上级科目"),
    expected_version:optNum(input.expected_version,"科目版本"),status,
    reason:optStr(input.reason,"变更原因")};
}
export function financeActualCost(input:Record<string,unknown>):ActualCostInput {
  const status=input.status;
  requireValue(status===undefined||status==="active"||status==="voided","费用状态无效");
  return {
    title:str(input.title,"实际费用事项"),amount_fen:num(input.amount_fen,"实际金额"),
    occurred_on:str(input.occurred_on,"发生日期"),evidence:str(input.evidence,"费用凭据"),
    cost_node_id:optStr(input.cost_node_id,"费用科目"),
    invoice_number:optNullableStr(input.invoice_number,"发票号"),
    expected_version:optNum(input.expected_version,"费用版本"),
    status,request_key:optStr(input.request_key,"幂等键"),
    reason:optStr(input.reason,"更正理由"),
  };
}
export function financeReconciliation(input:Record<string,unknown>):ReconciliationInput {
  const status=input.status;
  requireValue(status===undefined||status==="active"||status==="voided","核对状态无效");
  return {
    record_id:optStr(input.record_id,"核对记录"),
    expected_version:optNum(input.expected_version,"核对版本"),
    status,
    settlement_item_version_id:optStr(input.settlement_item_version_id,"结算明细版本"),
    cost_version_id:optStr(input.cost_version_id,"费用版本"),
    reconciled_cost_fen:optNum(input.reconciled_cost_fen,"核对费用"),
    reconciled_settlement_fen:optNum(input.reconciled_settlement_fen,"核对结算"),
    is_final:optBool(input.is_final,"是否最终核对"),
    evidence:optStr(input.evidence,"核对依据"),
    request_key:optStr(input.request_key,"幂等键"),
  };
}
export function financeDeleteReconciliation(input:Record<string,unknown>) {
  return {expected_version:num(input.expected_version,"核对版本"),
    evidence:optStr(input.evidence,"删除依据")};
}
export function financeDeleteNode(input:Record<string,unknown>) {
  return {expected_version:num(input.expected_version,"费用科目版本"),
    expected_references:optNum(input.expected_references,"历史引用数"),
    expected_children:optNum(input.expected_children,"子科目数")};
}
