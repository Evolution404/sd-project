import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
/** Y3 materials adapter: only domain endpoints, no generic table writes. */
export interface Material {
  id:string; material_id:string; material_version_id:string; code:string; name:string; model:string;
  specification:string; unit_id:string;unit_id_label:string;status:"active"|"inactive";
  note:string;version_no:number;created_at:string;recorded_at:string;deleted:boolean;
}
export interface MaterialForm {
  id?:string; name:string;model:string;specification:string;
  unit_id:string;status:"active"|"inactive";note:string;version_no?:number;
}
interface Page<T>{items:T[];total:number}
interface MaterialDetail {item:Material;versions:Array<{
  id:string;version_no:number;name:string;model:string;specification:string;
  note:string;recorded_at:string;changed_by:string;
}>;audits:unknown[]}
async function materialRequest<T>(route:string,method="GET",data?:unknown):Promise<T>{
  const resp=await fetch("/api/catalog/materials"+route,{
    method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
      "Idempotency-Key":randomRequestId()},body:JSON.stringify(data??{})}),
  });
  const payload=await resp.json().catch(()=>({}));
  if(!resp.ok)throw Error(payload?.message||`HTTP ${resp.status}`);
  return payload as T;
}
export async function queryMaterials(query:{
  page?:number;pageSize?:number;keyword?:string;sort?:string;
  direction?:"asc"|"desc";status?:string;
} & NativeListOptions):Promise<Page<Material>>{
  const q=new URLSearchParams({
    page:String(query.page||1),page_size:String(query.pageSize||20),
    q:query.keyword||"",sort:query.sort||"created_at",
    direction:query.direction||"desc",
  });
  if(query.status)q.set("filters",JSON.stringify({status:query.status}));
  applyNativeListQuery(q, query);
  return materialRequest(`?${q}`);
}
export async function readMaterial(id:string,includeDeleted=false):Promise<Material>{
  return materialRequest("/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
}
export async function materialHistory(id:string):Promise<MaterialDetail>{
  return materialRequest("/"+encodeURIComponent(id)+"?history=true");
}
export async function saveMaterial(form:MaterialForm,id?:string):Promise<Material>{
  const input={name:form.name.trim(),model:form.model||"",specification:form.specification||"",
    note:form.note||"",status:form.status,
    ...(id?{expected_version:form.version_no}:{unit_id:form.unit_id})};
  return materialRequest(id?"/"+encodeURIComponent(id):"","POST",input);
}
export async function deleteMaterial(id:string,expectedVersion:number){
  return materialRequest("/"+encodeURIComponent(id),"DELETE",{expected_version:expectedVersion});
}
export async function listUnitOptions():Promise<Array<{label:string;value:string}>> {
  const response=await fetch("/api/catalog/units?page=1&page_size=200",{credentials:"same-origin"});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result?.message||"无法获取计量单位");
  return (result.items||[]).filter((unit:{status:string;deleted:boolean})=>
    unit.status==="active"&&!unit.deleted).map((unit:{id:string;name:string})=>({
      label:unit.name,value:unit.id,
    }));
}
export async function bulkUpdateMaterial(items:Array<{id:string;expected_version:number;changes:Record<string,string>}>){
  return materialRequest("/bulk","POST",{rows:items}) as Promise<{count:number;ids:string[]}>;
}
