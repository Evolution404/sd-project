import {db} from '../connection.mjs';

// Read facts for application reconciliation invariants; no decision logic in SQL.
export const settlementReconciliationLinks=id=>db.prepare(`SELECT r.*,c.name AS cost_name
 FROM cost_reconciliation_current r JOIN cost_current c ON c.entry_id=r.cost_entry_id
 WHERE r.settlement_entry_id=? AND r.status='active' ORDER BY r.record_id`).all(id);
export const activeReconciliations=()=>db.prepare(
 "SELECT * FROM cost_reconciliation_current WHERE status='active'").all();
export const costAllocation=(entryId,itemId)=>db.prepare(`SELECT * FROM effective_cost_allocations
 WHERE entry_id=? AND execution_item_id=?`).get(entryId,itemId);
export const effectiveSettlement=id=>db.prepare(
 'SELECT * FROM effective_settlement_entries WHERE id=?').get(id);
export const settlementReversedFen=id=>db.prepare(`SELECT COALESCE(SUM(amount_fen),0) n
 FROM effective_settlement_entries WHERE reversal_of=?`).get(id).n;
export const activePlanCosts=id=>db.prepare(`SELECT amount_fen FROM cost_current
 WHERE execution_id=? AND status='active'`).all(id);
export const planReconciledFen=(executionId,finalOnly=false)=>db.prepare(`SELECT COALESCE(
 SUM(r.expense_amount_fen),0) n FROM cost_reconciliation_current r
 JOIN cost_entries c ON c.id=r.cost_entry_id WHERE c.execution_id=?
 AND r.status='active'`+(finalOnly?' AND r.is_final=1':'')).get(executionId).n;
