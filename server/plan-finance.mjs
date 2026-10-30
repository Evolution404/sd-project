import {projectPlanBudgetSummary} from './plan-budgets.mjs';
import {one,all} from './db.mjs';
import {amountFen} from './money.mjs';
import {registerSettlement} from './finance.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const plan=id=>one('SELECT * FROM executions WHERE id=?',id)||fail(404,'检修计划不存在');
const project=id=>one('SELECT * FROM projects WHERE id=?',id)||fail(404,'子项目不存在');
const netQuery="SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) amount FROM effective_settlement_entries";
function estimate(snapshot,quantity){
 if(!snapshot)return null;
 try {const p=JSON.parse(snapshot);return p.unit_price_fen==null?null:amountFen(quantity,p.unit_price_fen)}
 catch{return null}
}
// Only explicitly allocated vouchers contribute to plan-level figures.
// Unallocated project vouchers are never automatically distributed among plans.
export function planSettlementSummary(planId){
 const e=plan(planId);
 const items=all(`SELECT i.id,i.project_scope_id,i.planned_quantity_scaled,i.scope_snapshot_json,
  d.demand_no,
  COALESCE((SELECT SUM(c.quantity_scaled) FROM completion_records c WHERE c.execution_item_id=i.id),0) completed_quantity_scaled,
  COALESCE((SELECT SUM(CASE WHEN se.entry_kind='payment' THEN se.amount_fen ELSE -se.amount_fen END)
    FROM effective_settlement_entries se WHERE se.execution_item_id=i.id),0) settled_fen
  FROM execution_items i
  JOIN project_demand_scopes s ON s.id=i.project_scope_id
  JOIN demands d ON d.id=s.demand_id
  WHERE i.execution_id=? ORDER BY i.created_at,i.id`,planId)
 .map(i=>({...i,planned_estimate_fen:estimate(i.scope_snapshot_json,i.planned_quantity_scaled)}));
 const entries=all(`SELECT se.* FROM effective_settlement_entries se
  JOIN execution_items i ON i.id=se.execution_item_id
  WHERE i.execution_id=? ORDER BY se.occurred_on DESC,se.created_at DESC,se.id DESC`,planId);
 return {execution_id:e.id,project_id:e.project_id,number:e.number,plan_type:e.plan_type,
  status:e.status,project_status:project(e.project_id).status,approval_version_id:e.approval_version_id,
  item_count:items.length,planned_estimate_fen:items.reduce((sum,i)=>sum+(i.planned_estimate_fen||0),0),
  estimate_complete:items.every(i=>i.planned_estimate_fen!==null),
  settled_fen:items.reduce((sum,i)=>sum+i.settled_fen,0),items,entries};
}
export function registerPlanSettlement(executionId,body,user){
 const e=plan(executionId),itemId=body.execution_item_id;
 if(typeof itemId!=='string'||!itemId.trim())fail(422,'必须选择此检修计划内的工作明细');
 const item=one('SELECT project_scope_id FROM execution_items WHERE id=? AND execution_id=?',itemId,executionId);
 if(!item)fail(422,'结算工作项不属于当前检修计划');
 return registerSettlement(e.project_id,{...body,scope_id:item.project_scope_id,execution_item_id:itemId},user);
}
export function projectSettlementSummary(projectId){
 const p=project(projectId),budgetAllocation=projectPlanBudgetSummary(projectId);
 const plans=all('SELECT id FROM executions WHERE project_id=? ORDER BY created_at,number',projectId)
  .map(row=>{
   const s=planSettlementSummary(row.id);
   return {execution_id:s.execution_id,number:s.number,plan_type:s.plan_type,status:s.status,
    planned_estimate_fen:s.planned_estimate_fen,estimate_complete:s.estimate_complete,settled_fen:s.settled_fen,
    confirmed_budget_fen:budgetAllocation.plans.find(p=>p.execution_id===s.execution_id)?.confirmed_budget_fen??null};
  });
 const unallocated=one(netQuery+' WHERE project_id=? AND execution_item_id IS NULL',projectId).amount;
 const total=one(netQuery+' WHERE project_id=?',projectId).amount;
 const allocated=plans.reduce((sum,item)=>sum+item.settled_fen,0);
 if(allocated+unallocated!==total)fail(409,'结算分配与项目总额对账失败');
 return {project_id:p.id,framework_id:p.framework_id,agreement_id:p.agreement_id,
  status:p.status,approved_budget_fen:p.approved_budget_fen,
  settled_fen:total,allocated_fen:allocated,unallocated_fen:unallocated,
  allocated_plan_budget_fen:budgetAllocation.allocated_budget_fen,unallocated_plan_budget_fen:budgetAllocation.unallocated_budget_fen,plans};
}
export function agreementSettlementSummary(agreementId){
 const a=one('SELECT * FROM agreements WHERE id=?',agreementId);
 if(!a)fail(404,'协行协议不存在');
 const projects=all('SELECT id FROM projects WHERE agreement_id=? ORDER BY created_at',agreementId)
  .map(p=>projectSettlementSummary(p.id));
 return {agreement_id:a.id,framework_id:a.framework_id,limit_fen:a.limit_fen,
  approved_budget_fen:projects.reduce((s,p)=>s+(['approved','closed'].includes(p.status)?p.approved_budget_fen||0:0),0),
  allocated_plan_budget_fen:projects.reduce((s,p)=>s+p.allocated_plan_budget_fen,0),
  settled_fen:projects.reduce((s,p)=>s+p.settled_fen,0),
  unallocated_fen:projects.reduce((s,p)=>s+p.unallocated_fen,0),projects};
}
export function frameworkSettlementSummary(frameworkId){
 const f=one('SELECT * FROM frameworks WHERE id=?',frameworkId);
 if(!f)fail(404,'年度框架不存在');
 const projects=all('SELECT id FROM projects WHERE framework_id=? ORDER BY created_at',frameworkId)
  .map(p=>projectSettlementSummary(p.id));
 const agreements=all('SELECT id,name,limit_fen FROM agreements WHERE framework_id=? ORDER BY created_at',frameworkId)
  .map(a=>({...a,allocated_plan_budget_fen:projects.filter(p=>p.agreement_id===a.id).reduce((s,p)=>s+p.allocated_plan_budget_fen,0),settled_fen:projects.filter(p=>p.agreement_id===a.id).reduce((s,p)=>s+p.settled_fen,0)}));
 return {framework_id:f.id,limit_fen:f.limit_fen,
  approved_budget_fen:projects.reduce((s,p)=>s+(['approved','closed'].includes(p.status)?p.approved_budget_fen||0:0),0),
  allocated_plan_budget_fen:projects.reduce((s,p)=>s+p.allocated_plan_budget_fen,0),
  settled_fen:projects.reduce((s,p)=>s+p.settled_fen,0),
  unallocated_fen:projects.reduce((s,p)=>s+p.unallocated_fen,0),
  projects_without_agreement:projects.filter(p=>!p.agreement_id).length,agreements,projects};
}
