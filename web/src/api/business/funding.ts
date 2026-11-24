import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
/** Exact-money adapter for the immutable funding domain. */
export type FundingKind = "frameworks" | "agreements";
export interface FundingRow {
  id:string;code:string;name:string;status:"active"|"inactive";
  fiscal_year?:number;framework_id?:string;
  limit_fen:number;version_no:number;created_at:string;
  contract_number?:string|null;counterparty_name?:string|null;
  signed_on?:string|null;effective_from?:string|null;effective_to?:string|null;
  reason?:string|null;deleted?:boolean;
}
export interface FundingForm {
  id?:string;name:string;budget_yuan:string;status:"active"|"inactive";
  fiscal_year?:number;framework_id?:string;version_no?:number;
  code?:string;reason?:string;contract_number?:string;counterparty_name?:string;
  signed_on?:string|null;effective_from?:string|null;effective_to?:string|null;
}
interface Page<T>{items:T[];total:number;page:number;page_size:number}
export interface FundingDetails {
  item:FundingRow;projects:Array<{id:string;name:string;status:string;display_status:string}>;agreements:FundingRow[];
  summary:{project_count:number;approved_budget_fen:number;actual_cost_fen:number;settlement_fen:number;capacity_difference_fen:number};
}
interface FundingImpact {
  expected_version:number;
  projects:Array<{id:string;name:string}>;
  agreements:Array<{id:string;name:string}>;
  reference_ids:string[];
}
const target=(kind:FundingKind)=>"/api/funding/"+kind;
async function request<T>(path:string,method="GET",input?:unknown):Promise<T>{
  const res=await fetch(path,{
    method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
      "Idempotency-Key":randomRequestId()},body:JSON.stringify(input??{})}),
  });
  const payload=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(payload?.message||`HTTP ${res.status}`);
  return payload as T;
}
/** Neither Number.toFixed nor floating-point multiplication is used when saving yuan. */
export function yuanToFen(raw:string):number {
  const value=String(raw??"").trim();
  const match=/^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(value);
  if(!match)throw Error("额度须是非负金额，最多保留两位小数");
  const whole=Number(match[1]),decimal=Number((match[2]||"").padEnd(2,"0"));
  const fen=whole*100+decimal;
  if(!Number.isSafeInteger(fen))throw Error("金额超出安全整数范围");
  return fen;
}
export function fenToYuan(fen:number):string {
  if(!Number.isSafeInteger(fen))throw Error("金额超出安全整数范围");
  const sign=fen<0?"-":"";
  const abs=Math.abs(fen);
  return sign+Math.trunc(abs/100)+"."+String(abs%100).padStart(2,"0");
}
export async function listFunding(kind:FundingKind,args:{
  page?:number;size?:number;keyword?:string;status?:string;
} & NativeListOptions={}):Promise<Page<FundingRow>> {
  const q=new URLSearchParams({page:String(args.page||1),page_size:String(args.size||20),
    q:args.keyword||"",sort:"created_at",direction:"desc"});
  if(args.status)q.set("filters",JSON.stringify({status:args.status}));
  applyNativeListQuery(q, args);
  return request(target(kind)+"?"+q.toString());
}
export const getFunding=(kind:FundingKind,id:string,includeDeleted=false):Promise<FundingRow>=>
  request(target(kind)+"/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
export const getFundingDetails=(kind:FundingKind,id:string):Promise<FundingDetails>=>
  request(target(kind)+"/"+encodeURIComponent(id)+"?detail=true");
export const getFundingHistory=(kind:FundingKind,id:string):Promise<unknown[]>=>
  request(target(kind)+"/history/"+encodeURIComponent(id));
export const getFundingImpact=(kind:FundingKind,id:string):Promise<FundingImpact>=>
  request(target(kind)+"/"+encodeURIComponent(id)+"/deletion-impact");
export async function saveFunding(kind:FundingKind,data:FundingForm,id?:string) {
  const limit_fen=yuanToFen(data.budget_yuan);
  const base={name:data.name.trim(),limit_fen,status:data.status,reason:data.reason||""};
  const values=kind==="frameworks"
    ? {fiscal_year:data.fiscal_year}
    : {framework_id:data.framework_id,contract_number:data.contract_number||null,
      counterparty_name:data.counterparty_name||null,signed_on:data.signed_on||null,
      effective_from:data.effective_from||null,effective_to:data.effective_to||null};
  return request<FundingRow>(target(kind)+(id?"/"+encodeURIComponent(id):""),
    "POST",{...base,...values,...(id?{expected_version:data.version_no}:{})});
}
export async function removeFunding(kind:FundingKind,id:string) {
  const impact=await getFundingImpact(kind,id);
  return {impact,commit:()=>request<{deleted:true}>(target(kind)+"/"+encodeURIComponent(id),
    "DELETE",{expected_version:impact.expected_version,
      expected_references:impact.reference_ids})};
}
