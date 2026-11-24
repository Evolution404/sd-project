import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
import type { DemandWriteInput, NormalizedDemand } from "../../../../server/shared/types/demands";
export type { DemandWriteInput } from "../../../../server/shared/types/demands";
/** Domain-specific adapter for the authoritative demand endpoints. */
export interface DemandLocation {
  item_no: number;
  location_kind: "physical_tower" | "logical_tower" | "span";
  physical_tower_id?: string | null;
  logical_tower_id?: string | null;
  span_id?: string | null;
  quantity_scaled: number;
  resolved_quantity_scaled?: number;
  remaining_quantity_scaled?: number;
  work_mode?: string;
  location_snapshot_json: {
    line_name: string;
    location_label: string;
    tower_no: string;
    asset_no?: string;
    specification: string;
  };
}
export interface DemandRow {
  id:string; demand_no:string; current_version:number;
  display_status:string; status:"pending"|"active"|"returned"|"cancelled";
  operation_snapshot:string; unit_snapshot:string; work_object_snapshot:string;
  target_object:string; problem_description:string; completion_standard:string;
  quantity_scaled:number; remaining_quantity_scaled?:number;
  location_count?:number; line_summary?:string; line_count?:number; project_name?:string|null;
  expected_on?:string|null; priority_snapshot?:string|null;
  deleted:boolean;
  binding:{project_id:string; project_scope_id:string;demand_id:string}|null;
  work_locations:DemandLocation[];
}
export interface DemandDetail extends DemandRow {
  materials:Array<{item_no:number;material_name:string;quantity_scaled:number;note:string;model?:string;specification?:string}>;
  sources:Array<{id:string;description:string;discovered_on:string|null}>;
}
export type DemandEditorRecord = Omit<DemandDetail, keyof NormalizedDemand | "materials"> & Omit<NormalizedDemand, "materials"> & {
  materials: (NormalizedDemand["materials"][number] & { material_name: string; unit_snapshot: string; model?:string; specification?:string })[];
  duplicate_review_token: string;
};
export interface DemandHistory {
  events:Array<{event_seq:number;to_status:string;recorded_at:string}>;
  revisions?:Array<{version:number;changed_at:string}>;
}
interface Page<T>{items:T[];total:number;page:number;page_size:number}
async function request<T>(path:string, method="GET", input?:unknown):Promise<T>{
  const response=await fetch("/api/demands"+path,{
    method,credentials:"same-origin",
    ...(method==="GET"?{}:{
      headers:{"Content-Type":"application/json","Idempotency-Key":randomRequestId()},
      body:JSON.stringify(input??{}),
    }),
  });
  const result:unknown=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=typeof result==="object"&&result!==null&&"message" in result
      ? String(result.message):`需求接口失败（HTTP ${response.status}）`;
    const fields = typeof result === "object" && result !== null && "fields" in result ? result.fields : undefined;
    throw new DemandRequestError(message, fields);
  }
  return result as T;
}
export class DemandRequestError extends Error {
  constructor(message:string, readonly fields:unknown) { super(message); }
  get duplicateIds():string[] {
    const fields=this.fields;
    if(typeof fields!=="object"||fields===null||!("duplicate_ids" in fields)||!Array.isArray(fields.duplicate_ids))
      return [];
    return fields.duplicate_ids.filter((id):id is string=>typeof id==="string");
  }
}
export async function queryDemands(query:{
  page?:number; pageSize?:number; keyword?:string; status?:string;
  sort?:string; direction?:"asc"|"desc";
} & NativeListOptions):Promise<Page<DemandRow>>{
  const params=new URLSearchParams({
    page:String(query.page||1),page_size:String(query.pageSize||20),
    q:query.keyword||"",sort:query.sort||"created_at",
    direction:query.direction||"desc",deleted:"false",
  });
  if(query.status)params.set("filters",JSON.stringify({display_status:query.status}));
  applyNativeListQuery(params, query);
  return request<Page<DemandRow>>(`?${params}`);
}
export function queryDemandCandidates(query:{page:number;pageSize:number;keyword:string;includePending?:boolean}):Promise<Page<DemandRow>>{
  const params=new URLSearchParams({page:String(query.page),page_size:String(query.pageSize),
    q:query.keyword,include_pending:String(Boolean(query.includePending))});
  return request<Page<DemandRow>>("/candidates?"+params);
}
export async function readDemand(id:string,includeDeleted=false):Promise<DemandDetail>{
  return request<DemandDetail>("/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
}
export function readDemandForEditor(id:string):Promise<DemandEditorRecord>{
  return request("/"+encodeURIComponent(id));
}
export function saveDemand(input:DemandWriteInput,id?:string):Promise<DemandDetail>{
  return request(id?"/"+encodeURIComponent(id):"","POST",input);
}
export async function demandHistory(id:string):Promise<DemandHistory>{
  return request<DemandHistory>("/"+encodeURIComponent(id)+"/history");
}
export async function changeDemandStatus(
  record:DemandRow,status:"active"|"returned"|"cancelled",reason?:string,
):Promise<DemandDetail>{
  const history=await demandHistory(record.id);
  const last=history.events.at(-1);
  if(!last)throw Error("缺少需求正式生命周期事件，拒绝提交");
  return request<DemandDetail>("/"+encodeURIComponent(record.id)+"/status","POST",{
    status,expected_version:record.current_version,expected_event_seq:last.event_seq,reason,
  });
}
