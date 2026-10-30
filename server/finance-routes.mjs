import {settlementEntries,projectProgress,registerSettlement} from './finance.mjs';
import {planSettlementSummary,registerPlanSettlement,projectSettlementSummary,agreementSettlementSummary,frameworkSettlementSummary} from './plan-finance.mjs';
import {settlementDetail,correctSettlement,settlementVoidPreview,voidSettlement} from './settlement-maintenance.mjs';
// Caller owns authentication, JSON limits and response handling; finance owns its routes.
export async function financeRoutes({pathname,method,user,url,permit,parseJson,req,res,json}){
 const progress=pathname.match(/^\/api\/projects\/([^/]+)\/progress$/);
 if(progress&&method==='GET'){permit(user,'view');json(res,200,projectProgress(progress[1]));return true}
 const summary=pathname.match(/^\/api\/(projects|agreements|frameworks)\/([^/]+)\/settlement-summary$/);
 if(summary&&method==='GET'){
  permit(user,'view');const fn={projects:projectSettlementSummary,agreements:agreementSettlementSummary,frameworks:frameworkSettlementSummary}[summary[1]];
  json(res,200,fn(summary[2]));return true;
 }
 const plan=pathname.match(/^\/api\/executions\/([^/]+)\/settlements$/);
 if(plan&&['GET','POST'].includes(method)){
  permit(user,method==='GET'?'view':'settle');
  json(res,method==='GET'?200:201,method==='GET'?planSettlementSummary(plan[1]):registerPlanSettlement(plan[1],await parseJson(req),user));return true;
 }
 const list=pathname.match(/^\/api\/projects\/([^/]+)\/settlements$/);
 if(list&&['GET','POST'].includes(method)){
  permit(user,method==='GET'?'view':'settle');
  const filters=Object.fromEntries(url.searchParams);
  if(method==='GET'&&filters.status&&!['active','voided','all'].includes(filters.status))throw Object.assign(new Error('凭证状态无效'),{status:422});
  json(res,method==='GET'?200:201,method==='GET'?settlementEntries(list[1],filters):registerSettlement(list[1],await parseJson(req),user));return true;
 }
 const entry=pathname.match(/^\/api\/settlements\/([^/]+)(?:\/(void-preview))?$/);
 if(entry&&(['GET','PATCH','DELETE'].includes(method))){
  permit(user,method==='GET'?'view':'settle');
  if(entry[2]&&method!=='GET')return false;
  const result=method==='GET'?(entry[2]?settlementVoidPreview(entry[1]):settlementDetail(entry[1])):
   method==='PATCH'?correctSettlement(entry[1],await parseJson(req),user):voidSettlement(entry[1],await parseJson(req),user);
  json(res,200,result);return true;
 }
 return false;
}
