import {db} from '../connection.mjs';

// Distinct read models for allocated vouchers vs unallocated project entries.
export const financePlan=id=>db.prepare('SELECT * FROM executions WHERE id=?').get(id);
export const financeProject=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const financeAgreement=id=>db.prepare('SELECT * FROM agreements WHERE id=?').get(id);
export const financeFramework=id=>db.prepare('SELECT * FROM frameworks WHERE id=?').get(id);
export const planFinanceItems=id=>db.prepare(`SELECT i.id,i.project_scope_id,
 i.planned_quantity_scaled,i.scope_snapshot_json,d.demand_no,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c
 WHERE c.execution_item_id=i.id),0) completed_quantity_scaled,
 COALESCE((SELECT SUM(CASE WHEN se.entry_kind='payment' THEN se.amount_fen
 ELSE -se.amount_fen END) FROM effective_settlement_entries se
 WHERE se.execution_item_id=i.id),0) settled_fen
 FROM execution_items i JOIN project_demand_scopes s ON s.id=i.project_scope_id
 JOIN demands d ON d.id=s.demand_id WHERE i.execution_id=?
 ORDER BY i.created_at,i.id`).all(id);
export const planFinanceVouchers=id=>db.prepare(`SELECT se.* FROM effective_settlement_entries se
 JOIN execution_items i ON i.id=se.execution_item_id
 WHERE i.execution_id=? ORDER BY se.occurred_on DESC,se.created_at DESC,se.id DESC`).all(id);
export const financeItemWithinPlan=(itemId,planId)=>db.prepare(
 'SELECT project_scope_id FROM execution_items WHERE id=? AND execution_id=?').get(itemId,planId);
export const planIdsForProject=id=>db.prepare(
 'SELECT id FROM executions WHERE project_id=? ORDER BY created_at,number').all(id);
export const projectIdsForAgreement=id=>db.prepare(
 'SELECT id FROM projects WHERE agreement_id=? ORDER BY created_at').all(id);
export const projectIdsForFramework=id=>db.prepare(
 'SELECT id FROM projects WHERE framework_id=? ORDER BY created_at').all(id);
export const agreementsForFramework=id=>db.prepare(
 'SELECT id,name,limit_fen FROM agreements WHERE framework_id=? ORDER BY created_at').all(id);
export function projectNetSettled(projectId,allocatedOnly=false){
 const condition=allocatedOnly?' AND execution_item_id IS NULL':'';
 return db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment'
 THEN amount_fen ELSE -amount_fen END),0) amount
 FROM effective_settlement_entries WHERE project_id=?`+condition).get(projectId).amount;
}
