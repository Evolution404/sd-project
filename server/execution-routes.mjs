import {listExecutions,executionDetail,createExecution,addExecutionItem,changeExecutionStage,confirmCompletion} from './executions.mjs';
import {completionRecords,completionDetail,correctCompletion,completionVoidPreview,voidCompletion} from './completion-maintenance.mjs';
export async function executionRoutes({pathname,method,user,url,permit,parseJson,req,res,json}){
 const records=pathname.match(/^\/api\/executions\/([^/]+)\/completion-records$/);
 if(records&&method==='GET'){permit(user,'view');json(res,200,completionRecords(records[1],Object.fromEntries(url.searchParams)));return true}
 const record=pathname.match(/^\/api\/completion-records\/([^/]+)(?:\/(void-preview))?$/);
 if(record&&['GET','PATCH','DELETE'].includes(method)){
  permit(user,method==='GET'?'view':'write');if(record[2]&&method!=='GET')return false;
  const result=method==='GET'?(record[2]?completionVoidPreview(record[1]):completionDetail(record[1])):
   method==='PATCH'?correctCompletion(record[1],await parseJson(req),user):voidCompletion(record[1],await parseJson(req),user);
  json(res,200,result);return true;
 }
 const list=pathname.match(/^\/api\/projects\/([^/]+)\/executions$/);
 if(list&&['GET','POST'].includes(method)){
  permit(user,method==='GET'?'view':'write');json(res,method==='GET'?200:201,
   method==='GET'?listExecutions(list[1]):createExecution(list[1],await parseJson(req),user));return true;
 }
 const e=pathname.match(/^\/api\/executions\/([^/]+)(?:\/(start|finish|cancel|items)(?:\/([^/]+)\/(complete))?)?$/);
 if(e){
  permit(user,method==='GET'?'view':'write');const [,id,action,itemId,subAction]=e;
  if(method==='GET'&&!action){json(res,200,executionDetail(id));return true}
  if(method==='POST'&&action==='items'&&!itemId){json(res,201,addExecutionItem(id,await parseJson(req),user));return true}
  if(method==='POST'&&['start','finish','cancel'].includes(action)){
   json(res,200,changeExecutionStage(id,{start:'running',finish:'finished',cancel:'cancelled'}[action],await parseJson(req),user));return true;
  }
  if(method==='POST'&&action==='items'&&subAction==='complete'){json(res,201,confirmCompletion(id,itemId,await parseJson(req),user));return true}
 }
 return false;
}
