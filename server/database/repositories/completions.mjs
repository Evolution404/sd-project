import {db} from '../connection.mjs';

// Authoritative completion command, event and read projections.
export const completedRecord=id=>db.prepare(
 'SELECT * FROM completion_current WHERE id=?').get(id);
export const completionItemContext=id=>db.prepare(`SELECT i.*,e.project_id,
 e.number AS plan_number,e.status AS plan_status,e.version AS plan_version,
 e.approval_version_id,s.quantity_scaled AS current_scope_quantity_scaled,
 s.status AS scope_status,s.demand_id,d.demand_no,d.unit_snapshot,
 s.demand_snapshot_json,p.version AS project_version,p.status AS project_status
 FROM execution_items i JOIN executions e ON e.id=i.execution_id
 JOIN projects p ON p.id=e.project_id
 JOIN project_demand_scopes s ON s.id=i.project_scope_id
 JOIN demands d ON d.id=s.demand_id WHERE i.id=?`).get(id);
export const completionPlanExists=id=>!!db.prepare(
 'SELECT 1 FROM executions WHERE id=?').get(id);
export const completedPlanRows=(planId,status)=>db.prepare(`SELECT c.*,s.demand_id,
 d.demand_no,d.unit_snapshot,i.scope_snapshot_json,s.demand_snapshot_json,
 u.username AS confirmed_by_name FROM completion_current c
 JOIN execution_items i ON i.id=c.execution_item_id
 JOIN project_demand_scopes s ON s.id=i.project_scope_id
 JOIN demands d ON d.id=s.demand_id JOIN users u ON u.id=c.confirmed_by
 WHERE i.execution_id=? AND (?='all' OR c.status=?)
 ORDER BY c.occurred_on DESC,c.confirmed_at DESC,c.id`).all(planId,status,status);
export const originalCompletedRecord=id=>db.prepare(
 'SELECT * FROM completion_records WHERE id=?').get(id);
export const completionUserName=id=>db.prepare(
 'SELECT username FROM users WHERE id=?').get(id)?.username;
export const completionHistory=id=>db.prepare(`SELECT r.*,u.username AS changed_by_name
 FROM completion_revisions r JOIN users u ON u.id=r.changed_by
 WHERE r.record_id=? ORDER BY r.version`).all(id);
export const completionCommandByKey=key=>db.prepare(
 'SELECT * FROM completion_commands WHERE request_key=?').get(key);
export function appendCompletionRevision({id,entry,commandId,action,reason,actorId,time}){
 db.prepare(`INSERT INTO completion_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
 .run(id,entry.id,entry.version+1,commandId,action,
  action==='void'?'voided':'active',
  entry.quantity_scaled,entry.occurred_on,entry.evidence,reason,actorId,time);
}
export function saveCompletionCommand({id,key,hash,recordId,action,actorId,result,time}){
 db.prepare('INSERT INTO completion_commands VALUES(?,?,?,?,?,?,?,?)')
  .run(id,key,hash,recordId,action,actorId,JSON.stringify(result),time);
}
export function touchExecutionForCompletion(planId,time){
 db.prepare('UPDATE executions SET version=version+1,updated_at=? WHERE id=?')
  .run(time,planId);
}
export function completionScopeSiblings(scopeId){
 return db.prepare(`SELECT i.id,i.planned_quantity_scaled,e.version,e.status,
 COALESCE((SELECT SUM(c.quantity_scaled) FROM effective_completion_records c
 WHERE c.execution_item_id=i.id),0) AS completed_quantity_scaled
 FROM execution_items i JOIN executions e ON e.id=i.execution_id
 WHERE i.project_scope_id=? ORDER BY i.id`).all(scopeId);
}
