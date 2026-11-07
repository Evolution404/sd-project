import {db} from '../connection.mjs';

export const reconciliationById=id=>db.prepare(
 'SELECT * FROM cost_reconciliation_current WHERE record_id=?').get(id);
export const reconciliationVersions=id=>db.prepare(`SELECT r.*,u.username confirmed_by_name
 FROM cost_reconciliation_versions r JOIN users u ON u.id=r.confirmed_by
 WHERE record_id=? ORDER BY version_no DESC`).all(id);
export const reconciliationReplay=key=>db.prepare(
 'SELECT * FROM cost_reconciliation_versions WHERE request_key=?').get(key);
export const reconciliationCost=id=>db.prepare(
 'SELECT * FROM cost_current WHERE entry_id=?').get(id);
export const reconciliationSettlement=id=>db.prepare(
 'SELECT * FROM settlement_current WHERE id=?').get(id);
export const reconciliationExecutionItem=(id,executionId)=>!!db.prepare(`SELECT 1 FROM
 execution_items WHERE id=? AND execution_id=?`).get(id,executionId);
export function insertReconciliationVersion(row){
 const columns=Object.keys(row);
 db.prepare('INSERT INTO cost_reconciliation_versions('+columns.join(',')+') VALUES('+
  columns.map(()=>'?').join(',')+')').run(...Object.values(row));
}
export const executionForReconciliations=id=>!!db.prepare(
 'SELECT 1 FROM executions WHERE id=?').get(id);
export function executionReconciliations(executionId,status){
 return db.prepare(`SELECT r.*,c.name AS cost_name,s.settlement_no,d.demand_no
 FROM cost_reconciliation_current r
 JOIN cost_current c ON c.entry_id=r.cost_entry_id
 JOIN settlement_current s ON s.id=r.settlement_entry_id
 JOIN execution_items i ON i.id=r.execution_item_id
 JOIN project_demand_scopes p ON p.id=i.project_scope_id
 JOIN demands d ON d.id=p.demand_id
 WHERE c.execution_id=? AND (?='all' OR r.status=?)
 ORDER BY r.confirmed_at DESC`).all(executionId,status,status);
}
