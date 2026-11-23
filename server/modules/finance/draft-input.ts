import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { str, optStr, optNullableStr, num, optNum, optNullableNum } from "../../shared/input-shape.js";
import type { SettlementDraftInput, SettlementItemInput, SettlementResolutionInput } from "../../shared/types/finance-workflows.js";

function settlementItem(row:unknown,index:number):SettlementItemInput {
  requireValue(isObject(row),"结算明细第"+(index+1)+"行必须为对象");
  return {
    cost_node_id:str(row.cost_node_id,"费用科目"),
    project_scope_id:optNullableStr(row.project_scope_id,"关联需求"),
    quantity_scaled:optNum(row.quantity_scaled,"计价数量"),
    amount_fen:num(row.amount_fen,"结算金额"),
    unit_price_fen:optNullableNum(row.unit_price_fen,"单价"),
    work_mode:optNullableStr(row.work_mode,"工作方式"),
    evidence:optStr(row.evidence,"结算依据"),
  };
}
function settlementResolution(row:unknown,index:number):SettlementResolutionInput {
  requireValue(isObject(row),"解决量第"+(index+1)+"行必须为对象");
  return {
    project_scope_id:str(row.project_scope_id,"批准需求"),
    location_item_no:num(row.location_item_no,"作业位置序号"),
    resolved_quantity_scaled:num(row.resolved_quantity_scaled,"解决数量"),
    evidence:optStr(row.evidence,"解决依据"),
  };
}
export function financeSettlementDraft(input:Record<string,unknown>):SettlementDraftInput {
  const change=input.change_type, mode=input.mode;
  requireValue(mode===undefined||mode==="project_total"||mode==="itemized","结算方式无效");
  requireValue(change===undefined||change==="void"||change==="initial"||change==="revision",
    "结算变更类别无效");
  requireValue(input.items===undefined||Array.isArray(input.items),"结算明细必须为数组");
  requireValue(input.resolutions===undefined||Array.isArray(input.resolutions),"需求解决明细必须为数组");
  return {
    approval_version_id:optStr(input.approval_version_id,"批准版本"),
    funding_version_id:optNullableStr(input.funding_version_id,"协议资金版本"),
    number:optStr(input.number,"结算编号"),
    project_id:optStr(input.project_id,"项目"),
    expected_version:optNum(input.expected_version,"结算版本"),
    expected_edit_version:optNum(input.expected_edit_version,"结算草稿版本"),
    mode,amount_fen:optNum(input.amount_fen,"本次结算金额"),
    change_type:change,basis:optStr(input.basis,"结算依据"),
    reason:optStr(input.reason,"变更原因"),
    settlement_on:optNullableStr(input.settlement_on,"结算日期"),
    items:input.items?.map((row,index)=>settlementItem(row,index)),
    resolutions:input.resolutions?.map((row,index)=>settlementResolution(row,index)),
  };
}
