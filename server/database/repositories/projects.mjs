import {db} from '../connection.mjs';

// Project reserve -> stock -> approve is a single authority chain.
// Every write must run in the caller's write transaction.
export const projectFramework=id=>db.prepare('SELECT * FROM frameworks WHERE id=?').get(id);
export const projectAgreement=id=>db.prepare('SELECT * FROM agreements WHERE id=?').get(id);
export const projectById=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const projectCategory=id=>db.prepare(`SELECT * FROM dictionary_items
 WHERE id=? AND type_id='project_category' AND status='active'`).get(id);
export const projectCategoryStatus=id=>db.prepare(`SELECT status FROM dictionary_items
 WHERE id=? AND type_id='project_category'`).get(id);
export const projectScopes=id=>db.prepare(`SELECT s.*,
 d.quantity_scaled AS demand_quantity_scaled,d.status AS demand_status
 FROM project_demand_scopes s JOIN demands d ON d.id=s.demand_id
 WHERE s.project_id=? AND s.status='active' ORDER BY s.created_at,s.id`).all(id);
export const frameworksWithUsage=()=>db.prepare(`SELECT f.*,
 COALESCE((SELECT SUM(a.limit_fen) FROM agreements a WHERE a.framework_id=f.id),0)
 agreement_limit_fen,
 (SELECT COUNT(*) FROM agreements a WHERE a.framework_id=f.id) agreement_count,
 COALESCE((SELECT SUM(p.approved_budget_fen) FROM projects p
 WHERE p.framework_id=f.id AND p.status IN ('approved','closed')),0)
 approved_project_budget_fen FROM frameworks f ORDER BY f.created_at DESC`).all();
export const agreementsWithUsage=()=>db.prepare(`SELECT a.*,f.name AS framework_name,
 f.code AS framework_code,
 COALESCE((SELECT SUM(p.approved_budget_fen) FROM projects p
 WHERE p.agreement_id=a.id AND p.status IN ('approved','closed')),0)
 approved_budget_fen FROM agreements a JOIN frameworks f ON f.id=a.framework_id
 ORDER BY a.created_at DESC`).all();
export const usedAgreementCapacity=id=>db.prepare(
 'SELECT COALESCE(SUM(limit_fen),0) n FROM agreements WHERE framework_id=?').get(id).n;
const insert=(table,row)=>{
 const cols=Object.keys(row);
 db.prepare('INSERT INTO '+table+'('+cols.join(',')+') VALUES('+
 cols.map(()=>'?').join(',')+')').run(...Object.values(row));
};
export const insertFramework=row=>insert('frameworks',row);
export const insertAgreement=row=>insert('agreements',row);
export const insertProject=row=>insert('projects',row);
export function updateProjectPreliminary(id,row){
 db.prepare(`UPDATE projects SET category_id=?,preliminary_estimate_fen=?,
 preliminary_estimate_basis=?,preliminary_estimate_at=?,preliminary_estimate_by=?,
 updated_at=?,version=? WHERE id=?`).run(row.category_id,row.preliminary_estimate_fen,
 row.preliminary_estimate_basis,row.preliminary_estimate_at,row.preliminary_estimate_by,
 row.updated_at,row.version,id);
}
export const allProjects=()=>db.prepare(`SELECT p.*,a.name AS agreement_name,
 f.name AS framework_name,(SELECT COUNT(*) FROM project_demand_scopes s
 WHERE s.project_id=p.id AND s.status='active') demand_count
 FROM projects p LEFT JOIN agreements a ON a.id=p.agreement_id
 JOIN frameworks f ON f.id=p.framework_id ORDER BY p.created_at DESC`).all();
export const projectEvents=id=>db.prepare(`SELECT * FROM project_stage_events
 WHERE project_id=? ORDER BY created_at`).all(id);
export const frameworkProjectLabels=id=>db.prepare(
 'SELECT name,fiscal_year FROM frameworks WHERE id=?').get(id);
export const agreementProjectLabel=id=>db.prepare(
 'SELECT name FROM agreements WHERE id=?').get(id);
export const projectDemand=id=>db.prepare('SELECT * FROM demands WHERE id=?').get(id);
export const physicalTowerAtDemand=id=>db.prepare('SELECT id,status FROM physical_towers WHERE id=?').get(id);
export const physicalAtTower=id=>db.prepare(`SELECT physical_tower_id
 FROM logical_towers WHERE id=?`).get(id);
export function insertProjectScope(row){insert('project_demand_scopes',row)}
export function touchProject(id,time){
 db.prepare('UPDATE projects SET version=version+1,updated_at=? WHERE id=?').run(time,id);
}
export const projectScope=(scopeId,projectId)=>db.prepare(`SELECT *
 FROM project_demand_scopes WHERE id=? AND project_id=?`).get(scopeId,projectId);
export function updateProjectScope(id,row){
 db.prepare(`UPDATE project_demand_scopes SET demand_version=?,quantity_scaled=?,
 unit_price_fen=?,price_source=?,price_date=?,tax_mode=?,note=?,updated_at=?,
 demand_snapshot_json=?,reference_price_version_id=? WHERE id=?`).run(
 row.demand_version,row.quantity_scaled,row.unit_price_fen,row.price_source,
 row.price_date,row.tax_mode,row.note,row.updated_at,row.demand_snapshot_json,
 row.reference_price_version_id,id);
}
export function setProjectAgreement(id,agreementId,version,time){
 db.prepare(`UPDATE projects SET agreement_id=?,version=?,updated_at=? WHERE id=?`)
 .run(agreementId,version,time,id);
}
export const approvedBudgetsForAgreement=id=>db.prepare(`SELECT
 COALESCE(SUM(approved_budget_fen),0) n FROM projects WHERE agreement_id=?
 AND status IN ('approved','closed')`).get(id).n;
export const otherApprovedProjectForDemand=(demandId,projectId)=>db.prepare(`SELECT p.id
 FROM project_demand_scopes s JOIN projects p ON p.id=s.project_id
 WHERE s.demand_id=? AND s.status='active' AND p.status IN ('approved','closed')
 AND p.id<>? LIMIT 1`).get(demandId,projectId);
export function updateProjectStage(id,stage,version,estimate,approvedBudget,time){
 db.prepare(`UPDATE projects SET status=?,version=?,estimate_fen=?,
 approved_budget_fen=?,updated_at=? WHERE id=?`)
 .run(stage,version,estimate,approvedBudget,time,id);
}
export function insertProjectStage(row){
 db.prepare('INSERT INTO project_stage_events VALUES(?,?,?,?,?,?,?,?)')
 .run(row.id,row.project_id,row.stage,row.version,row.snapshot_json,
  row.reason,row.actor_id,row.created_at);
}
export function insertProjectApproval(row){
 db.prepare('INSERT INTO project_approval_versions VALUES(?,?,?,?,?,?,?)')
 .run(row.id,row.project_id,row.version_no,row.snapshot_json,row.approved_budget_fen,
  row.approved_by,row.approved_at);
}
