import {costRoutes} from './cost-routes.mjs';
import {planBudgetDetail,projectPlanBudgetSummary,createPlanBudgetDraft,updatePlanBudgetDraft,deletePlanBudgetDraft,planBudgetDraftDetail,confirmPlanBudget} from '../../application/plan-budgets.mjs';
import {settlementEntries,projectProgress,registerSettlement} from '../../application/finance.mjs';
import {planSettlementSummary,registerPlanSettlement,projectSettlementSummary,agreementSettlementSummary,frameworkSettlementSummary} from '../../application/plan-finance.mjs';
import {settlementDetail,correctSettlement,settlementVoidPreview,voidSettlement} from '../../application/settlement-maintenance.mjs';
// Caller owns authentication, JSON limits and response handling; finance owns its routes.
export async function financeRoutes({pathname,method,user,url,permit,parseJson,req,res,json}){
 if(await costRoutes({pathname,method,user,url,permit,parseJson,req,res,json}))return true;
 const budget=pathname.match(/^\/api\/executions\/([^/]+)\/budget$/);
 if(budget&&method==='GET'){permit(user,'view');json(res,200,planBudgetDetail(budget[1],Object.fromEntries(url.searchParams)));return true}
 const allocation=pathname.match(/^\/api\/projects\/([^/]+)\/plan-budgets$/);
 if(allocation&&method==='GET'){permit(user,'view');json(res,200,projectPlanBudgetSummary(allocation[1]));return true}
 const createBudget=pathname.match(/^\/api\/executions\/([^/]+)\/budget-drafts$/);
 if(createBudget&&method==='POST'){permit(user,'write');json(res,201,createPlanBudgetDraft(createBudget[1],await parseJson(req),user));return true}
 const proposal=pathname.match(/^\/api\/plan-budget-drafts\/([^/]+)(?:\/(confirm))?$/);
 if(proposal){
  permit(user,method==='GET'?'view':proposal[2]?'admin':'write');
  if(proposal[2]&&method==='POST'){json(res,200,confirmPlanBudget(proposal[1],await parseJson(req),user));return true}
  if(!proposal[2]&&method==='GET'){json(res,200,planBudgetDraftDetail(proposal[1]));return true}
  if(!proposal[2]&&method==='PATCH'){json(res,200,updatePlanBudgetDraft(proposal[1],await parseJson(req),user));return true}
  if(!proposal[2]&&method==='DELETE'){json(res,200,deletePlanBudgetDraft(proposal[1],await parseJson(req),user));return true}
 }
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
