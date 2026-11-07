import {planCostTotals} from './cost-rules.mjs';
import {projectPlanBudgetSummary} from './plan-budgets.mjs';
import {financePlan,financeProject,financeAgreement,financeFramework,planFinanceItems,planFinanceVouchers,financeItemWithinPlan,planIdsForProject,projectIdsForAgreement,projectIdsForFramework,agreementsForFramework,projectNetSettled} from '../database/queries/plan-finance.mjs';
import {amountFen} from '../domain/money.mjs';
import {registerSettlement} from './finance.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const plan=id=>financePlan(id)||fail(404,'检修计划不存在');
const project=id=>financeProject(id)||fail(404,'子项目不存在');
function estimate(snapshot,quantity){
 if(!snapshot)return null;
 try {const p=JSON.parse(snapshot);return p.unit_price_fen==null?null:amountFen(quantity,p.unit_price_fen)}
 catch{return null}
}
// Only explicitly allocated vouchers contribute to plan-level figures.
// Unallocated project vouchers are never automatically distributed among plans.
export function planSettlementSummary(planId){
 const e=plan(planId);
 const items=planFinanceItems(planId)
 .map(i=>({...i,planned_estimate_fen:estimate(i.scope_snapshot_json,i.planned_quantity_scaled)}));
 const entries=planFinanceVouchers(planId);
 return {...planCostTotals(e.id),execution_id:e.id,project_id:e.project_id,number:e.number,plan_type:e.plan_type,
  status:e.status,project_status:project(e.project_id).status,approval_version_id:e.approval_version_id,
  item_count:items.length,planned_estimate_fen:items.reduce((sum,i)=>sum+(i.planned_estimate_fen||0),0),
  estimate_complete:items.every(i=>i.planned_estimate_fen!==null),
  settled_fen:items.reduce((sum,i)=>sum+i.settled_fen,0),items,entries};
}
export function registerPlanSettlement(executionId,body,user){
 const e=plan(executionId),itemId=body.execution_item_id;
 if(typeof itemId!=='string'||!itemId.trim())fail(422,'必须选择此检修计划内的工作明细');
 const item=financeItemWithinPlan(itemId,executionId);
 if(!item)fail(422,'结算工作项不属于当前检修计划');
 return registerSettlement(e.project_id,{...body,scope_id:item.project_scope_id,execution_item_id:itemId},user);
}
export function projectSettlementSummary(projectId){
 const p=project(projectId),budgetAllocation=projectPlanBudgetSummary(projectId);
 const budgetByExecution=new Map(budgetAllocation.plans.map(row=>[row.execution_id,row.confirmed_budget_fen]));
 const plans=planIdsForProject(projectId)
  .map(row=>{
   const s=planSettlementSummary(row.id);
   return {execution_id:s.execution_id,number:s.number,plan_type:s.plan_type,status:s.status,
    actual_cost_fen:s.actual_cost_fen,pending_final_expense_fen:s.pending_final_expense_fen,
    planned_estimate_fen:s.planned_estimate_fen,estimate_complete:s.estimate_complete,settled_fen:s.settled_fen,
    confirmed_budget_fen:budgetByExecution.get(s.execution_id)??null};
  });
 const unallocated=projectNetSettled(projectId,true);
 const total=projectNetSettled(projectId);
 const allocated=plans.reduce((sum,item)=>sum+item.settled_fen,0);
 if(allocated+unallocated!==total)fail(409,'结算分配与项目总额对账失败');
 return {project_id:p.id,framework_id:p.framework_id,agreement_id:p.agreement_id,
  status:p.status,approved_budget_fen:p.approved_budget_fen,
  actual_cost_fen:plans.reduce((n,p)=>n+p.actual_cost_fen,0),pending_final_expense_fen:plans.reduce((n,p)=>n+p.pending_final_expense_fen,0),
  settled_fen:total,allocated_fen:allocated,unallocated_fen:unallocated,
  allocated_plan_budget_fen:budgetAllocation.allocated_budget_fen,unallocated_plan_budget_fen:budgetAllocation.unallocated_budget_fen,plans};
}
export function agreementSettlementSummary(agreementId){
 const a=financeAgreement(agreementId);
 if(!a)fail(404,'协行协议不存在');
 const projects=projectIdsForAgreement(agreementId)
  .map(p=>projectSettlementSummary(p.id));
 return {agreement_id:a.id,framework_id:a.framework_id,limit_fen:a.limit_fen,
  approved_budget_fen:projects.reduce((s,p)=>s+(['approved','closed'].includes(p.status)?p.approved_budget_fen||0:0),0),
  actual_cost_fen:projects.reduce((n,p)=>n+p.actual_cost_fen,0),pending_final_expense_fen:projects.reduce((n,p)=>n+p.pending_final_expense_fen,0),
  allocated_plan_budget_fen:projects.reduce((s,p)=>s+p.allocated_plan_budget_fen,0),
  settled_fen:projects.reduce((s,p)=>s+p.settled_fen,0),
  unallocated_fen:projects.reduce((s,p)=>s+p.unallocated_fen,0),projects};
}
export function frameworkSettlementSummary(frameworkId){
 const f=financeFramework(frameworkId);
 if(!f)fail(404,'年度框架不存在');
 const projects=projectIdsForFramework(frameworkId)
  .map(p=>projectSettlementSummary(p.id));
 const totalsByAgreement=new Map();
 for(const project of projects){
  if(!project.agreement_id)continue;
  const totals=totalsByAgreement.get(project.agreement_id)||{allocated_plan_budget_fen:0,settled_fen:0};
  totals.allocated_plan_budget_fen+=project.allocated_plan_budget_fen;
  totals.settled_fen+=project.settled_fen;
  totalsByAgreement.set(project.agreement_id,totals);
 }
 const agreements=agreementsForFramework(frameworkId)
  .map(a=>({...a,...(totalsByAgreement.get(a.id)||{allocated_plan_budget_fen:0,settled_fen:0})}));
 return {framework_id:f.id,limit_fen:f.limit_fen,
  approved_budget_fen:projects.reduce((s,p)=>s+(['approved','closed'].includes(p.status)?p.approved_budget_fen||0:0),0),
  actual_cost_fen:projects.reduce((n,p)=>n+p.actual_cost_fen,0),pending_final_expense_fen:projects.reduce((n,p)=>n+p.pending_final_expense_fen,0),
  allocated_plan_budget_fen:projects.reduce((s,p)=>s+p.allocated_plan_budget_fen,0),
  settled_fen:projects.reduce((s,p)=>s+p.settled_fen,0),
  unallocated_fen:projects.reduce((s,p)=>s+p.unallocated_fen,0),
  projects_without_agreement:projects.filter(p=>!p.agreement_id).length,agreements,projects};
}
