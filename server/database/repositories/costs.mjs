import {db} from '../connection.mjs';
import {dictionaryDeleted} from './dictionary-deletions.mjs';

// Actual expense drafts, immutable revisions and allocated cost shares.
export const costPlan=id=>db.prepare('SELECT * FROM executions WHERE id=?').get(id);
export const currentCost=id=>db.prepare('SELECT * FROM cost_current WHERE entry_id=?').get(id);
export const costDraft=id=>db.prepare('SELECT * FROM cost_drafts WHERE id=?').get(id);
export function expenseCategory(id){
 const row=db.prepare(`SELECT * FROM dictionary_items WHERE id=?
 AND type_id='expense_category'`).get(id);
 return row&&row.status==='active'&&!dictionaryDeleted(db,'dictionary_items',id)?row:null;
}
export const versionCostShares=id=>db.prepare(`SELECT execution_item_id,amount_fen
 FROM cost_allocations WHERE version_id=? ORDER BY execution_item_id`).all(id);
export const isPlanItem=(itemId,executionId)=>!!db.prepare(`SELECT 1
 FROM execution_items WHERE id=? AND execution_id=?`).get(itemId,executionId);
export const costDraftHistory=id=>db.prepare(`SELECT a.*,u.username actor_name
 FROM audit_events a JOIN users u ON u.id=a.actor_id
 WHERE a.entity='cost_drafts' AND a.entity_id=?
 ORDER BY a.created_at,a.rowid`).all(id);
const insertObject=(table,row)=>{
 const names=Object.keys(row);
 db.prepare('INSERT INTO '+table+'('+names.join(',')+') VALUES('+
 names.map(()=>'?').join(',')+')').run(...Object.values(row));
};
export const insertExpenseDraft=row=>insertObject('cost_drafts',row);
const MUTABLE=new Set(['entry_id','base_version','kind','category_id','name',
 'occurred_on','amount_fen','evidence','reason','allocations_json',
 'version','updated_by','updated_at']);
export function patchExpenseDraft(id,row,keys){
 if(keys.some(k=>!MUTABLE.has(k)))throw Error('不支持的费用草稿字段');
 db.prepare('UPDATE cost_drafts SET '+keys.map(k=>k+'=?').join(',')+
 ' WHERE id=?').run(...keys.map(k=>row[k]),id);
}
export function setExpenseDraftDeleted(id,actorId,time){
 db.prepare(`UPDATE cost_drafts SET status='deleted',version=version+1,
 updated_by=?,updated_at=? WHERE id=?`).run(actorId,time,id);
}
export const confirmedCostByRequest=key=>db.prepare(
 'SELECT * FROM cost_versions WHERE request_key=?').get(key);
export function insertCostEntry(id,executionId,actorId,time){
 db.prepare('INSERT INTO cost_entries VALUES(?,?,?,?)').run(id,executionId,actorId,time);
}
export const insertCostVersion=row=>insertObject('cost_versions',row);
export function addCostShares(versionId,allocations,ids){
 const write=db.prepare('INSERT INTO cost_allocations VALUES(?,?,?,?)');
 for(const [index,item] of allocations.entries())
  write.run(ids[index],versionId,item.execution_item_id,item.amount_fen);
}
export function setExpenseDraftConfirmed(id,entryId,actorId,time){
 db.prepare(`UPDATE cost_drafts SET status='confirmed',entry_id=?,
 version=version+1,updated_by=?,updated_at=? WHERE id=?`)
 .run(entryId,actorId,time,id);
}
export const costShareDetails=id=>db.prepare(`SELECT a.*,s.demand_id,d.demand_no
 FROM cost_allocations a JOIN execution_items i ON i.id=a.execution_item_id
 JOIN project_demand_scopes s ON s.id=i.project_scope_id
 JOIN demands d ON d.id=s.demand_id WHERE a.version_id=?`).all(id);
export const costVersions=id=>db.prepare(`SELECT v.*,u.username confirmed_by_name
 FROM cost_versions v JOIN users u ON u.id=v.confirmed_by
 WHERE entry_id=? ORDER BY version_no DESC`).all(id);
export const costVersionShares=id=>db.prepare(
 'SELECT * FROM cost_allocations WHERE version_id=?').all(id);
export const costReconRows=id=>db.prepare(`SELECT * FROM cost_reconciliation_current
 WHERE cost_entry_id=? ORDER BY confirmed_at`).all(id);
export const planCostBudget=id=>db.prepare(
 'SELECT amount_fen FROM plan_budget_current WHERE execution_id=?').get(id);
export const projectCostBudget=id=>db.prepare(
 'SELECT approved_budget_fen FROM projects WHERE id=?').get(id);
export const projectActualCost=id=>db.prepare(`SELECT COALESCE(SUM(c.amount_fen),0) n
 FROM cost_current c JOIN executions e ON e.id=c.execution_id
 WHERE e.project_id=? AND c.status='active'`).get(id).n;
export const costItemsForPlan=id=>db.prepare(`SELECT i.id,s.demand_id,d.demand_no
 FROM execution_items i JOIN project_demand_scopes s ON s.id=i.project_scope_id
 JOIN demands d ON d.id=s.demand_id WHERE i.execution_id=?
 ORDER BY i.created_at,i.id`).all(id);
export const activeExpenseCategories=()=>db.prepare(`SELECT * FROM dictionary_items
 WHERE type_id='expense_category' AND status='active'
 ORDER BY sort_order,name`).all().filter(c=>!dictionaryDeleted(db,'dictionary_items',c.id));
export const currentPlanCosts=(id,status)=>db.prepare(`SELECT * FROM cost_current
 WHERE execution_id=? AND (?='all' OR status=?)
 ORDER BY occurred_on DESC,confirmed_at DESC`).all(id,status,status);
export const costDraftsForPlan=(id,status)=>db.prepare(`SELECT d.*,u.username created_by_name
 FROM cost_drafts d JOIN users u ON u.id=d.created_by
 WHERE execution_id=? AND (?='all' OR d.status=?)
 ORDER BY d.created_at DESC,d.id`).all(id,status,status);
