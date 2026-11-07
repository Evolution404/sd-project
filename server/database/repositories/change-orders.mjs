import {db} from '../connection.mjs';

// A change order is an approval-version transaction, never an in-place rewrite
// of frozen snapshots or completed execution history.
export const changeProject=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const changeApproval=id=>db.prepare(`SELECT * FROM project_approval_versions
 WHERE project_id=? ORDER BY version_no DESC LIMIT 1`).get(id);
export const activeDemandForChange=id=>db.prepare(`SELECT * FROM demands
 WHERE id=? AND status='active'`).get(id);
export const changePhysicalPosition=id=>db.prepare('SELECT id,status FROM physical_towers WHERE id=?').get(id);
export const changeSpanPosition=id=>db.prepare('SELECT id,version,status FROM line_spans WHERE id=?').get(id);
export const changeDemandPhysical=id=>db.prepare(
 'SELECT physical_tower_id FROM logical_towers WHERE id=?').get(id);
export const allProjectApprovals=id=>db.prepare(`SELECT * FROM project_approval_versions
 WHERE project_id=? ORDER BY version_no DESC`).all(id);
export const projectChangeOrders=id=>db.prepare(`SELECT * FROM project_change_orders
 WHERE project_id=? ORDER BY created_at DESC,id DESC`).all(id);
export const changeOrderById=id=>db.prepare(
 'SELECT * FROM project_change_orders WHERE id=?').get(id);
export function insertChangeDraft(row){
 const cols=Object.keys(row);
 db.prepare('INSERT INTO project_change_orders('+cols.join(',')+') VALUES('+
 cols.map(()=>'?').join(',')+')').run(...Object.values(row));
}
export function updateChangeDecision(id,status,{actorId,time,reason}={}){
 if(!['submitted','rejected','approved'].includes(status))
  throw Error('无效的变更单流程状态');
 if(status==='submitted')
  db.prepare(`UPDATE project_change_orders SET status='submitted' WHERE id=?`).run(id);
 else db.prepare(`UPDATE project_change_orders SET status=?,decided_by=?,
 decided_at=?,decision_reason=? WHERE id=?`).run(status,actorId,time,reason,id);
}
export const activeChangeScope=(scopeId,projectId)=>db.prepare(`SELECT *
 FROM project_demand_scopes WHERE id=? AND project_id=? AND status='active'`)
 .get(scopeId,projectId);
export const activeScopeExecutions=id=>!!db.prepare(`SELECT 1 FROM execution_items i
 JOIN executions e ON e.id=i.execution_id WHERE i.project_scope_id=?
 AND e.status IN ('planned','running') LIMIT 1`).get(id);
export const netSettledScope=id=>db.prepare(`SELECT COALESCE(SUM(CASE
 WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE project_scope_id=?`).get(id).n;
export const dormantProjectScope=(projectId,demandId)=>db.prepare(`SELECT id
 FROM project_demand_scopes WHERE project_id=? AND demand_id=? AND status='retired'`)
 .get(projectId,demandId);
export const demandQuantity=id=>db.prepare(
 'SELECT quantity_scaled FROM demands WHERE id=?').get(id);
export const competingApprovedProject=(demandId,projectId)=>db.prepare(`SELECT p.id
 FROM project_demand_scopes s JOIN projects p ON p.id=s.project_id
 WHERE s.demand_id=? AND s.status='active' AND p.status IN ('approved','closed')
 AND p.id<>? LIMIT 1`).get(demandId,projectId);
export const changeAgreement=id=>db.prepare('SELECT * FROM agreements WHERE id=?').get(id);
export const changeFramework=id=>db.prepare('SELECT * FROM frameworks WHERE id=?').get(id);
export const otherAgreementApprovedBudget=(agreementId,projectId)=>db.prepare(`SELECT
 COALESCE(SUM(approved_budget_fen),0) n FROM projects WHERE agreement_id=?
 AND id<>? AND status IN ('approved','closed')`).get(agreementId,projectId).n;
export const netSettledProject=id=>db.prepare(`SELECT COALESCE(SUM(CASE
 WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE project_id=?`).get(id).n;
export function reviseApprovedScope(x,time){
 db.prepare(`UPDATE project_demand_scopes SET quantity_scaled=?,unit_price_fen=?,
 price_source=?,price_date=?,tax_mode=?,reference_price_version_id=?,
 updated_at=? WHERE id=?`).run(x.quantity_scaled,x.unit_price_fen,
 x.price_source,x.price_date,x.tax_mode,x.reference_price_version_id||null,
 time,x.scope_id);
}
export function retireApprovedScope(id,time){
 db.prepare(`UPDATE project_demand_scopes SET status='retired',updated_at=?
 WHERE id=?`).run(time,id);
}
export function activateRetiredScope(x,code,time){
 db.prepare(`UPDATE project_demand_scopes SET demand_version=?,quantity_scaled=?,
 unit_price_fen=?,price_source=?,price_date=?,tax_mode=?,
 reference_price_version_id=NULL,note=?,updated_at=?,
 demand_snapshot_json=?,status='active' WHERE id=? AND status='retired'`)
 .run(x.demand_version,x.quantity_scaled,x.unit_price_fen,x.price_source,
 x.price_date,x.tax_mode,'由变更单 '+code+' 重新纳入',time,
 JSON.stringify(x.demand_snapshot),x.scope_id);
}
export function insertApprovedScope(x,projectId,code,time){
 db.prepare(`INSERT INTO project_demand_scopes(id,project_id,demand_id,
 demand_version,quantity_scaled,unit_price_fen,price_source,price_date,
 tax_mode,note,created_at,updated_at,demand_snapshot_json,status)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
 .run(x.scope_id,projectId,x.demand_id,x.demand_version,
 x.quantity_scaled,x.unit_price_fen,x.price_source,x.price_date,x.tax_mode,
 '由变更单 '+code+' 增加',time,time,JSON.stringify(x.demand_snapshot),'active');
}
export function insertChangedApproval(id,projectId,version,snapshot,budget,actorId,time){
 db.prepare('INSERT INTO project_approval_versions VALUES(?,?,?,?,?,?,?)')
  .run(id,projectId,version,JSON.stringify(snapshot),budget,actorId,time);
}
export function setProjectChangedBudget(id,budget,time){
 db.prepare(`UPDATE projects SET version=version+1,approved_budget_fen=?,
 estimate_fen=?,updated_at=? WHERE id=?`).run(budget,budget,time,id);
}
