import {db} from '../connection.mjs';

// Settlement registration uses original approved scope and immutable voucher facts.
export const settlementProjectById=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const netSettledByScope=id=>db.prepare(`SELECT COALESCE(SUM(CASE
 WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE project_scope_id=?`).get(id).n;
export const netSettledByProject=id=>db.prepare(`SELECT COALESCE(SUM(CASE
 WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE project_id=?`).get(id).n;
export const settlementList=(id,{status='active',q='',execution_id=''})=>db.prepare(`SELECT se.*,
 s.demand_id,d.demand_no,e.id AS execution_id,e.number AS plan_number,e.plan_type
 FROM settlement_current se JOIN project_demand_scopes s ON s.id=se.project_scope_id
 JOIN demands d ON d.id=s.demand_id
 LEFT JOIN execution_items i ON i.id=se.execution_item_id
 LEFT JOIN executions e ON e.id=i.execution_id WHERE se.project_id=?
 AND (?='all' OR se.status=?) AND (?='' OR se.settlement_no LIKE ? OR se.evidence LIKE ?)
 AND (?='' OR e.id=?) ORDER BY se.occurred_on DESC,se.created_at DESC,se.id DESC`)
 .all(id,status,status,q,'%'+q+'%','%'+q+'%',execution_id,execution_id);
export const activeScopesForProgress=id=>db.prepare(`SELECT s.*,d.demand_no,
 d.unit_snapshot,d.line_name_snapshot,d.tower_no_snapshot
 FROM project_demand_scopes s JOIN demands d ON d.id=s.demand_id
 WHERE s.project_id=? AND s.status='active'
 ORDER BY s.created_at,s.id`).all(id);
export const completedQuantityForScope=id=>db.prepare(`SELECT COALESCE(SUM(c.quantity_scaled),0) n
 FROM effective_completion_records c JOIN execution_items i
 ON c.execution_item_id=i.id WHERE i.project_scope_id=?`).get(id).n;
export const scopeForSettlement=(scopeId,projectId)=>db.prepare(`SELECT *
 FROM project_demand_scopes WHERE id=? AND project_id=?`).get(scopeId,projectId);
export const planItemForSettlement=id=>db.prepare(`SELECT i.id,i.project_scope_id,
 e.project_id,e.status AS plan_status
 FROM execution_items i JOIN executions e ON e.id=i.execution_id WHERE i.id=?`).get(id);
export const originalPaymentForReversal=(id,scopeId)=>db.prepare(`SELECT *
 FROM effective_settlement_entries
 WHERE id=? AND entry_kind='payment' AND project_scope_id=?`).get(id,scopeId);
export const reversedPaymentTotal=id=>db.prepare(`SELECT COALESCE(SUM(amount_fen),0) n
 FROM effective_settlement_entries WHERE reversal_of=?`).get(id).n;
export const finishedItemEvidence=id=>!!db.prepare(`SELECT 1
 FROM effective_completion_records c JOIN execution_items i ON c.execution_item_id=i.id
 JOIN executions e ON e.id=i.execution_id
 WHERE i.id=? AND e.status='finished' LIMIT 1`).get(id);
export const finishedScopeEvidence=id=>!!db.prepare(`SELECT 1
 FROM effective_completion_records c JOIN execution_items i ON c.execution_item_id=i.id
 JOIN executions e ON e.id=i.execution_id
 WHERE i.project_scope_id=? AND e.status='finished' LIMIT 1`).get(id);
export const itemApprovalId=id=>db.prepare(`SELECT e.approval_version_id id
 FROM executions e JOIN execution_items i ON i.execution_id=e.id
 WHERE i.id=?`).get(id)?.id;
export const latestProjectApprovalId=id=>db.prepare(`SELECT id FROM project_approval_versions
 WHERE project_id=? ORDER BY version_no DESC LIMIT 1`).get(id)?.id;
export function insertSettlementEntry(entry){
 const keys=Object.keys(entry);
 db.prepare('INSERT INTO project_settlement_entries('+keys.join(',')+') VALUES('+
 keys.map(()=>'?').join(',')+')').run(...Object.values(entry));
}
