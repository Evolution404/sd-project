import {db} from '../connection.mjs';

// Plans reserve approved scope until cancelled or released by completion.
export const executionById=id=>db.prepare('SELECT * FROM executions WHERE id=?').get(id);
export const executionProject=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const executionApproval=id=>db.prepare(`SELECT * FROM project_approval_versions
 WHERE project_id=? ORDER BY version_no DESC LIMIT 1`).get(id);
export const executionLatestApprovalId=id=>executionApproval(id)?.id;
export const executionApprovalSnapshot=id=>db.prepare(
 'SELECT snapshot_json FROM project_approval_versions WHERE id=?').get(id);
export const executionScope=id=>db.prepare(
 'SELECT * FROM project_demand_scopes WHERE id=?').get(id);
export const executionLineItems=id=>db.prepare(`SELECT i.*,
 s.demand_id,s.quantity_scaled AS approved_scope_quantity_scaled,s.demand_snapshot_json,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c
 WHERE c.execution_item_id=i.id),0) completed_quantity_scaled
 FROM execution_items i JOIN project_demand_scopes s ON s.id=i.project_scope_id
 WHERE i.execution_id=? ORDER BY i.created_at,i.id`).all(id);
export const executionList=id=>db.prepare(`SELECT e.*,
 (SELECT COUNT(*) FROM execution_items WHERE execution_id=e.id) item_count,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c
 JOIN execution_items i ON i.id=c.execution_item_id
 WHERE i.execution_id=e.id),0) completed_quantity_scaled
 FROM executions e WHERE e.project_id=? ORDER BY e.created_at,e.number`).all(id);
export const executionCountForProject=id=>db.prepare(
 'SELECT COUNT(*) n FROM executions WHERE project_id=?').get(id).n;
export const executionNumberExists=(id,number)=>!!db.prepare(`SELECT 1
 FROM executions WHERE project_id=? AND number=?`).get(id,number);
export function insertExecution(row){
 const cols=Object.keys(row);
 db.prepare('INSERT INTO executions('+cols.join(',')+') VALUES('+
 cols.map(()=>'?').join(',')+')').run(...Object.values(row));
}
export const executionItem=(id,executionId)=>db.prepare(
 'SELECT * FROM execution_items WHERE id=? AND execution_id=?').get(id,executionId);
export function insertExecutionItem(row){
 const cols=Object.keys(row);
 db.prepare('INSERT INTO execution_items('+cols.join(',')+') VALUES('+
 cols.map(()=>'?').join(',')+')').run(...Object.values(row));
}
export function touchExecution(id,time){
 db.prepare('UPDATE executions SET version=version+1,updated_at=? WHERE id=?')
 .run(time,id);
}
export const executionHasItems=id=>!!db.prepare(
 'SELECT 1 FROM execution_items WHERE execution_id=?').get(id);
export function updateExecutionStage(next){
 db.prepare(`UPDATE executions SET status=?,version=?,updated_at=?,started_at=?,
 finished_at=?,close_reason=? WHERE id=?`).run(next.status,next.version,next.updated_at,
 next.started_at,next.finished_at,next.close_reason,next.id);
}
export const completionCount=id=>db.prepare(`SELECT COALESCE(SUM(quantity_scaled),0) n
 FROM effective_completion_records WHERE execution_item_id=?`).get(id).n;
export const completionReplay=key=>db.prepare(
 'SELECT * FROM completion_records WHERE idempotency_key=?').get(key);
export function insertCompletionRecord(row){
 db.prepare('INSERT INTO completion_records VALUES(?,?,?,?,?,?,?,?,?)')
 .run(...Object.values(row));
}
