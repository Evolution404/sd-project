import {one,all} from './db.mjs';
export const costFail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function settlementCostLinks(settlementId){
 return all("SELECT r.*,c.name AS cost_name FROM cost_reconciliation_current r JOIN cost_current c ON c.entry_id=r.cost_entry_id WHERE r.settlement_entry_id=? AND r.status='active' ORDER BY r.record_id",settlementId);
}
export function ensureCostReconciliationSources(){
 // Only current versions consume either side. Snapshot references retain their original versions.
 const records=all("SELECT * FROM cost_reconciliation_current WHERE status='active'");
 const expenseTotals=new Map(),settlementTotals=new Map();
 for(const r of records){
  const a=one('SELECT * FROM effective_cost_allocations WHERE entry_id=? AND execution_item_id=?',r.cost_entry_id,r.execution_item_id);
  const s=one('SELECT * FROM effective_settlement_entries WHERE id=?',r.settlement_entry_id);
  if(!a||!s||s.entry_kind!=='payment'||s.execution_item_id!==r.execution_item_id)
   costFail(409,'存在有效费用结算核对，请先更正或撤销核对记录，不能使其费用或结算依据失效');
  const key=r.cost_entry_id+':'+r.execution_item_id;
  const used=(expenseTotals.get(key)||0n)+BigInt(r.expense_amount_fen);expenseTotals.set(key,used);
  if(used>BigInt(a.amount_fen))costFail(409,'费用对应份额超过当前有效费用分摊金额，请先调整核对记录');
  const paid=(settlementTotals.get(s.id)||0n)+BigInt(r.settled_amount_fen);settlementTotals.set(s.id,paid);
  const reversed=one('SELECT COALESCE(SUM(amount_fen),0) n FROM effective_settlement_entries WHERE reversal_of=?',s.id).n;
  if(paid>BigInt(s.amount_fen)-BigInt(reversed))costFail(409,'已核对结算额超过凭证未冲销净额，请先调整费用结算核对记录');
 }
}
export function planCostTotals(executionId){
 const total=all("SELECT amount_fen FROM cost_current WHERE execution_id=? AND status='active'",executionId).reduce((n,e)=>n+BigInt(e.amount_fen),0n);
 if(total>BigInt(Number.MAX_SAFE_INTEGER))costFail(422,'实际费用合计超出有效金额范围');
 const sum=Number(total);
 const matched=one(`SELECT COALESCE(SUM(r.expense_amount_fen),0) n FROM cost_reconciliation_current r
 JOIN cost_entries c ON c.id=r.cost_entry_id WHERE c.execution_id=? AND r.status='active'`,executionId).n;
 const final=one(`SELECT COALESCE(SUM(r.expense_amount_fen),0) n FROM cost_reconciliation_current r
 JOIN cost_entries c ON c.id=r.cost_entry_id WHERE c.execution_id=? AND r.status='active' AND r.is_final=1`,executionId).n;
 return {actual_cost_fen:sum,matched_expense_fen:matched,final_reconciled_expense_fen:final,unmatched_expense_fen:sum-matched,pending_final_expense_fen:sum-final};
}
