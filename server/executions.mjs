import {readDemandSnapshot} from './demand-snapshots.mjs';
import {createHash} from 'node:crypto';
import {uid,now,one,all,exec,transaction,audit} from './db.mjs';
import {quantityToScaled} from './quantity.mjs';
function reject(status,message){const e=new Error(message);e.status=status;throw e}
const required=(v,name)=>{if(typeof v!=='string'||!v.trim())reject(422,name+'不能为空');return v.trim()};
const latest=id=>one('SELECT * FROM executions WHERE id=?',id)||reject(404,'执行批次不存在');
const project=id=>one('SELECT * FROM projects WHERE id=?',id)||reject(404,'项目不存在');
const guard=(x,body)=>{if(x.version!==body.version)reject(409,'执行批次版本已改变，请刷新')}
const auditEvent=(user,entity,id,action,before,after,reason='')=>audit(user.id,entity,id,action,before,after,reason);
const sumCompletion=id=>one('SELECT COALESCE(SUM(quantity_scaled),0) n FROM completion_records WHERE execution_item_id=?',id).n;
export function listExecutions(projectId){
 project(projectId);return all(`SELECT e.*,
 (SELECT COUNT(*) FROM execution_items WHERE execution_id=e.id) item_count,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM completion_records c JOIN execution_items i ON i.id=c.execution_item_id WHERE i.execution_id=e.id),0) completed_quantity_scaled
 FROM executions e WHERE e.project_id=? ORDER BY e.created_at,e.number`,projectId);
}
export function executionDetail(id){
 const e=latest(id);
 return {...e,items:all(`SELECT i.*,s.demand_id,s.quantity_scaled AS approved_scope_quantity_scaled,s.demand_snapshot_json,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM completion_records c WHERE c.execution_item_id=i.id),0) completed_quantity_scaled
 FROM execution_items i JOIN project_demand_scopes s ON s.id=i.project_scope_id
 WHERE i.execution_id=? ORDER BY i.created_at,i.id`,id).map(i=>{
 const archived=i.scope_snapshot_json?JSON.parse(i.scope_snapshot_json):null;
 const d=readDemandSnapshot({...i,demand_snapshot_json:archived?.demand_snapshot_json||i.demand_snapshot_json});if(!d)reject(409,'批准需求快照缺失');
 return {...i,approved_scope_quantity_scaled:archived?.quantity_scaled??i.approved_scope_quantity_scaled,demand_no:d.demand_no,operation_snapshot:d.operation_snapshot,target_object:d.target_object,
 unit_snapshot:d.unit_snapshot,line_name_snapshot:d.line_name_snapshot,tower_no_snapshot:d.tower_no_snapshot,demand_snapshot:d};
 })};
}
export function createExecution(projectId,body,user){
 const p=project(projectId);if(p.status!=='approved')reject(409,'未立项项目不得正式执行');
 const approval=one('SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1',projectId);
 if(!approval)reject(409,'项目缺少有效的批准版本，不得创建执行批次');
 const planType=required(body.plan_type,'检修计划类型');
 if(!['outage','non_outage'].includes(planType))reject(422,'检修计划类型必须为停电或不停电');
 const item={id:uid(),project_id:projectId,number:required(body.number,'检修计划编号'),description:body.description||'',plan_type:planType,
 status:'planned',version:1,planned_on:body.planned_on||null,started_at:null,finished_at:null,close_reason:null,
 created_by:user.id,created_at:now(),updated_at:now(),approval_version_id:approval.id};
 return transaction(()=>{
  exec('INSERT INTO executions('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
  auditEvent(user,'executions',item.id,'create',null,item);return executionDetail(item.id);
 });
}
export function addExecutionItem(executionId,body,user){
 const e=latest(executionId);guard(e,body);
 if(e.status!=='planned')reject(409,'只能为未开始批次安排工作');
 const scope=one('SELECT * FROM project_demand_scopes WHERE id=?',body.scope_id);
 if(!scope||scope.project_id!==e.project_id)reject(422,'工作范围必须属于该批次的立项项目');
 const q=quantityToScaled(body.quantity);
 if(q>scope.quantity_scaled)reject(422,'本次安排超出批准范围');
 return transaction(()=>{
  // A finished batch retains the original plan but only its confirmed actual
  // quantity continues consuming approved scope. Unfinished planned/running
  // batches retain their reservations; cancelled batches release all.
  const allocated=one(`SELECT COALESCE(SUM(
    CASE WHEN e.status='finished'
      THEN COALESCE((SELECT SUM(c.quantity_scaled) FROM completion_records c WHERE c.execution_item_id=i.id),0)
      ELSE i.planned_quantity_scaled END
   ),0) AS n FROM execution_items i
   JOIN executions e ON e.id=i.execution_id
   WHERE i.project_scope_id=? AND e.status IN ('planned','running','finished')`,scope.id).n;
  if(allocated+q>scope.quantity_scaled)reject(409,'当前需求剩余可安排工作量不足');
  if(e.approval_version_id!==one('SELECT id FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1',e.project_id)?.id)
   reject(409,'执行批次采用旧批准版本，不能继续追加计划；请取消旧计划并建立新批准版本批次');
  if(scope.status!=='active')reject(409,'此范围在当前版本已经终止');
  const approved=one('SELECT snapshot_json FROM project_approval_versions WHERE id=?',e.approval_version_id);
  const approvedScope=approved?JSON.parse(approved.snapshot_json).scopes.find(x=>x.scope_id===scope.id):null;
  if(!approvedScope)reject(409,'执行批次引用的批准版本不包含此工作范围');
  if(q>approvedScope.quantity_scaled)reject(409,'安排工作量超出本批次采用的批准版本');
  const item={id:uid(),execution_id:executionId,project_scope_id:scope.id,planned_quantity_scaled:q,
   actual_physical_tower_id:approvedScope.demand_snapshot?.observed_physical_tower_id||null,created_at:now(),
   scope_snapshot_json:JSON.stringify({demand_snapshot_json:JSON.stringify(approvedScope.demand_snapshot),
    quantity_scaled:approvedScope.quantity_scaled,unit_price_fen:approvedScope.unit_price_fen,
    price_source:approvedScope.price_source,price_date:approvedScope.price_date,tax_mode:approvedScope.tax_mode,
    reference_price_version_id:approvedScope.reference_price_version_id||null})};
  exec('INSERT INTO execution_items('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
  exec('UPDATE executions SET version=version+1,updated_at=? WHERE id=?',now(),executionId);
  auditEvent(user,'execution_items',item.id,'plan',null,item);
  return executionDetail(executionId);
 });
}
export function changeExecutionStage(executionId,status,body,user){
 const e=latest(executionId);guard(e,body);
 if(status==='running'&&e.status!=='planned'||status==='finished'&&e.status!=='running'||status==='cancelled'&&e.status!=='planned')reject(409,'无效的批次阶段变化');
 const reason=required(body.reason,'确认依据');
 return transaction(()=>{
  if(status==='running'&&!one('SELECT 1 FROM execution_items WHERE execution_id=?',e.id))reject(422,'执行前必须安排至少一项批准范围');
  const closedItems=status==='finished'?executionDetail(e.id).items.map(item=>({
   execution_item_id:item.id,project_scope_id:item.project_scope_id,
   planned_quantity_scaled:item.planned_quantity_scaled,
   completed_quantity_scaled:item.completed_quantity_scaled,
   released_quantity_scaled:item.planned_quantity_scaled-item.completed_quantity_scaled
  })):[];
  const t=now(),next={...e,status,version:e.version+1,updated_at:t,
   started_at:status==='running'?t:e.started_at,
   finished_at:status==='finished'?t:e.finished_at,
   close_reason:status==='finished'||status==='cancelled'?reason:null,
   ...(status==='finished'?{closing_quantities:closedItems}: {})};
  exec('UPDATE executions SET status=?,version=?,updated_at=?,started_at=?,finished_at=?,close_reason=? WHERE id=?',status,next.version,t,next.started_at,next.finished_at,next.close_reason,e.id);
  auditEvent(user,'executions',e.id,'stage_'+status,e,next,reason);
  return executionDetail(executionId);
 });
}
export function confirmCompletion(executionId,itemId,body,user){
 const key=required(body.idempotency_key,'重复提交标识'),q=quantityToScaled(body.quantity),date=required(body.occurred_on,'实际完成日期'),
 evidence=required(body.evidence,'实际实施/验收依据');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))reject(422,'完成日期格式为 YYYY-MM-DD');
 const payload_hash=createHash('sha256').update(JSON.stringify({executionId,itemId,q,date,evidence})).digest('hex');
 return transaction(()=>{
  const previous=one('SELECT * FROM completion_records WHERE idempotency_key=?',key);
  if(previous){if(previous.payload_hash!==payload_hash)reject(409,'幂等键对应另一项确认内容');return executionDetail(executionId)}
  const e=latest(executionId);if(e.status!=='running')reject(409,'只有正在执行的批次可以确认完成');
  const item=one('SELECT * FROM execution_items WHERE id=? AND execution_id=?',itemId,executionId);
  if(!item)reject(404,'本次执行明细不存在');
  if(sumCompletion(item.id)+q>item.planned_quantity_scaled)reject(409,'确认工作量不能超出本次安排量');
  const id=uid(),t=now();
  const record={id,execution_item_id:item.id,quantity_scaled:q,occurred_on:date,evidence,confirmed_by:user.id,confirmed_at:t,idempotency_key:key,payload_hash};
  exec('INSERT INTO completion_records VALUES(?,?,?,?,?,?,?,?,?)',...Object.values(record));
  exec('UPDATE executions SET version=version+1,updated_at=? WHERE id=?',t,e.id);
  auditEvent(user,'completion_records',id,'confirm',null,record);
  return executionDetail(executionId);
 });
}
