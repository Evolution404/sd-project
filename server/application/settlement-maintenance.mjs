import {ensureCostReconciliationSources,settlementCostLinks} from './cost-rules.mjs';
import {ensureFinalCompletionBasis} from './completion-rules.mjs';
import {createHash} from 'node:crypto';
import {uid,now,audit,transaction} from '../database/index.mjs';
import {currentSettlement,settlementCommandByKey,saveSettlementCommand,appendSettlementRevision,effectiveSettlementNet,settlementReversedTotal,settlementProject,settlementScope,settlementPlanStatus,originalSettlement,settlementActorName,settlementRevisions,settlementLabels,settlementFamily,settlementFamilyChronological,activePaymentFamily} from '../database/repositories/settlement-maintenance.mjs';
import {yuanToFen,amountFen} from '../domain/money.mjs';
import {settlementFail as fail,validateSettlementDate,ensureSettlementNumber} from './settlement-validation.mjs';
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
const current=id=>currentSettlement(id)||fail(404,'结算凭证不存在');
const signed=e=>e.entry_kind==='payment'?e.amount_fen:-e.amount_fen;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
function validateBody(body,allowed){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(422,'凭证操作内容无效');
 if(Object.keys(body).some(k=>!allowed.includes(k)))fail(422,'包含不支持的字段；凭证的项目、工作项、批准版本和冲销对应不可改挂');
}
function version(entry,value){
 if(!Number.isSafeInteger(value)||value!==entry.version)fail(409,'凭证已被其他操作更新，请刷新后重新处理');
 if(entry.status==='voided')fail(409,'凭证已撤销，请在历史查询中查看');
}
function command(id,action,body,user,work){
 return transaction(()=>{
  const requestKey=required(body.request_key,'操作标识');
  if(requestKey.length>150)fail(422,'操作标识过长');
  const fingerprint=hash({id,action,actor:user.id,body});
  const prior=settlementCommandByKey(requestKey);
  if(prior){
   if(prior.request_hash!==fingerprint)fail(409,'操作标识已用于其他内容，请重新发起操作');
   return JSON.parse(prior.result_json);
  }
  const commandId=uid(),result=work(commandId);
  saveSettlementCommand({id:commandId,key:requestKey,hash:fingerprint,entryId:id,action,actorId:user.id,result,time:now()});
  return result;
 });
}
function append(entry,action,reason,commandId,user){
 appendSettlementRevision({id:uid(),entry,commandId,action,reason,
  actorId:user.id,time:now()});
}
const total=(field,id)=>effectiveSettlementNet(
 field==='project_id'?'project':field==='project_scope_id'?'scope':null,id);
// Enforce the same approved limits for every write path, including voiding a reversal.
function checkBalances(entry,beforeNet){
 const rootId=entry.entry_kind==='payment'?entry.id:entry.reversal_of;
 const root=current(rootId);
 const reversed=settlementReversedTotal(rootId);
 if(reversed>(root.status==='active'?root.amount_fen:0))fail(409,'更正后冲销金额超过原凭证金额，请先更正关联冲销凭证');
 const p=settlementProject(entry.project_id);
 const scope=settlementScope(entry.project_scope_id);
 const projectNet=total('project_id',p.id),scopeNet=total('project_scope_id',scope.id);
 if(projectNet<0||scopeNet<0)fail(409,'操作后净结算不能为负数');
 if(p.approved_budget_fen==null||projectNet>p.approved_budget_fen)fail(409,'项目累计结算超过当前批准预算');
 if(scope.unit_price_fen==null||scopeNet>amountFen(scope.quantity_scaled,scope.unit_price_fen))fail(409,'本需求结算金额超过当前批准范围金额');
 const plan=entry.execution_item_id?settlementPlanStatus(entry.execution_item_id):null;
 if(scopeNet>beforeNet&&(p.status!=='approved'||scope.status!=='active'||plan?.status==='cancelled'))
  fail(409,'已结项项目、退出范围或取消计划只能更正资料或减少净结算；增加净结算需先恢复正式业务依据');
 ensureFinalCompletionBasis(scope.id);ensureCostReconciliationSources();
}
export function settlementDetail(id){
 const entry=current(id);
 const original=originalSettlement(id);
 const root=entry.reversal_of||id;
 const versions=[{...original,version:1,status:'active',action:'record',reason:original.evidence,
  changed_by:original.recorded_by,changed_at:original.created_at,
  changed_by_name:settlementActorName(original.recorded_by)},
 ...settlementRevisions(id)];
 const labels=settlementLabels(id);
 return {entry:{...entry,...labels},original,versions,related:settlementFamilyChronological(root)};
}
export function correctSettlement(id,body,user){
 validateBody(body,['request_key','version','reason','settlement_no','settlement_type','amount_yuan','occurred_on','evidence']);
 return command(id,'correct',body,user,commandId=>{
  const entry=current(id);version(entry,body.version);
  const reason=required(body.reason,'更正依据');
  const next={...entry,settlement_no:required(body.settlement_no,'凭证编号'),
   amount_fen:yuanToFen(body.amount_yuan,'结算金额'),occurred_on:required(body.occurred_on,'结算日期'),
   evidence:required(body.evidence,'结算凭证依据')};
  if(next.amount_fen<=0)fail(422,'结算金额须大于零');
  validateSettlementDate(next.occurred_on);ensureSettlementNumber(next.settlement_no,id);
  if(entry.entry_kind==='payment'){
   if(!['advance','progress','final'].includes(body.settlement_type))fail(422,'结算性质无效');
   next.settlement_type=body.settlement_type;
  }else if(body.settlement_type!=null&&body.settlement_type!=='')fail(422,'冲销凭证不能改为正向结算性质');
  const before=total('project_scope_id',entry.project_scope_id);
  append(next,'correct',reason,commandId,user);checkBalances(next,before);
  const result=settlementDetail(id);
  audit(user.id,'project_settlement_entries',id,'correct',entry,result.entry,reason);
  return result;
 });
}
export function settlementVoidPreview(id){
 const entry=current(id);
 const affected=entry.status==='voided'?[]:entry.entry_kind==='payment'
  ?activePaymentFamily(id):[entry];
 // Include all sibling versions: a concurrent correction/reversal changes the confirmation.
 const family=settlementFamily(entry.reversal_of||id);
 const costLinks=settlementCostLinks(entry.entry_kind==='payment'?id:entry.reversal_of);
 return {entry,affected,cost_reconciliations:costLinks,net_change_fen:-affected.reduce((s,e)=>s+signed(e),0),
  preview_token:hash({entry,family,costLinks})};
}
export function voidSettlement(id,body,user){
 validateBody(body,['request_key','version','reason','preview_token','affected_ids']);
 return command(id,'void',body,user,commandId=>{
  const entry=current(id);version(entry,body.version);
  const reason=required(body.reason,'撤销依据');
  const preview=settlementVoidPreview(id);
  if(!body.preview_token||body.preview_token!==preview.preview_token)fail(409,'凭证或关联冲销已发生变化，请重新查看撤销影响后确认');
  if(!Array.isArray(body.affected_ids)||hash([...body.affected_ids].sort())!==hash(preview.affected.map(e=>e.id).sort()))
   fail(422,'请明确确认预览中全部将撤销的凭证');
  const before=total('project_scope_id',entry.project_scope_id);
  for(const row of preview.affected){
   append(row,'void',reason,commandId,user);
   audit(user.id,'project_settlement_entries',row.id,'void',row,current(row.id),reason);
  }
  checkBalances(entry,before);
  return {...settlementDetail(id),affected_ids:preview.affected.map(e=>e.id),net_change_fen:preview.net_change_fen};
 });
}
