import {db} from '../connection.mjs';

// Drafts, immutable confirmations and currently-effective budgets are different
// facts. The Application owns capacity and permission checks in one transaction.
export const budgetPlan=id=>db.prepare('SELECT * FROM executions WHERE id=?').get(id);
export const budgetProject=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const currentPlanBudget=id=>db.prepare(
 'SELECT * FROM plan_budget_current WHERE execution_id=?').get(id)||null;
export const latestProjectApproval=id=>db.prepare(`SELECT * FROM project_approval_versions
 WHERE project_id=? ORDER BY version_no DESC LIMIT 1`).get(id);
export const budgetDraft=id=>db.prepare('SELECT * FROM plan_budget_drafts WHERE id=?').get(id);
export const netSettlementsForPlan=id=>db.prepare(`SELECT COALESCE(SUM(CASE
 WHEN se.entry_kind='payment' THEN se.amount_fen ELSE -se.amount_fen END),0) n
 FROM effective_settlement_entries se JOIN execution_items i
 ON i.id=se.execution_item_id WHERE i.execution_id=?`).get(id).n;
export const budgetPlanRows=id=>db.prepare(`SELECT e.id AS execution_id,e.number,e.status,
 b.id AS budget_id,b.version_no AS budget_version,b.kind AS budget_kind,
 b.amount_fen AS confirmed_budget_fen,b.confirmed_at,
 (SELECT COUNT(*) FROM plan_budget_drafts d WHERE d.execution_id=e.id
 AND d.status='draft') AS draft_count
 FROM executions e LEFT JOIN plan_budget_current b ON b.execution_id=e.id
 WHERE e.project_id=? ORDER BY e.created_at,e.number`).all(id);
export const budgetVersionRows=id=>db.prepare(`SELECT b.*,
 u.username AS confirmed_by_name,a.version_no AS project_approval_version_no
 FROM plan_budget_versions b JOIN users u ON u.id=b.confirmed_by
 JOIN project_approval_versions a ON a.id=b.project_approval_version_id
 WHERE b.execution_id=? ORDER BY b.version_no DESC`).all(id);
export const budgetDraftRows=(id,status)=>db.prepare(`SELECT d.*,u.username AS created_by_name,
 v.id AS confirmed_version_id FROM plan_budget_drafts d JOIN users u ON u.id=d.created_by
 LEFT JOIN plan_budget_versions v ON v.proposal_id=d.id
 WHERE d.execution_id=? AND (?='all' OR d.status=?)
 ORDER BY d.created_at DESC,d.id`).all(id,status,status);
export const budgetDraftAudits=id=>db.prepare(`SELECT a.*,u.username AS actor_name
 FROM audit_events a JOIN users u ON u.id=a.actor_id
 WHERE a.entity='plan_budget_drafts' AND a.entity_id=?
 ORDER BY a.created_at,a.rowid`).all(id);
export const confirmedForDraft=id=>db.prepare(
 'SELECT * FROM plan_budget_versions WHERE proposal_id=?').get(id)||null;
export const confirmedByKey=key=>db.prepare(
 'SELECT * FROM plan_budget_versions WHERE request_key=?').get(key)||null;

export function insertBudgetDraft(row){
 const keys=Object.keys(row);
 db.prepare('INSERT INTO plan_budget_drafts('+keys.join(',')+') VALUES('+
  keys.map(()=>'?').join(',')+')').run(...Object.values(row));
}
export function patchBudgetDraft(row){
 db.prepare(`UPDATE plan_budget_drafts SET kind=?,amount_fen=?,basis=?,
 base_budget_version=?,project_approval_version_id=?,version=?,
 updated_by=?,updated_at=? WHERE id=?`).run(
 row.kind,row.amount_fen,row.basis,row.base_budget_version,
 row.project_approval_version_id,row.version,row.updated_by,row.updated_at,row.id);
}
export function setBudgetDraftStatus(id,status,actorId,time){
 if(!['deleted','confirmed'].includes(status))throw Error('无效的预算草稿状态');
 db.prepare(`UPDATE plan_budget_drafts SET status=?,version=version+1,
 updated_by=?,updated_at=? WHERE id=?`).run(status,actorId,time,id);
}
export function insertBudgetConfirmation(row){
 const keys=Object.keys(row);
 db.prepare('INSERT INTO plan_budget_versions('+keys.join(',')+') VALUES('+
 keys.map(()=>'?').join(',')+')').run(...Object.values(row));
}
