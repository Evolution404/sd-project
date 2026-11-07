import {readDemandSnapshot} from '../database/repositories/demand-snapshots.mjs';
import {createHash} from 'node:crypto';
import {uid,now,audit,transaction} from '../database/index.mjs';
import {completedRecord,completionItemContext,completionPlanExists,completedPlanRows,originalCompletedRecord,completionUserName,completionHistory,completionCommandByKey,appendCompletionRevision,saveCompletionCommand,touchExecutionForCompletion,completionScopeSiblings} from '../database/repositories/completions.mjs';
import {quantityToScaled} from '../domain/quantity.mjs';
import {validateSettlementDate} from './settlement-validation.mjs';
import {completionFail as fail,ensureCompletionLimits,scopeCompletionUsage,activeFinalSettlements,unsupportedFinalSettlements} from './completion-rules.mjs';
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const current=id=>completedRecord(id)||fail(404,'完成记录不存在');
const context=entry=>completionItemContext(entry.execution_item_id);
function adoptedLabels(row){
 const archived=row.scope_snapshot_json?JSON.parse(row.scope_snapshot_json):null;
 const d=readDemandSnapshot({demand_snapshot_json:archived?.demand_snapshot_json||row.demand_snapshot_json});
 if(!d)fail(409,'原批准需求快照缺失，请先核对历史依据');
 return {demand_no:d.demand_no,unit_snapshot:d.unit_snapshot};
}
function validateBody(body,fields){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))fail(422,'完成记录包含不支持的字段；所属计划、工作项和批准依据不可改挂');
}
function guard(entry,version){
 if(!Number.isSafeInteger(version)||entry.version!==version)fail(409,'完成记录已变化，请刷新后重新处理');
 if(entry.status!=='active')fail(409,'完成记录已撤销，请查看历史');
}
export function completionRecords(executionId,filters={}){
 if(!completionPlanExists(executionId))fail(404,'检修计划不存在');
 const status=filters.status||'active';if(!['active','voided','all'].includes(status))fail(422,'完成记录状态无效');
 return completedPlanRows(executionId,status).map(({scope_snapshot_json,demand_snapshot_json,...row})=>({...row,...adoptedLabels({scope_snapshot_json,demand_snapshot_json})}));
}
export function completionDetail(id){
 const entry=current(id),info={...context(entry),...adoptedLabels(context(entry))},original=originalCompletedRecord(id);
 return {entry:{...entry,...Object.fromEntries(['execution_id','project_id','plan_number','plan_status','approval_version_id','project_scope_id','demand_no','unit_snapshot'].map(k=>[k,info[k]]))},original,
 versions:[{...original,version:1,status:'active',action:'record',reason:original.evidence,changed_at:original.confirmed_at,
 changed_by_name:completionUserName(original.confirmed_by)},
 ...completionHistory(id)]};
}
function append(entry,action,reason,commandId,user){
 appendCompletionRevision({id:uid(),entry,commandId,action,reason,
  actorId:user.id,time:now()});
}
function command(id,action,body,user,work){
 return transaction(()=>{
  const key=required(body.request_key,'操作标识');if(key.length>150)fail(422,'操作标识过长');
  const fingerprint=hash({id,action,body,actor:user.id}),prior=completionCommandByKey(key);
  if(prior){if(prior.request_hash!==fingerprint)fail(409,'操作标识已用于其他内容');return JSON.parse(prior.result_json)}
  const commandId=uid(),result=work(commandId);
  saveCompletionCommand({id:commandId,key,hash:fingerprint,recordId:id,action,actorId:user.id,result,time:now()});return result;
 });
}
function apply(entry,action,reason,commandId,user,before=entry){
 const info=context(entry);append(entry,action,reason,commandId,user);ensureCompletionLimits(entry.execution_item_id);
 touchExecutionForCompletion(info.execution_id,now());
 const result=completionDetail(entry.id);audit(user.id,'completion_records',entry.id,action,before,result.entry,reason);return result;
}
export function correctCompletion(id,body,user){
 validateBody(body,['request_key','version','quantity','occurred_on','evidence','reason']);
 return command(id,'correct',body,user,commandId=>{
  const entry=current(id);guard(entry,body.version);
  const next={...entry,quantity_scaled:quantityToScaled(body.quantity),occurred_on:required(body.occurred_on,'实际完成日期'),evidence:required(body.evidence,'实施/验收依据')};
  validateSettlementDate(next.occurred_on,'实际完成日期');
  return apply(next,'correct',required(body.reason,'更正依据'),commandId,user,entry);
 });
}
export function completionVoidPreview(id){
 const entry=current(id),info={...context(entry),...adoptedLabels(context(entry))},active=entry.status==='active',quantity=active?entry.quantity_scaled:0;
 const before=scopeCompletionUsage(info.project_scope_id),released=info.plan_status==='finished'?quantity:0;
 const blocking=active?unsupportedFinalSettlements(info.project_scope_id,id):[];
 const siblings=completionScopeSiblings(info.project_scope_id);
 return {entry:{...entry,demand_no:info.demand_no,unit_snapshot:info.unit_snapshot},plan_status:info.plan_status,
 quantity_change_scaled:-quantity,released_quantity_scaled:released,scope_committed_before_scaled:before,
 scope_committed_after_scaled:before-released,blocking_settlements:blocking,
 preview_token:hash({entry,info,siblings,settlements:activeFinalSettlements(info.project_scope_id)})};
}
export function voidCompletion(id,body,user){
 validateBody(body,['request_key','version','reason','preview_token']);
 return command(id,'void',body,user,commandId=>{
  const entry=current(id);guard(entry,body.version);const preview=completionVoidPreview(id);
  if(!body.preview_token||body.preview_token!==preview.preview_token)fail(409,'完成记录、计划安排或结算依据已变化，请重新核对撤销影响');
  return apply(entry,'void',required(body.reason,'撤销依据'),commandId,user);
 });
}
