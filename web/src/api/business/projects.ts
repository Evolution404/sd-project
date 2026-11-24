import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { fenToYuan, yuanToFen, listFunding, type FundingRow } from "./funding";
import type { DemandLocation, DemandRow } from "./demands";
import { randomRequestId } from "@/utils/business/request-id";

interface ApprovalLocationInput {
  location_item_no: number;
  approved_quantity_scaled: number;
}
interface ApprovalMaterialInput {
  material_id: string;
  quantity_scaled: number;
}
export interface ApprovalScopeInput {
  project_scope_id?: string;
  demand_id?: string;
  demand_version: number;
  approved_amount_fen?: number | null;
  locations: ApprovalLocationInput[];
  materials: ApprovalMaterialInput[];
  expected_material_versions?:Record<string,string>;
}
export interface ProjectApprovalInput {
  expected_version: number;
  expected_approval_version_id: string | null;
  approved_budget_fen: number;
  scopes: ApprovalScopeInput[];
  confirm_changes: boolean;
  basis: string;
  reason: string;
}
export interface ProjectApprovalCandidate {
  id: string;
  project_scope_id: string;
  current_version: number;
  demand_no: string;
  status: DemandRow["status"];
  problem_description: string;
  operation_snapshot: string;
  unit_snapshot: string;
  expected_on?: string | null;
  work_locations: DemandLocation[];
}
export interface ApprovedProjectScope {
  id: string;
  project_scope_id: string;
  demand_id: string;
  demand_version: number;
  demand_no: string;
  problem_description: string;
  approved_amount_fen: number | null;
  snapshot_json: string;
  locations: (ApprovalLocationInput & {
    location_kind: string;
    location_object: string;
    frozen_location: string;
  })[];
  materials: {
    material_id: string;
    material_version_id: string;
    material_name: string;
    unit_snapshot: string;
    approved_quantity_scaled: number;
  }[];
}
export interface ProjectAction {
  key: "link" | "stock" | "approval" | "approve" | "finance" | "close" | "history";
  label: string;
  enabled: boolean;
  reason?: string;
  approval_id?: string;
}
export interface ProjectClosePreview {
  expected_version: number;
  approval_version: number;
  preview_hash: string;
  reason: string;
  release_demands: {
    project_scope_id: string;
    demand_no: string;
    remaining_quantity_scaled: number;
  }[];
  summary: {
    approved_budget_fen: number;
    actual_cost_fen: number;
    settlement_fen: number;
    reconciled_cost_fen: number;
    unreconciled_cost_fen: number;
    budget_difference_fen: number | null;
    locations: {
      project_scope_id: string;
      demand_no: string;
      location_item_no: number;
      location_name: string;
      approved_quantity_scaled: number;
      resolved_quantity_scaled: number;
      remaining_quantity_scaled: number;
    }[];
  };
}

export interface ProjectScope {
  id:string; project_id:string; demand_id:string; demand_version:number;
  demand_no:string; demand_status:string; demand_display_status:DemandRow["display_status"]; problem_description:string;
  operation_snapshot:string; proposed_quantity_scaled:number; unit_snapshot:string;
  location_count:number; line_summary:string; line_count:number; binding?:{project_scope_id:string}|null;
}
export interface ProjectApproval {
  id:string; version_no:number; status:"draft"|"approved"|"withdrawn";
  approved_budget_fen:number; approved_at?:string|null;
  scopes: ApprovedProjectScope[];
  pending_scopes: (ApprovalScopeInput & {
    demand_id: string;
    snapshot: ProjectApprovalCandidate;
  })[];
  snapshot_json: string;
  change_reason?: string;
  reference: { complete: boolean; total_fen: number | null };
}
export interface ProjectRow {
  id:string;code:string;name:string;status:"reserve"|"stocked"|"approved"|"closed";
  display_status:string;framework_id:string;version:number;deleted?:boolean;
  profile_version:number;funding?:{version_no:number;agreement_id:string|null}|null;
  agreement_id?:string|null;
  scopes:ProjectScope[];approval:ProjectApproval|null;
  created_at:string;planned_start_on?:string|null;planned_end_on?:string|null;
  preliminary_estimate_fen?:number|null;reason?:string;
  category_name?:string|null;managing_unit_name?:string|null;
  owner_username?:string|null;manager_username?:string|null;
  category_id?:string|null;managing_unit_id?:string|null;owner_id?:string|null;manager_id?:string|null;
  preliminary_estimate_basis?:string|null;
}
export interface ProjectDetail extends ProjectRow {
  approvals:ProjectApproval[];
  cost_nodes:ProjectCostNode[];
  changes:unknown[];
}
export interface ProjectCostNode {
  id: string;
  parent_id: string | null;
  name: string;
  version_no: number;
  status: "active" | "inactive";
  deleted: boolean;
}
export interface ProjectForm {
  name:string;framework_id:string;agreement_id?:string|null;
  profile_version?:number;expected_funding_version?:number;
  planned_start_on?:string|null;planned_end_on?:string|null;reason?:string;
  category_id?:string|null;managing_unit_id?:string|null;owner_id?:string|null;manager_id?:string|null;
  preliminary_estimate_yuan?:string;preliminary_estimate_basis?:string|null;
}
export interface ProjectHistory {
  profiles?:Array<{version_no:number;name:string;recorded_at:string}>;
  funding?:Array<{version_no:number;agreement_id?:string|null;recorded_at:string}>;
  events?:Array<{event_seq:number;from_status:string;to_status:string;recorded_at:string}>;
}
interface Page<T>{items:T[];total:number;page:number;page_size:number}
const root="/api/projects";
async function req<T>(path:string,method="GET",input?:unknown):Promise<T>{
  const response=await fetch(root+path,{
    method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{
      "Content-Type":"application/json","Idempotency-Key":randomRequestId(),
    },body:JSON.stringify(input??{})}),
  });
  const body:unknown=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(typeof body==="object"&&body!==null&&"message" in body
    ? String(body.message) : `项目接口失败：HTTP ${response.status}`);
  return body as T;
}
export async function listProjects(query:{page?:number;size?:number;keyword?:string;status?:string} & NativeListOptions={}):Promise<Page<ProjectRow>>{
  const params=new URLSearchParams({page:String(query.page||1),
    page_size:String(query.size||20),q:query.keyword||"",
    sort:"created_at",direction:"desc",deleted:"false"});
  if(query.status)params.set("filters",JSON.stringify({display_status:query.status}));
  applyNativeListQuery(params, query);
  return req("?"+params.toString());
}
export async function projectDetail(id:string,includeDeleted=false):Promise<ProjectDetail>{
  return req("/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
}
export function projectActions(id: string): Promise<ProjectAction[]> {
  return req("/" + encodeURIComponent(id) + "/actions");
}
export function approvalCandidates(id: string): Promise<ProjectApprovalCandidate[]> {
  return req("/" + encodeURIComponent(id) + "/approval-candidates");
}
export function projectApprovalHistory(id: string): Promise<ProjectApproval[]> {
  return req("/" + encodeURIComponent(id) + "/approval-history");
}
export function eligibleProjectAgreements(frameworkId:string,selectedId?:string|null):Promise<{
  options:{id:string;name:string;eligible:boolean}[];
}>{
  const params=new URLSearchParams({framework_id:frameworkId});
  if(selectedId)params.set("selected_id",selectedId);
  return req("/eligible-agreements?"+params);
}
export function saveApproval(id: string, input: ProjectApprovalInput): Promise<ProjectDetail> {
  return req("/" + encodeURIComponent(id) + "/approvals", "POST", input);
}
export function approveProject(project: ProjectDetail, approvalId: string, reason: string): Promise<ProjectDetail> {
  return req("/" + encodeURIComponent(project.id) + "/approvals/" + encodeURIComponent(approvalId) + "/approve",
    "POST", { expected_version: project.version, reason });
}
export function withdrawApproval(projectId: string, approvalId: string): Promise<ProjectDetail> {
  return req("/" + encodeURIComponent(projectId) + "/approvals/" + encodeURIComponent(approvalId), "DELETE");
}
export function projectClosePreview(id: string): Promise<ProjectClosePreview> {
  return req("/" + encodeURIComponent(id) + "/close-preview");
}
export function closeProject(id: string, preview: ProjectClosePreview, reason: string): Promise<ProjectDetail> {
  return req("/" + encodeURIComponent(id) + "/close", "POST", {
    expected_version: preview.expected_version, preview_hash: preview.preview_hash, reason,
  });
}
export async function projectHistory(id:string):Promise<ProjectHistory>{
  return req("/"+encodeURIComponent(id)+"/history");
}
function projectProfileInput(form:ProjectForm) {
  return {
    name:form.name.trim(),framework_id:form.framework_id,
    agreement_id:form.agreement_id||null,
    reason:form.reason||"",
    category_id:form.category_id || null,
    managing_unit_id:form.managing_unit_id || null,
    owner_id:form.owner_id || null,
    manager_id:form.manager_id || null,
    planned_start_on:form.planned_start_on||null,
    planned_end_on:form.planned_end_on||null,
    preliminary_estimate_fen:form.preliminary_estimate_yuan?.trim()
      ? yuanToFen(form.preliminary_estimate_yuan) : null,
    preliminary_estimate_basis:form.preliminary_estimate_basis || null,
  };
}
export async function saveProject(form:ProjectForm,id?:string):Promise<ProjectDetail>{
  return req(id?"/"+encodeURIComponent(id):"","POST",{
    ...projectProfileInput(form),
    ...(id?{expected_version:form.profile_version,
      expected_funding_version:form.expected_funding_version}:{}),
  });
}
export function createProjectFromDemand(form:ProjectForm,demand:{id:string;current_version:number}):Promise<ProjectDetail>{
  return req("/from-demand","POST",{
    ...projectProfileInput(form),demand_id:demand.id,expected_demand_version:demand.current_version,
  });
}
export async function linkProjectDemands(projectId:string,demands:Array<{id:string;current_version:number}>){
  if(demands.length===0||demands.length>100)throw Error("请勾选 1～100 条专业需求");
  return req<ProjectDetail>("/"+encodeURIComponent(projectId)+"/link-batch","POST",{
    links:demands.map(d=>({demand_id:d.id,expected_version:d.current_version})),
  });
}
export async function stockProject(project:ProjectDetail):Promise<ProjectDetail>{
  return req("/"+encodeURIComponent(project.id)+"/stock","POST",{
    expected_version:project.version,
  });
}
export async function projectDeletionPreview(id:string):Promise<unknown>{
  return req("/"+encodeURIComponent(id)+"/deletion-preview");
}
export function projectMoney(amount:number|null|undefined):string{
  return amount===null||amount===undefined?"—":"¥"+fenToYuan(amount);
}
export async function frameworkOptions():Promise<FundingRow[]>{
  const list=await listFunding("frameworks",{size:500});
  return list.items.filter(x=>x.status==="active");
}
