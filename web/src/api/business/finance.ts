import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { yuanToFen } from "./funding";
import { randomRequestId } from "@/utils/business/request-id";
import type { FinanceListItem } from "../../../../server/shared/types/finance";
import type { SettlementDemandLabel } from "../../../../server/shared/types/finance-workflows";

export type SettlementMode = "project_total" | "itemized";
export interface SettlementItemInput {
  cost_node_id: string;
  project_scope_id?: string | null;
  quantity_scaled?: number;
  amount_fen: number;
  unit_price_fen?: number | null;
  work_mode?: string | null;
  evidence?: string;
}
export interface SettlementResolutionInput {
  project_scope_id:string; location_item_no:number;
  resolved_quantity_scaled:number; evidence?:string;
}
export interface WorkPosition {
  id:string;project_scope_id:string;demand_id:string;demand_no:string;
  problem_description:string;operation_snapshot:string;demand_location_id:string;location_item_no:number|null;
  approved_quantity_scaled:number;prior_resolved_quantity_scaled:number;
  remaining_quantity_scaled:number;line_name:string|null;location_label:string;
  location_kind?:string;start_tower_no?:string;end_tower_no?:string;physical_code?:string;
  unit_id:string;unit_version:number;unit:string;precision:number|null;editable:boolean;
}
export interface Worksheet {approval_version_no:number;rows:WorkPosition[]}
export interface SettlementRow {
  id:string;project_id:string;number:string;status:string;
  project_name?:string;project_code?:string;
  effective_amount_fen:number|null;effective_mode:string|null;
  version?:{id:string;version_no:number;amount_fen:number;mode:SettlementMode;
    approval_version_id:string;funding_version_id:string|null;settlement_on?:string|null;
    basis:string;reason:string;change_type:"initial"|"revision"|"void"}|null;
  draft?:{edit_version:number;document:{
    amount_fen:number;mode:SettlementMode;basis:string;approval_version_id:string;
    funding_version_id:string|null;settlement_on?:string|null;
    reason?:string;change_type?:"initial"|"revision"|"void";
    items:SettlementItemInput[];
    resolutions:SettlementResolutionInput[];
  }}|null;
  review?:{action:string;event_seq:number;id:string;reason:string|null}|null;
  deleted?:boolean;created_at:string;
}
export interface SettlementDetails extends SettlementRow {
  write_blocked_reason: string | null;
  items: SettlementItemInput[];
  resolutions: SettlementResolutionInput[];
  document_details?:{
    approval_version_no:number;
    items:Array<SettlementItemInput&{cost_node_name:string;id?:string}>;
    resolutions:Array<SettlementResolutionInput&{demand:SettlementDemandLabel}>;
  }|null;
}
interface Page<T>{items:T[];total:number}
export interface CostNode {
  id: string; parent_id: string | null; name: string; status: "active" | "inactive";
  version_no: number; deleted: boolean; reference_count: number; child_count: number;
  selectable: boolean; can_add_child: boolean; disabled_reason: string;
}
export interface ActualCost {
  id: string; entry_id: string; cost_node_id: string; cost_node_name: string; title: string;
  amount_fen: number; evidence: string; invoice_number: string | null; occurred_on: string;
  status: "active" | "voided"; deleted?: boolean; version_no: number; confirmed_at: string;
}
export interface CostReconciliation {
  id: string; record_id: string; settlement_id: string; version_no: number; status: "active" | "voided";
  effective: boolean; is_final: number; reconciled_cost_fen: number; reconciled_settlement_fen: number;
  evidence: string; created_at: string;
  cost_version_id: string; settlement_item_version_id: string;
  settlement_number: string; cost_title: string; cost_version: number; cost_amount_fen: number;
  item_amount_fen: number; item_cost_node_name: string;
}
export interface ReconciliationItem {
  id: string; number: string; cost_node_name: string; amount_fen: number; demand_no: string | null;
}
const projectPath=(id:string)=>"/api/projects/"+encodeURIComponent(id);
const listParams=(page:number,size:number,keyword:string,deleted=false)=>new URLSearchParams({
  page:String(page),page_size:String(size),q:keyword,deleted:String(deleted),
});
async function get<T>(path:string):Promise<T>{
  const response=await fetch(path,{credentials:"same-origin"});
  const data:unknown=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(typeof data==="object"&&data!==null&&"message" in data
    ?String(data.message):`HTTP ${response.status}`);
  return data as T;
}
async function mutate<T>(path:string,input:unknown,method="POST"):Promise<T>{
  const response=await fetch(path,{method,credentials:"same-origin",headers:{
    "Content-Type":"application/json","Idempotency-Key":randomRequestId(),
  },body:JSON.stringify(input)});
  const data:unknown=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(typeof data==="object"&&data!==null&&"message" in data
    ?String(data.message):`HTTP ${response.status}`);
  return data as T;
}
export function settlementWorksheet(projectId:string,params:URLSearchParams):Promise<Worksheet>{
  return get<Worksheet>("/api/projects/"+encodeURIComponent(projectId)+
    "/settlement-worksheet?"+params.toString());
}
export function listSettlements(query:{page?:number;size?:number;keyword?:string;status?:string;projectId?:string} & NativeListOptions={}):Promise<Page<SettlementRow>>{
  const params=new URLSearchParams({page:String(query.page||1),page_size:String(query.size||20),
    q:query.keyword||"",sort:"created_at",direction:"desc"});
  if(query.status)params.set("filters",JSON.stringify({status:query.status}));
  applyNativeListQuery(params, query);
  return get<Page<SettlementRow>>(query.projectId
    ? "/api/projects/"+encodeURIComponent(query.projectId)+"/settlements?"+params.toString()
    : "/api/settlements?"+params.toString());
}
export const settlementDetail=(id:string):Promise<SettlementDetails>=>
  get("/api/settlements/"+encodeURIComponent(id));
export const settlementHistory=(id:string):Promise<unknown[]>=>
  get("/api/settlements/"+encodeURIComponent(id)+"/history");
export async function saveSettlementDraft(input:{
  projectId:string;approvalId:string;amountYuan:string;basis:string;
  settlementOn:string;resolutions:SettlementResolutionInput[];
  mode:SettlementMode;items:SettlementItemInput[];reason:string;
  changeType:"initial"|"revision"|"void";existing?:SettlementDetails|null;submitNow?:boolean;
}):Promise<SettlementDetails>{
  const voiding=input.changeType==="void";
  const total=input.mode==="project_total"&&!voiding?yuanToFen(input.amountYuan):undefined;
  if(total!==undefined&&total<=0)throw Error("本次结算金额须大于 0 元");
  if(!voiding&&!input.basis.trim())throw Error("请填写本次结算依据");
  if(voiding&&!input.reason.trim())throw Error("请填写作废原因");
  if(!input.approvalId)throw Error("请先选择有效的正式批准版本");
  const existing=input.existing;
  const base="/api/projects/"+encodeURIComponent(input.projectId)+"/settlements";
  return mutate<SettlementDetails>(base+(existing?"/"+encodeURIComponent(existing.id):""),{
    approval_version_id:input.approvalId,mode:input.mode,amount_fen:total,
    basis:input.basis.trim(),settlement_on:input.settlementOn||null,
    resolutions:voiding?[]:input.resolutions,items:input.mode==="itemized"&&!voiding?input.items:[],
    change_type:input.changeType,reason:input.reason.trim(),submit_now:input.submitNow??false,
    ...(existing?{
      expected_version:existing.version?.version_no??0,
      expected_edit_version:existing.draft?.edit_version??0,
      funding_version_id:existing.draft?.document.funding_version_id??existing.version?.funding_version_id,
    }:{}),
  });
}
export async function submitSettlement(row:SettlementDetails):Promise<SettlementDetails>{
  if(!row.draft)throw Error("当前结算单没有可提交的草稿");
  return mutate<SettlementDetails>("/api/settlements/"+encodeURIComponent(row.id)+"/submit",{
    expected_version:row.version?.version_no||0,
    expected_edit_version:row.draft.edit_version,
  });
}
export async function reviewSettlement(row:SettlementDetails,action:"approve"|"return",reason=""):Promise<SettlementDetails>{
  if(row.review?.action!=="submit" || !row.version)throw Error("当前结算单未处于待审核状态");
  return mutate<SettlementDetails>("/api/settlements/"+encodeURIComponent(row.id)+"/review",{
    expected_version:row.version.version_no,expected_event_seq:row.review.event_seq,
    action,reason,
  });
}
export function resubmitSettlement(row:SettlementDetails):Promise<SettlementDetails>{
  if(row.review?.action!=="return"||!row.version||row.draft)throw Error("当前结算单不能原版重提");
  return mutate("/api/settlements/"+encodeURIComponent(row.id)+"/resubmit",{
    expected_version:row.version.version_no,expected_event_seq:row.review.event_seq,
  });
}
export function withdrawSettlementDraft(row:SettlementDetails):Promise<SettlementDetails>{
  if(!row.draft)throw Error("当前结算单没有可撤回的草稿");
  return mutate("/api/settlements/"+encodeURIComponent(row.id)+"/draft",{
    expected_version:row.version?.version_no??0,expected_edit_version:row.draft.edit_version,
  },"DELETE");
}
export function listCostNodes(projectId:string):Promise<CostNode[]>{
  return get(projectPath(projectId)+"/cost-tree");
}
export function listPortfolioFinance(kind:"costs"|"reconciliations", page:number, size:number, keyword:string,
  filters:Record<string, string>, options:NativeListOptions={}):Promise<Page<FinanceListItem>> {
  const query = listParams(page,size,keyword);
  query.set("sort","created_at");
  query.set("direction","desc");
  query.set("filters",JSON.stringify(filters));
  applyNativeListQuery(query, options);
  return get("/api/finance/"+kind+"?"+query);
}
export function costNodeHistory(projectId:string,id:string):Promise<{
  versions:{id:string;version_no:number;name:string;status:string;recorded_at:string}[];
}>{
  return get(projectPath(projectId)+"/cost-tree/"+encodeURIComponent(id));
}
export function saveCostNode(projectId:string,input:{
  name:string;parent_id:string|null;status:CostNode["status"];reason:string;expected_version?:number;
},id?:string):Promise<CostNode>{
  return mutate(projectPath(projectId)+"/nodes"+(id?"/"+encodeURIComponent(id):""),input);
}
export function deleteCostNode(projectId:string,node:CostNode):Promise<{deleted:true}>{
  return mutate(projectPath(projectId)+"/nodes/"+encodeURIComponent(node.id),{
    expected_version:node.version_no,expected_references:node.reference_count,expected_children:node.child_count,
  },"DELETE");
}
export function listActualCosts(projectId:string,page:number,size:number,keyword:string,deleted=false,options:NativeListOptions={}):Promise<Page<ActualCost>>{
  return get(projectPath(projectId)+"/costs?"+applyNativeListQuery(listParams(page,size,keyword,deleted),options));
}
export function costHistory(projectId:string,entryId:string):Promise<ActualCost[]>{
  return get(projectPath(projectId)+"/costs/"+encodeURIComponent(entryId));
}
export function saveActualCost(projectId:string,input:{
  title:string;cost_node_id:string;amount_fen:number;evidence:string;occurred_on:string;
  invoice_number:string|null;status:ActualCost["status"];reason:string;expected_version?:number;
},entryId?:string):Promise<ActualCost>{
  return mutate(projectPath(projectId)+"/costs"+(entryId?"/"+encodeURIComponent(entryId):""),input);
}
export function costDeletionPreview(projectId:string,entryId:string):Promise<{
  title:string;expected_version:number;reconciliation_count:number;reconciled_cost_fen:number;blocked:string;
}>{
  return get(projectPath(projectId)+"/costs/"+encodeURIComponent(entryId)+"/deletion-preview");
}
export function deleteActualCost(projectId:string,entryId:string,version:number,reconciliations:number):Promise<{deleted:true}>{
  return mutate(projectPath(projectId)+"/costs/"+encodeURIComponent(entryId),{
    expected_version:version,expected_reconciliations:reconciliations,
  },"DELETE");
}
export function listCostReconciliations(projectId:string,page:number,size:number,keyword:string,options:NativeListOptions={}):Promise<Page<CostReconciliation>>{
  const params=listParams(page,size,keyword);
  params.set("project_id",projectId);
  return get("/api/reconciliations?"+applyNativeListQuery(params, options));
}
export function listReconciliationItems(projectId:string,keyword:string,page=1):Promise<Page<ReconciliationItem>>{
  return get(projectPath(projectId)+"/reconciliation-items?"+listParams(page,20,keyword));
}
export function saveCostReconciliation(input:{
  cost_version_id:string;settlement_item_version_id:string;reconciled_cost_fen:number;
  reconciled_settlement_fen:number;is_final:boolean;evidence:string;expected_version:number;record_id?:string;
}):Promise<CostReconciliation>{
  return mutate("/api/reconciliations",input);
}
export function voidCostReconciliation(row: CostReconciliation, evidence: string) {
  return mutate("/api/reconciliations", {
    record_id: row.record_id, expected_version: row.version_no, status: "voided", evidence,
  });
}
export function removeCostReconciliation(row: CostReconciliation) {
  return mutate("/api/reconciliations/" + encodeURIComponent(row.record_id),
    { expected_version: row.version_no }, "DELETE");
}
export function reconciliationHistory(projectId:string,id:string):Promise<CostReconciliation[]>{
  return get(projectPath(projectId)+"/reconciliations/"+encodeURIComponent(id));
}
