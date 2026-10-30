import {ensureCostReconciliationSources} from './cost-rules.mjs';
import {uid,now,one,all,exec,audit,transaction} from './db.mjs';
import {yuanToFen,amountFen} from './money.mjs';
import {validateSettlementDate,ensureSettlementNumber} from './settlement-validation.mjs';
const reject=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())reject(422,label+'不能为空');return value.trim()};
const project=id=>one('SELECT * FROM projects WHERE id=?',id)||reject(404,'项目不存在');
const net=scopeId=>one(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE project_scope_id=?`,scopeId).n;
export const netSettledForScope=net;
function amountForScope(scope){
 if(scope.unit_price_fen===null)reject(409,'工作范围缺少核定单价');
 return amountFen(scope.quantity_scaled,scope.unit_price_fen);
}
export function settlementEntries(projectId,filters={}){
 project(projectId);
 return all(`SELECT se.*,s.demand_id,d.demand_no,e.id AS execution_id,e.number AS plan_number,e.plan_type AS plan_type
 FROM settlement_current se
 JOIN project_demand_scopes s ON s.id=se.project_scope_id
 JOIN demands d ON d.id=s.demand_id
 LEFT JOIN execution_items i ON i.id=se.execution_item_id
 LEFT JOIN executions e ON e.id=i.execution_id WHERE se.project_id=?
 AND (?='all' OR se.status=?) AND (?='' OR se.settlement_no LIKE ? OR se.evidence LIKE ?)
 AND (?='' OR e.id=?)
 ORDER BY se.occurred_on DESC,se.created_at DESC,se.id DESC`,projectId,
 filters.status||'active',filters.status||'active',filters.q||'', '%'+(filters.q||'')+'%', '%'+(filters.q||'')+'%',filters.execution_id||'',filters.execution_id||'');
}
export function projectProgress(projectId){
 const p=project(projectId);
 const scopes=all(`SELECT s.*,d.demand_no,d.unit_snapshot,d.line_name_snapshot,d.tower_no_snapshot
 FROM project_demand_scopes s JOIN demands d ON d.id=s.demand_id
 WHERE s.project_id=? AND s.status='active' ORDER BY s.created_at,s.id`,projectId);
 const result=scopes.map(s=>{
  const done=one(`SELECT COALESCE(SUM(c.quantity_scaled),0) n FROM effective_completion_records c
   JOIN execution_items i ON c.execution_item_id=i.id
   WHERE i.project_scope_id=?`,s.id).n;
  const paid=net(s.id);
  return {...s,completed_quantity_scaled:done,settled_fen:paid,
   planned_estimate_fen:s.unit_price_fen===null?null:amountForScope(s),
   completion_flag:done>0,settlement_flag:paid>0,
   dual_status:(done>0?'implemented':'unimplemented')+'_'+(paid>0?'settled':'unsettled')};
 });
 const totalSettled=one(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE project_id=?`,projectId).n;
 return {project_id:projectId,approved_budget_fen:p.approved_budget_fen,
  settled_fen:totalSettled,unsettled_approved_fen:p.approved_budget_fen===null?null:p.approved_budget_fen-totalSettled,
  scopes:result};
}
export function registerSettlement(projectId,body,user){
 return transaction(()=>{
  const p=project(projectId);
  const entryKind=body.entry_kind||'payment';
  if(!['payment','reversal'].includes(entryKind))reject(422,'结算登记类型错误');
  if(entryKind==='payment'&&p.status!=='approved')reject(409,'项目尚未批准或已关闭，不可新增正向结算');
  const scope=one('SELECT * FROM project_demand_scopes WHERE id=? AND project_id=?',body.scope_id,projectId);
  if(!scope)reject(422,'结算范围必须属于当前子项目');
  if(entryKind==='payment'&&scope.status!=='active')reject(409,'已退出的专业需求范围不允许新增正向结算');
  const itemId=body.execution_item_id==null?null:required(body.execution_item_id,'检修计划工作项');
  const planItem=itemId?one(`SELECT i.id,i.project_scope_id,e.project_id,e.status AS plan_status
    FROM execution_items i JOIN executions e ON e.id=i.execution_id WHERE i.id=?`,itemId):null;
  if(itemId&&(!planItem||planItem.project_id!==projectId||planItem.project_scope_id!==scope.id))
   reject(422,'检修计划工作项与当前项目、专业需求不匹配');
  if(planItem?.plan_status==='cancelled'&&entryKind==='payment')reject(409,'已取消的检修计划不允许新增正向结算，历史凭证仍可冲销');
  const sum=yuanToFen(body.amount_yuan,'结算金额');
  if(sum<=0)reject(422,'结算金额须大于零');
  const date=required(body.occurred_on,'结算日期');
  validateSettlementDate(date);
  const settlementNo=required(body.settlement_no,'结算凭证编号'),evidence=required(body.evidence,'结算凭证依据');
  ensureSettlementNumber(settlementNo);
  let original=null,kind=null;
  if(entryKind==='reversal'){
   original=one("SELECT * FROM effective_settlement_entries WHERE id=? AND entry_kind='payment' AND project_scope_id=?",body.reversal_of,scope.id);
   if(!original)reject(422,'请选择当前范围的原始正向结算凭证');
   if((original.execution_item_id||null)!==itemId)reject(409,'冲销必须保留原凭证的检修计划归属');
   const reversed=one("SELECT COALESCE(SUM(amount_fen),0) n FROM effective_settlement_entries WHERE reversal_of=?",original.id).n;
   if(reversed+sum>original.amount_fen)reject(409,'冲销金额不能超过原始凭证未冲销余额');
  }else{
   kind=required(body.settlement_type,'结算性质');
   if(!['advance','progress','final'].includes(kind))reject(422,'结算性质无效');
   const total=one(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
    FROM effective_settlement_entries WHERE project_id=?`,projectId).n;
   if(total+sum>p.approved_budget_fen)reject(409,'项目累计结算超过当前批准预算');
   if(net(scope.id)+sum>amountForScope(scope))reject(409,'本需求结算金额超过当前批准范围金额');
   if(kind==='final'){
    const finished=itemId
     ?one(`SELECT 1 FROM effective_completion_records c JOIN execution_items i ON c.execution_item_id=i.id
       JOIN executions e ON e.id=i.execution_id WHERE i.id=? AND e.status='finished' LIMIT 1`,itemId)
     :one(`SELECT 1 FROM effective_completion_records c JOIN execution_items i ON c.execution_item_id=i.id
       JOIN executions e ON e.id=i.execution_id WHERE i.project_scope_id=? AND e.status='finished' LIMIT 1`,scope.id);
    if(!finished)reject(409,'正式终结结算必须先有该需求已结束批次的实际完成记录');
   }
  }
  const approvalId=original?.approval_version_id || (itemId
   ?one('SELECT e.approval_version_id id FROM executions e JOIN execution_items i ON i.execution_id=e.id WHERE i.id=?',itemId)?.id
   :one('SELECT id FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1',projectId)?.id);
  if(!approvalId)reject(409,'未找到结算对应的批准版本');
  const item={id:uid(),project_id:projectId,project_scope_id:scope.id,approval_version_id:approvalId,
   execution_item_id:itemId,settlement_no:settlementNo,entry_kind:entryKind,settlement_type:kind,
   amount_fen:sum,reversal_of:original?.id||null,occurred_on:date,
   evidence,recorded_by:user.id,created_at:now()};
  exec('INSERT INTO project_settlement_entries('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
  ensureCostReconciliationSources();
  audit(user.id,'project_settlement_entries',item.id,entryKind==='payment'?'record_payment':'record_reversal',null,item,evidence);
  return item;
 });
}
