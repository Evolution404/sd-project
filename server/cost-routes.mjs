import {planCosts,costDetail,costDraftDetail,createCostDraft,updateCostDraft,deleteCostDraft,confirmCostDraft} from './costs.mjs';
import {planCostReconciliations,costReconciliationDetail,recordCostReconciliation} from './cost-reconciliation.mjs';
export async function costRoutes({pathname,method,user,url,permit,parseJson,req,res,json}){
 const readBody=async()=>{const b=await parseJson(req);if(!b||typeof b!=='object'||Array.isArray(b))throw Object.assign(new Error('费用操作内容必须为对象'),{status:422});return b};
 const list=pathname.match(/^\/api\/executions\/([^/]+)\/(costs|cost-drafts|cost-reconciliations)$/);
 if(list){
  const [,id,kind]=list;
  permit(user,method==='GET'?'view':kind==='cost-reconciliations'?'admin':'write');
  if(method==='GET'&&kind==='costs'){json(res,200,planCosts(id,Object.fromEntries(url.searchParams)));return true}
  if(method==='GET'&&kind==='cost-reconciliations'){json(res,200,planCostReconciliations(id,Object.fromEntries(url.searchParams)));return true}
  if(method==='POST'&&kind==='cost-drafts'){json(res,201,createCostDraft(id,await readBody(),user));return true}
  if(method==='POST'&&kind==='cost-reconciliations'){json(res,201,recordCostReconciliation(id,null,await readBody(),user));return true}
 }
 const d=pathname.match(/^\/api\/cost-drafts\/([^/]+)(?:\/(confirm))?$/);
 if(d){
  permit(user,method==='GET'?'view':d[2]?'admin':'write');
  if(d[2]&&method==='POST'){json(res,200,confirmCostDraft(d[1],await readBody(),user));return true}
  if(!d[2]&&method==='GET'){json(res,200,costDraftDetail(d[1]));return true}
  if(!d[2]&&method==='PATCH'){json(res,200,updateCostDraft(d[1],await readBody(),user));return true}
  if(!d[2]&&method==='DELETE'){json(res,200,deleteCostDraft(d[1],await readBody(),user));return true}
 }
 const c=pathname.match(/^\/api\/costs\/([^/]+)$/);
 if(c&&method==='GET'){permit(user,'view');json(res,200,costDetail(c[1]));return true}
 const match=pathname.match(/^\/api\/cost-reconciliations\/([^/]+)$/);
 if(match&&['GET','PATCH','DELETE'].includes(method)){
  permit(user,method==='GET'?'view':'admin');json(res,200,method==='GET'?costReconciliationDetail(match[1]):recordCostReconciliation(null,match[1],await readBody(),user,method==='DELETE'));return true;
 }
 return false;
}
