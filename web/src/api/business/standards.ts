import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
import type { OperationDetail, OperationRecord } from "../../../../server/shared/types/work-standards";
import type { OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import { exactScaledDecimalText } from "@/utils/business/fixed-scale";
export type WorkKind="objects"|"operations";
export interface WorkStandardRow {
  id:string;code:string;name:string;status:"active"|"inactive";
  version_no?:number;version?:number;deleted?:boolean;
  created_at:string;object_position?:string;attribution_unit?:string;
  work_object_id?:string;default_unit_id?:string;
  work_object_id_label?:string;default_unit_id_label?:string;
  default_target_object?:string;completion_standard?:string|null;
  entry_hint?:string;default_quantity_scaled?:number|null;
  attributes_schema_json?:string;sort_order?:number;
  reason?:string;
}
export interface WorkForm {
  name:string;status:"active"|"inactive";code?:string;
  version_no?:number;version?:number;
  object_position?:"body"|"corridor";
  attribution_unit?:"physical_tower"|"logical_tower";
  work_object_id?:string;default_unit_id?:string;
  default_target_object?:string;completion_standard?:string;
  entry_hint?:string;default_quantity_text?:string;
  attributes?:OperationAttribute[];sort_order?:number;reason?:string;
  adopt_current_object?:boolean;adopt_current_unit?:boolean;
}
interface Page<T>{items:T[];total:number}
interface Detail {item:WorkStandardRow;versions:Array<{version?:number;version_no?:number;name:string;status:string;reason?:string;recorded_at?:string;changed_at?:string}>;audits:unknown[]}
const endpoint=(kind:WorkKind)=>"/api/catalog/"+kind;
async function request<T>(url:string,method="GET",input?:unknown):Promise<T>{
  const result=await fetch(url,{method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
      "Idempotency-Key":randomRequestId()},body:JSON.stringify(input??{})})});
  const data:unknown=await result.json().catch(()=>({}));
  if (!result.ok) {
    const failure = typeof data === "object" && data && "message" in data ? data : undefined;
    throw Object.assign(Error(failure ? String(failure.message) : "HTTP " + result.status), {
      status: result.status,
      fields: failure && "fields" in failure ? failure.fields : {},
    });
  }
  return data as T;
}
export function listStandards(kind:WorkKind,query:{
  page?:number;size?:number;keyword?:string
} & NativeListOptions={}):Promise<Page<WorkStandardRow>>{
  const params=new URLSearchParams({page:String(query.page||1),
    page_size:String(query.size||20),q:query.keyword||"",
    sort:"created_at",direction:"desc"});
  applyNativeListQuery(params, query);
  return request(endpoint(kind)+"?"+params);
}
export const getStandard=(kind:WorkKind,id:string,includeDeleted=false):Promise<WorkStandardRow>=>
  request(endpoint(kind)+"/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
export const readOperationDefinition=(id:string,version?:number):Promise<OperationRecord>=>
  request(endpoint("operations")+"/"+encodeURIComponent(id)+"/definition"+(version===undefined?"":"?version="+version));
export const standardDetail=(kind:WorkKind,id:string):Promise<Detail>=>
  request(endpoint(kind)+"/"+encodeURIComponent(id)+"?history=true");
export const operationDetail=(id:string):Promise<OperationDetail>=>
  request(endpoint("operations")+"/"+encodeURIComponent(id)+"?history=true");
export async function saveStandard(kind:WorkKind,data:WorkForm,id?:string) {
  const payload:Record<string,unknown>={
    name:data.name.trim(),status:data.status,reason:data.reason||"",
    ...(id?{expected_version:kind==="objects"?data.version_no:data.version}:{})
  };
  if(kind==="objects"){
    payload.object_position=data.object_position;
    payload.attribution_unit=data.attribution_unit;
  }else {
    payload.work_object_id=data.work_object_id;
    payload.default_unit_id=data.default_unit_id;
    payload.adopt_current_object=Boolean(data.adopt_current_object);
    payload.adopt_current_unit=Boolean(data.adopt_current_unit);
    payload.default_target_object=data.default_target_object||"";
    payload.completion_standard=data.completion_standard||null;
    payload.entry_hint=data.entry_hint||"";
    payload.sort_order=data.sort_order??100;
    payload.attributes_schema_json=data.attributes ?? [];
    if(data.default_quantity_text?.trim()){
      const scaled=exactScaledDecimalText(data.default_quantity_text.trim(),4);
      if(scaled===null || scaled<=0)throw Error("建议数量须为正数，最多四位小数");
      payload.default_quantity_scaled=scaled;
    }else payload.default_quantity_scaled=null;
  }
  return request<WorkStandardRow>(endpoint(kind)+(id?"/"+encodeURIComponent(id):""),
    "POST",payload);
}
