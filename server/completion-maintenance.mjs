import {readDemandSnapshot} from './demand-snapshots.mjs';
import {createHash} from 'node:crypto';
import {one,all,exec,uid,now,audit,transaction} from './db.mjs';
import {quantityToScaled} from './quantity.mjs';
import {validateSettlementDate} from './settlement-validation.mjs';
import {completionFail as fail,ensureCompletionLimits,scopeCompletionUsage,activeFinalSettlements,unsupportedFinalSettlements} from './completion-rules.mjs';
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const current=id=>one('SELECT * FROM completion_current WHERE id=?',id)||fail(404,'完成记录不存在');
const context=entry=>one(`SELECT i.*,e.project_id,e.number AS plan_number,e.status AS plan_status,e.version AS plan_version,
 e.approval_version_id,s.quantity_scaled AS current_scope_quantity_scaled,s.status AS scope_status,s.demand_id,
 d.demand_no,d.unit_snapshot,s.demand_snapshot_json,p.version AS project_version,p.status AS project_status
 FROM execution_items i JOIN executions e ON e.id=i.execution_id JOIN projects p ON p.id=e.project_id
 JOIN project_demand_scopes s ON s.id=i.project_scope_id JOIN demands d ON d.id=s.demand_id WHERE i.id=?`,entry.execution_item_id);
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
 if(!one('SELECT 1 FROM executions WHERE id=?',executionId))fail(404,'检修计划不存在');
 const status=filters.status||'active';if(!['active','voided','all'].includes(status))fail(422,'完成记录状态无效');
 return all(`SELECT c.*,s.demand_id,d.demand_no,d.unit_snapshot,i.scope_snapshot_json,s.demand_snapshot_json,u.username AS confirmed_by_name
 FROM completion_current c JOIN execution_items i ON i.id=c.execution_item_id
 JOIN project_demand_scopes s ON s.id=i.project_scope_id JOIN demands d ON d.id=s.demand_id
 JOIN users u ON u.id=c.confirmed_by WHERE i.execution_id=? AND (?='all' OR c.status=?)
 ORDER BY c.occurred_on DESC,c.confirmed_at DESC,c.id`,executionId,status,status).map(({scope_snapshot_json,demand_snapshot_json,...row})=>({...row,...adoptedLabels({scope_snapshot_json,demand_snapshot_json})}));
}
export function completionDetail(id){
 const entry=current(id),info={...context(entry),...adoptedLabels(context(entry))},original=one('SELECT * FROM completion_records WHERE id=?',id);
 return {entry:{...entry,...Object.fromEntries(['execution_id','project_id','plan_number','plan_status','approval_version_id','project_scope_id','demand_no','unit_snapshot'].map(k=>[k,info[k]]))},original,
 versions:[{...original,version:1,status:'active',action:'record',reason:original.evidence,changed_at:original.confirmed_at,
 changed_by_name:one('SELECT username FROM users WHERE id=?',original.confirmed_by)?.username},
 ...all(`SELECT r.*,u.username AS changed_by_name FROM completion_revisions r JOIN users u ON u.id=r.changed_by
 WHERE r.record_id=? ORDER BY r.version`,id)]};
}
function append(entry,action,reason,commandId,user){
 exec(`INSERT INTO completion_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,uid(),entry.id,entry.version+1,commandId,
 action,action==='void'?'voided':'active',entry.quantity_scaled,entry.occurred_on,entry.evidence,reason,user.id,now());
}
function command(id,action,body,user,work){
 return transaction(()=>{
  const key=required(body.request_key,'操作标识');if(key.length>150)fail(422,'操作标识过长');
  const fingerprint=hash({id,action,body,actor:user.id}),prior=one('SELECT * FROM completion_commands WHERE request_key=?',key);
  if(prior){if(prior.request_hash!==fingerprint)fail(409,'操作标识已用于其他内容');return JSON.parse(prior.result_json)}
  const commandId=uid(),result=work(commandId);
  exec('INSERT INTO completion_commands VALUES(?,?,?,?,?,?,?,?)',commandId,key,fingerprint,id,action,user.id,JSON.stringify(result),now());return result;
 });
}
function apply(entry,action,reason,commandId,user,before=entry){
 const info=context(entry);append(entry,action,reason,commandId,user);ensureCompletionLimits(entry.execution_item_id);
 exec('UPDATE executions SET version=version+1,updated_at=? WHERE id=?',now(),info.execution_id);
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
 const siblings=all(`SELECT i.id,i.planned_quantity_scaled,e.version,e.status,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c WHERE c.execution_item_id=i.id),0) AS completed_quantity_scaled
 FROM execution_items i JOIN executions e ON e.id=i.execution_id WHERE i.project_scope_id=? ORDER BY i.id`,info.project_scope_id);
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
