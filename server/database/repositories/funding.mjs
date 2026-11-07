import {db} from '../connection.mjs';

// Funding operations are restricted to two durable aggregate roots.
const table=kind=>{
 if(kind!=='frameworks'&&kind!=='agreements')throw Error('不支持的资金对象');
 return kind;
};
const owner=kind=>table(kind)==='frameworks'?'framework_id':'agreement_id';
export const fundingDeletionEvent=(kind,id)=>db.prepare(`SELECT * FROM audit_events WHERE
 entity=? AND entity_id=? AND action='delete'
 ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(table(kind),id);
export const deletedFundingIds=kind=>new Set(db.prepare(`SELECT entity_id FROM audit_events
 WHERE entity=? AND action='delete'`).all(table(kind)).map(r=>r.entity_id));
export const fundingRow=(kind,id)=>db.prepare('SELECT * FROM '+table(kind)+' WHERE id=?').get(id);
export const fundingAgreements=frameworkId=>db.prepare(`SELECT * FROM agreements
 WHERE framework_id=? ORDER BY created_at,id`).all(frameworkId);
export const fundingProjects=(kind,id)=>db.prepare(`SELECT id,name,status,framework_id,
 agreement_id,approved_budget_fen FROM projects WHERE `+owner(kind)+
 '=? ORDER BY created_at,id').all(id);
export function fundingUsedAmounts(kind,id){
 const field=owner(kind);
 return {
  settled:db.prepare(`SELECT COALESCE(SUM(CASE WHEN s.entry_kind='payment'
 THEN s.amount_fen ELSE -s.amount_fen END),0) n FROM effective_settlement_entries s
 JOIN projects p ON p.id=s.project_id WHERE p.`+field+'=?').get(id).n,
  planBudget:db.prepare(`SELECT COALESCE(SUM(b.amount_fen),0) n
 FROM plan_budget_current b JOIN executions e ON e.id=b.execution_id
 JOIN projects p ON p.id=e.project_id WHERE p.`+field+'=?').get(id).n,
  actualCost:db.prepare(`SELECT COALESCE(SUM(c.amount_fen),0) n
 FROM cost_current c JOIN executions e ON e.id=c.execution_id
 JOIN projects p ON p.id=e.project_id WHERE c.status='active' AND p.`+field+'=?').get(id).n
 };
}
export const fundingHistory=(kind,id)=>db.prepare(`SELECT a.*,u.username actor_name
 FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
 WHERE a.entity=? AND a.entity_id=?
 ORDER BY a.created_at DESC,a.rowid DESC`).all(table(kind),id);
export const fundingDeletedRows=kind=>db.prepare(`SELECT entity_id FROM audit_events
 WHERE entity=? AND action='delete' ORDER BY created_at DESC,rowid DESC`)
 .all(table(kind));
export const fundingFrameworkName=id=>db.prepare(
 'SELECT name FROM frameworks WHERE id=?').get(id)?.name??null;
export const otherAgreementLimits=(frameworkId,agreementId)=>db.prepare(`SELECT
 COALESCE(SUM(limit_fen),0) n FROM agreements WHERE framework_id=? AND id<>?`)
 .get(frameworkId,agreementId).n;
const FIELDS={
 frameworks:new Set(['name','limit_fen','status','fiscal_year','version','updated_at']),
 agreements:new Set(['name','limit_fen','status','framework_id','version','updated_at'])
};
export function patchFunding(kind,id,changes){
 table(kind);
 const fields=Object.keys(changes);
 if(fields.some(field=>!FIELDS[kind].has(field)))throw Error('资金变更字段未授权');
 if(!fields.length)return;
 db.prepare('UPDATE '+kind+' SET '+fields.map(field=>field+'=?').join(',')+
 ' WHERE id=?').run(...fields.map(field=>changes[field]),id);
}
export function removeFunding(kind,id,logical,time){
 table(kind);
 if(logical)db.prepare('UPDATE '+kind+` SET status='inactive',
 version=version+1,updated_at=? WHERE id=?`).run(time,id);
 else db.prepare('DELETE FROM '+kind+' WHERE id=?').run(id);
}
