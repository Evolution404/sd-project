import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
/** Y4 dictionary DTOs; stable IDs and versioned definitions are server owned. */
export type DictionaryKind = "units"|"priorities"|"categories"|"tower_natures"|"tower_materials";
export interface DictionaryRow {
  id:string;code:string;name:string;status:"active"|"inactive";
  version:number;quantity_precision?:number;sort_order:number;
  changed_at:string;created_at:string;reason:string;deleted:boolean;
}
export interface DictionaryForm {
  id?:string;code?:string;name:string;status:"active"|"inactive";
  version?:number;quantity_precision?:number;reason?:string;
}
interface Page<T>{items:T[];total:number}
interface DictionaryVersion {
  id:string;version:number;name:string;status:string;
  quantity_precision?:number;changed_at:string;reason:string;
}
export interface DictionaryDetail{
  item:DictionaryRow;versions:DictionaryVersion[];audits:unknown[];
}
export interface DictionaryImpact {
  references:number;expected_version:number;
}
const resource=(kind:DictionaryKind)=>"/api/catalog/"+kind;
async function req<T>(path:string,method="GET",data?:unknown):Promise<T> {
  const res=await fetch(path,{
    method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{
      "Content-Type":"application/json",
      "Idempotency-Key":randomRequestId(),
    },body:JSON.stringify(data??{})}),
  });
  const payload=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(payload?.message||`HTTP ${res.status}`);
  return payload as T;
}
export async function listDictionaries(kind:DictionaryKind,args:{
  page?:number;size?:number;keyword?:string;status?:string
} & NativeListOptions={}):Promise<Page<DictionaryRow>> {
  const q=new URLSearchParams({
    page:String(args.page||1),page_size:String(args.size||20),
    q:args.keyword||"",sort:"created_at",direction:"desc",
  });
  if(args.status)q.set("filters",JSON.stringify({status:args.status}));
  applyNativeListQuery(q, args);
  return req(resource(kind)+"?"+q);
}
export const readDictionary=(kind:DictionaryKind,id:string):Promise<DictionaryRow>=>
  req(resource(kind)+"/"+encodeURIComponent(id));
export const dictionaryDetail=(kind:DictionaryKind,id:string):Promise<DictionaryDetail>=>
  req(resource(kind)+"/"+encodeURIComponent(id)+"?history=true");
export const dictionaryImpact=(kind:DictionaryKind,id:string):Promise<DictionaryImpact>=>
  req(resource(kind)+"/"+encodeURIComponent(id)+"/deletion-impact");
export async function saveDictionary(kind:DictionaryKind,data:DictionaryForm,id?:string){
  const precision=data.quantity_precision??0;
  const input={name:data.name.trim(),status:data.status,reason:data.reason||"",
    ...(kind==="units"?{quantity_precision:precision}:{}),
    ...(id?{expected_version:data.version}:{})};
  if(kind==="units"&&(!Number.isSafeInteger(precision)
    || precision<0||precision>4))
    throw Error("计量单位数量精度必须是 0～4 位整数");
  return req<DictionaryRow>(resource(kind)+(id?"/"+encodeURIComponent(id):""),"POST",input);
}
export async function removeDictionary(kind:DictionaryKind,id:string){
  const impact=await dictionaryImpact(kind,id);
  return {impact,commit:()=>req(resource(kind)+"/"+encodeURIComponent(id),
    "DELETE",{expected_version:impact.expected_version,expected_references:impact.references})};
}
