import {scopeCommittedQuantity,finalSettlementRows,hasCompletionEvidence,completionItem,completedForItem,completedForScope} from '../database/queries/completion-facts.mjs';
export const completionFail=(status,message,details)=>{throw Object.assign(new Error(message),{status,details})};
export function scopeCompletionUsage(scopeId){
 return scopeCommittedQuantity(scopeId);
}
export function activeFinalSettlements(scopeId){
 return finalSettlementRows(scopeId).filter(s=>s.net_fen>0);
}
export function unsupportedFinalSettlements(scopeId,removedId=null){
 return activeFinalSettlements(scopeId).filter(s=>!hasCompletionEvidence(
  scopeId,s.execution_item_id,removedId));
}
export function ensureCompletionLimits(itemId){
 const i=completionItem(itemId);
 if(!i)completionFail(404,'检修工作项不存在');
 const sum=completedForItem(itemId);
 const snapshot=i.scope_snapshot_json?JSON.parse(i.scope_snapshot_json):null;
 if(sum>i.planned_quantity_scaled||snapshot&&sum>snapshot.quantity_scaled)completionFail(409,'更正后完成量超过本计划工作量或当时批准范围');
 const actual=completedForScope(i.project_scope_id);
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
