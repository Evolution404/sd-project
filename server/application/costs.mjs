import {createHash} from 'node:crypto';
import {uid,now,audit,transaction} from '../database/index.mjs';
import {costPlan,currentCost,costDraft,expenseCategory,versionCostShares,isPlanItem,costDraftHistory,insertExpenseDraft,patchExpenseDraft,setExpenseDraftDeleted,confirmedCostByRequest,insertCostEntry,insertCostVersion,addCostShares,setExpenseDraftConfirmed,costShareDetails,costVersions,costVersionShares,costReconRows,planCostBudget,projectCostBudget,projectActualCost,costItemsForPlan,activeExpenseCategories,currentPlanCosts,costDraftsForPlan} from '../database/repositories/costs.mjs';
import {yuanToFen} from '../domain/money.mjs';
import {validateSettlementDate} from './settlement-validation.mjs';
import {costFail as fail,ensureCostReconciliationSources,planCostTotals} from './cost-rules.mjs';
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const plan=id=>costPlan(id)||fail(404,'检修计划不存在');
const current=id=>currentCost(id)||fail(404,'费用记录不存在');
const draft=id=>costDraft(id)||fail(404,'费用草稿不存在');
const checkVersion=(old,value)=>{if(!Number.isSafeInteger(value)||old.version!==value)fail(409,'费用草稿已变化，请刷新');if(old.status!=='draft')fail(409,'费用草稿已确认或删除，请查看历史或另编更正草稿')};
function category(id,existing=null){
 const c=expenseCategory(id);
 if(existing?.category_id===id)return JSON.parse(existing.category_snapshot_json);
 if(!c)fail(422,'请选择有效的费用类别');
 return {id:c.id,name:c.name,version:c.version};
}
function normalize(executionId,body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(422,'费用内容无效');
 plan(executionId);
 const old=body.entry_id?current(body.entry_id):null;
 if(old&&(old.execution_id!==executionId||old.status!=='active'))fail(409,'只能更正本计划有效费用；已撤销费用请查看历史或重新录入新费用');
 if(body.base_version!==(old?.version_no||0))fail(409,'费用核定版本已变化，请刷新核对');
 const kind=body.kind||'record';if(!['record','void'].includes(kind))fail(422,'费用草稿类型无效');
 const reason=required(body.reason||(!old?body.evidence:''),kind==='void'?'撤销依据':old?'更正依据':'费用依据');
 if(kind==='void'){
  if(!old)fail(422,'请选择要撤销的已确认费用');
  return {entry_id:old.entry_id,base_version:old.version_no,kind,category_id:old.category_id,name:old.name,occurred_on:old.occurred_on,amount_fen:old.amount_fen,evidence:old.evidence,reason,
   allocations_json:JSON.stringify(versionCostShares(old.id))};
 }
 category(body.category_id,old);
 const amount=yuanToFen(body.amount_yuan,'实际费用');if(amount<=0)fail(422,'实际费用须大于零');
 const date=required(body.occurred_on,'费用发生日期');validateSettlementDate(date,'费用发生日期');
 if(!Array.isArray(body.allocations)||!body.allocations.length)fail(422,'请选择费用受益工作项并填写分摊金额');
 const seen=new Set();let total=0n;
 const allocations=body.allocations.map(a=>{
  if(!a||typeof a!=='object'||seen.has(a.execution_item_id))fail(422,'费用工作项重复或无效');
  if(!isPlanItem(a.execution_item_id,executionId))fail(422,'费用工作项必须属于当前检修计划');
  seen.add(a.execution_item_id);const part=yuanToFen(a.amount_yuan,'分摊金额');if(part<=0)fail(422,'每项分摊金额须大于零');total+=BigInt(part);
  return {execution_item_id:a.execution_item_id,amount_fen:part};
 }).sort((a,b)=>a.execution_item_id.localeCompare(b.execution_item_id));
 if(total!==BigInt(amount))fail(422,'分摊金额合计必须等于费用金额，不能重复计入整笔费用');
 return {entry_id:old?.entry_id||null,base_version:old?.version_no||0,kind,category_id:body.category_id,
  name:required(body.name,'费用名称'),occurred_on:date,amount_fen:amount,evidence:required(body.evidence,'费用凭据 / 依据'),reason,allocations_json:JSON.stringify(allocations)};
}
export function costDraftDetail(id){
 const row=draft(id);return {...row,allocations:JSON.parse(row.allocations_json),history:costDraftHistory(id).map(r=>({...r,before:r.before_json?JSON.parse(r.before_json):null,after:r.after_json?JSON.parse(r.after_json):null}))};
}
export function createCostDraft(executionId,body,user){
 return transaction(()=>{
  const values=normalize(executionId,body),time=now(),row={id:uid(),execution_id:executionId,...values,version:1,status:'draft',created_by:user.id,created_at:time,updated_by:user.id,updated_at:time};
  insertExpenseDraft(row);
  audit(user.id,'cost_drafts',row.id,'create',null,row,row.reason);return costDraftDetail(row.id);
 });
}
export function updateCostDraft(id,body,user){
 return transaction(()=>{
  const old=draft(id);checkVersion(old,body.version);
  if((body.entry_id||null)!==old.entry_id)fail(422,'不能改挂费用草稿的原费用或计划');
  const values=normalize(old.execution_id,body),row={...old,...values,version:old.version+1,updated_by:user.id,updated_at:now()};
  const keys=[...Object.keys(values),'version','updated_by','updated_at'];patchExpenseDraft(id,row,keys);
  audit(user.id,'cost_drafts',id,'update',old,row,row.reason);return costDraftDetail(id);
 });
}
export function deleteCostDraft(id,body,user){
 return transaction(()=>{
  const old=draft(id);checkVersion(old,body.version);const reason=required(body.reason,'删除依据');
  setExpenseDraftDeleted(id,user.id,now());
  audit(user.id,'cost_drafts',id,'delete',old,draft(id),reason);return costDraftDetail(id);
 });
}
export function confirmCostDraft(id,body,user){
 return transaction(()=>{
  const key=required(body.request_key,'操作标识');if(key.length>150)fail(422,'操作标识过长');
  const fingerprint=hash({id,version:body.version,actor:user.id}),prior=confirmedCostByRequest(key);
  if(prior){if(prior.request_hash!==fingerprint)fail(409,'操作标识已用于其他内容');return prior}
  const d=draft(id);checkVersion(d,body.version);
  const allocations=JSON.parse(d.allocations_json);
  const values=normalize(d.execution_id,{...d,amount_yuan:(d.amount_fen/100).toFixed(2),allocations:allocations.map(a=>({execution_item_id:a.execution_item_id,amount_yuan:(a.amount_fen/100).toFixed(2)}))});
  const old=d.entry_id?current(d.entry_id):null,entryId=d.entry_id||uid(),time=now();
  if(!old)insertCostEntry(entryId,d.execution_id,d.created_by,time);
  const row={id:uid(),entry_id:entryId,draft_id:d.id,version_no:(old?.version_no||0)+1,status:d.kind==='void'?'voided':'active',
   category_id:d.category_id,category_snapshot_json:JSON.stringify(category(d.category_id,old)),name:d.name,occurred_on:d.occurred_on,amount_fen:d.amount_fen,evidence:d.evidence,reason:d.reason,
   confirmed_by:user.id,confirmed_at:time,request_key:key,request_hash:fingerprint};
  insertCostVersion(row);
  const shares=JSON.parse(values.allocations_json);
  addCostShares(row.id,shares,shares.map(()=>uid()));
  ensureCostReconciliationSources();planCostTotals(d.execution_id);
  setExpenseDraftConfirmed(id,entryId,user.id,time);
  audit(user.id,'cost_drafts',id,'confirm',d,draft(id),d.reason);audit(user.id,'cost_entries',entryId,d.kind==='void'?'void':'confirm',old,row,d.reason);return row;
 });
}
export function costDetail(id){
 const entry=current(id);
 return {entry:{...entry,category_snapshot:JSON.parse(entry.category_snapshot_json)},
  allocations:costShareDetails(entry.id),
  versions:costVersions(id).map(v=>({...v,
   category_snapshot:JSON.parse(v.category_snapshot_json),
   allocations:costVersionShares(v.id)})),
  reconciliations:costReconRows(id)};
}
export function planCosts(executionId,filters={}){
 const e=plan(executionId),status=filters.status||'active',draftStatus=filters.draft_status||'draft';
 if(!['active','voided','all'].includes(status)||!['draft','confirmed','deleted','all'].includes(draftStatus))fail(422,'费用查询状态无效');
 const budget=planCostBudget(executionId),totals=planCostTotals(executionId);
 const p=projectCostBudget(e.project_id);
 const projectActual=projectActualCost(e.project_id);
 return {execution_id:executionId,project_id:e.project_id,...totals,project_actual_cost_fen:projectActual,project_approved_budget_fen:p.approved_budget_fen,project_budget_variance_fen:p.approved_budget_fen==null?null:projectActual-p.approved_budget_fen,confirmed_budget_fen:budget?.amount_fen??null,
  budget_variance_fen:budget?totals.actual_cost_fen-budget.amount_fen:null,
  items:costItemsForPlan(executionId),
  categories:activeExpenseCategories(),
  entries:currentPlanCosts(executionId,status)
    .map(v=>({...v,category_snapshot:JSON.parse(v.category_snapshot_json)})),
  drafts:costDraftsForPlan(executionId,draftStatus)
    .map(d=>({...d,allocations:JSON.parse(d.allocations_json)}))};
}
