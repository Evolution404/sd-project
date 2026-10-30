import {one,all} from './db.mjs';
export const completionFail=(status,message,details)=>{throw Object.assign(new Error(message),{status,details})};
export function scopeCompletionUsage(scopeId){
 return one(`SELECT COALESCE(SUM(CASE WHEN e.status='finished'
  THEN COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c WHERE c.execution_item_id=i.id),0)
  ELSE i.planned_quantity_scaled END),0) AS committed_quantity_scaled
  FROM execution_items i JOIN executions e ON e.id=i.execution_id
  WHERE i.project_scope_id=? AND e.status IN ('planned','running','finished')`,scopeId).committed_quantity_scaled;
}
export function activeFinalSettlements(scopeId){
 return all(`SELECT s.id,s.settlement_no,s.execution_item_id,s.version,s.amount_fen,
  s.amount_fen-COALESCE((SELECT SUM(r.amount_fen) FROM effective_settlement_entries r WHERE r.reversal_of=s.id),0) AS net_fen
  FROM effective_settlement_entries s WHERE s.project_scope_id=? AND s.entry_kind='payment'
  AND s.settlement_type='final'`,scopeId).filter(s=>s.net_fen>0);
}
export function unsupportedFinalSettlements(scopeId,removedId=null){
 return activeFinalSettlements(scopeId).filter(s=>!one(`SELECT 1 FROM effective_completion_records c
 JOIN execution_items i ON i.id=c.execution_item_id JOIN executions e ON e.id=i.execution_id
 WHERE i.project_scope_id=? AND e.status='finished' AND (? IS NULL OR i.id=?) AND (? IS NULL OR c.id<>?) LIMIT 1`,
 scopeId,s.execution_item_id,s.execution_item_id,removedId,removedId));
}
export function ensureCompletionLimits(itemId){
 const i=one(`SELECT i.*,s.quantity_scaled AS current_quantity_scaled,s.status AS scope_status
 FROM execution_items i JOIN project_demand_scopes s ON s.id=i.project_scope_id WHERE i.id=?`,itemId);
 if(!i)completionFail(404,'检修工作项不存在');
 const sum=one('SELECT COALESCE(SUM(quantity_scaled),0) n FROM effective_completion_records WHERE execution_item_id=?',itemId).n;
 const snapshot=i.scope_snapshot_json?JSON.parse(i.scope_snapshot_json):null;
 if(sum>i.planned_quantity_scaled||snapshot&&sum>snapshot.quantity_scaled)completionFail(409,'更正后完成量超过本计划工作量或当时批准范围');
 const actual=one(`SELECT COALESCE(SUM(c.quantity_scaled),0) n FROM effective_completion_records c
 JOIN execution_items i ON i.id=c.execution_item_id WHERE i.project_scope_id=?`,i.project_scope_id).n;
 if(actual>i.current_quantity_scaled||i.scope_status!=='active'&&actual>0)
  completionFail(409,'更正后完成量超出当前有效批准范围，请先处理项目范围变更');
 if(scopeCompletionUsage(i.project_scope_id)>i.current_quantity_scaled)
  completionFail(409,'释放的工作量已被其他计划安排，更正后将超出批准范围，请先调整关联计划');
 ensureFinalCompletionBasis(i.project_scope_id);
}
export function ensureFinalCompletionBasis(scopeId){
 const blocked=unsupportedFinalSettlements(scopeId);
 if(blocked.length)completionFail(409,'本次处理会使有效终结结算失去完成依据，请先核对并更正或撤销关联结算凭证',{blocking_settlements:blocked});
}
