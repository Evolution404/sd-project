import type { HandlingTarget, HandlingReviewRow } from "../../../../server/shared/types/handling-batch";
import { randomRequestId } from "@/utils/business/request-id";
export type { HandlingTarget, HandlingReviewRow };
export type HandlingKind = "demands" | "projects";
export function newHandlingKey(){return randomRequestId()}
export async function handleBatch(kind:HandlingKind,items:readonly HandlingTarget[],preview:boolean,key:string):Promise<HandlingReviewRow[]|{count:number}>{
  const action=kind==="demands"?"confirm-batch":"stock-batch";
  const response=await fetch("/api/"+kind+"/"+action+(preview?"/preview":""),{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Idempotency-Key":key},
    body:JSON.stringify({items})
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.message??"批量办理失败（HTTP "+response.status+"）");
  return body;
}
