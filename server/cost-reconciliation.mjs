import {createHash} from 'node:crypto';
import {all,one,exec,uid,now,audit,transaction} from './db.mjs';
import {yuanToFen} from './money.mjs';
import {costFail as fail,ensureCostReconciliationSources} from './cost-rules.mjs';
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
export function costReconciliationDetail(id){
 const row=one('SELECT * FROM cost_reconciliation_current WHERE record_id=?',id)||fail(404,'核对记录不存在');
 return {entry:row,versions:all(`SELECT r.*,u.username confirmed_by_name FROM cost_reconciliation_versions r JOIN users u ON u.id=r.confirmed_by WHERE record_id=? ORDER BY version_no DESC`,id)};
}
export function recordCostReconciliation(executionId,recordId,body,user,remove=false){
 return transaction(()=>{
  const key=required(body.request_key,'操作标识');if(key.length>150)fail(422,'操作标识过长');
  const normalizedBody=JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b))));
  const fingerprint=createHash('sha256').update(JSON.stringify({executionId,recordId,remove,actor:user.id,body:normalizedBody})).digest('hex');
  const replay=one('SELECT * FROM cost_reconciliation_versions WHERE request_key=?',key);
  if(replay){if(replay.request_hash!==fingerprint)fail(409,'操作标识已用于其他内容');return replay}
  const old=recordId?costReconciliationDetail(recordId).entry:null;
  if(old&&(old.status!=='active'||body.version!==old.version_no))fail(409,'核对记录已变化或已撤销，请刷新后处理');
  const source=old||body;
  const cost=one('SELECT * FROM cost_current WHERE entry_id=?',source.cost_entry_id);
  const settlement=one('SELECT * FROM settlement_current WHERE id=?',source.settlement_entry_id);
  const itemId=old?.execution_item_id||body.execution_item_id;
  if(!cost||!settlement||!one('SELECT 1 FROM execution_items WHERE id=? AND execution_id=?',itemId,cost.execution_id)||executionId&&cost.execution_id!==executionId)
   fail(422,'核对的费用、工作项和检修计划不匹配');
  if(old&&(body.cost_entry_id&&body.cost_entry_id!==old.cost_entry_id||body.settlement_entry_id&&body.settlement_entry_id!==old.settlement_entry_id||body.execution_item_id&&body.execution_item_id!==old.execution_item_id))
   fail(422,'核对记录不能改挂费用、结算凭证或工作项，请撤销后重新登记');
  if(!remove&&(cost.status!=='active'||settlement.status!=='active'||settlement.entry_kind!=='payment'||settlement.execution_item_id!==itemId))
   fail(422,'只能核对同一工作项的有效费用和正向结算凭证，项目级未归集凭证不自动归集');
  if(!remove&&(!Number.isInteger(body.cost_version)||body.cost_version!==cost.version_no||body.settlement_version!==settlement.version))
   fail(409,'费用或结算版本已变化，请重新核对');
  const expense=remove?old.expense_amount_fen:yuanToFen(body.expense_amount_yuan,'对应费用份额');
  const settled=remove?old.settled_amount_fen:yuanToFen(body.settled_amount_yuan,'核定结算额');
  if(expense<=0)fail(422,'对应费用份额须大于零');
  if(!remove&&typeof body.is_final!=='boolean')fail(422,'请明确是否最终核对');
  const evidence=required(body.evidence,remove?'撤销依据':'核对 / 差异依据');
  const row={id:uid(),record_id:recordId||uid(),version_no:(old?.version_no||0)+1,status:remove?'voided':'active',cost_entry_id:cost.entry_id,
   cost_version_id:remove?old.cost_version_id:cost.id,settlement_entry_id:settlement.id,settlement_version:remove?old.settlement_version:settlement.version,
   execution_item_id:itemId,expense_amount_fen:expense,settled_amount_fen:settled,is_final:remove?old.is_final:Number(body.is_final),evidence,
   confirmed_by:user.id,confirmed_at:now(),request_key:key,request_hash:fingerprint};
  exec('INSERT INTO cost_reconciliation_versions('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',...Object.values(row));
  ensureCostReconciliationSources();audit(user.id,'cost_reconciliations',row.record_id,remove?'void':old?'correct':'confirm',old,row,evidence);return row;
 });
}
export function planCostReconciliations(executionId,filters={}){
 if(!one('SELECT 1 FROM executions WHERE id=?',executionId))fail(404,'检修计划不存在');
 const status=filters.status||'active';if(!['active','voided','all'].includes(status))fail(422,'核对记录状态无效');
 return all(`SELECT r.*,c.name AS cost_name,s.settlement_no,d.demand_no FROM cost_reconciliation_current r
 JOIN cost_current c ON c.entry_id=r.cost_entry_id JOIN settlement_current s ON s.id=r.settlement_entry_id
 JOIN execution_items i ON i.id=r.execution_item_id JOIN project_demand_scopes p ON p.id=i.project_scope_id
 JOIN demands d ON d.id=p.demand_id WHERE c.execution_id=? AND (?='all' OR r.status=?) ORDER BY r.confirmed_at DESC`,executionId,status,status);
}
