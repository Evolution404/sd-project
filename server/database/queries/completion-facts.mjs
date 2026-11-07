import {db} from '../connection.mjs';

export const scopeCommittedQuantity=scopeId=>db.prepare(`SELECT COALESCE(
 SUM(CASE WHEN e.status='finished'
 THEN COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c
 WHERE c.execution_item_id=i.id),0) ELSE i.planned_quantity_scaled END),0)
 AS committed_quantity_scaled
 FROM execution_items i JOIN executions e ON e.id=i.execution_id
 WHERE i.project_scope_id=? AND e.status IN ('planned','running','finished')`)
 .get(scopeId).committed_quantity_scaled;
export const finalSettlementRows=scopeId=>db.prepare(`SELECT s.id,s.settlement_no,
 s.execution_item_id,s.version,s.amount_fen,
 s.amount_fen-COALESCE((SELECT SUM(r.amount_fen) FROM effective_settlement_entries r
 WHERE r.reversal_of=s.id),0) AS net_fen
 FROM effective_settlement_entries s WHERE s.project_scope_id=?
 AND s.entry_kind='payment' AND s.settlement_type='final'`).all(scopeId);
export const hasCompletionEvidence=(scopeId,itemId,removedId)=>!!db.prepare(`SELECT 1
 FROM effective_completion_records c JOIN execution_items i ON i.id=c.execution_item_id
 JOIN executions e ON e.id=i.execution_id
 WHERE i.project_scope_id=? AND e.status='finished'
 AND (? IS NULL OR i.id=?) AND (? IS NULL OR c.id<>?) LIMIT 1`)
 .get(scopeId,itemId,itemId,removedId,removedId);
export const completionItem=id=>db.prepare(`SELECT i.*,
 s.quantity_scaled AS current_quantity_scaled,s.status AS scope_status
 FROM execution_items i JOIN project_demand_scopes s ON s.id=i.project_scope_id
 WHERE i.id=?`).get(id);
export const completedForItem=id=>db.prepare(`SELECT COALESCE(SUM(quantity_scaled),0) n
 FROM effective_completion_records WHERE execution_item_id=?`).get(id).n;
export const completedForScope=id=>db.prepare(`SELECT COALESCE(SUM(c.quantity_scaled),0) n
 FROM effective_completion_records c JOIN execution_items i ON i.id=c.execution_item_id
 WHERE i.project_scope_id=?`).get(id).n;
