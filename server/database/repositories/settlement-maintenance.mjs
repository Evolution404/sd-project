import {db} from '../connection.mjs';

// Immutable settlement source/voucher, corrections and revocations are distinct
// facts. Called within one BEGIN IMMEDIATE transaction by Application.
export const currentSettlement=id=>db.prepare(
 'SELECT * FROM settlement_current WHERE id=?').get(id);
export const settlementCommandByKey=key=>db.prepare(
 'SELECT * FROM settlement_commands WHERE request_key=?').get(key);
export function saveSettlementCommand({id,key,hash,entryId,action,actorId,result,time}){
 db.prepare('INSERT INTO settlement_commands VALUES(?,?,?,?,?,?,?,?)')
  .run(id,key,hash,entryId,action,actorId,JSON.stringify(result),time);
}
export function appendSettlementRevision({id,entry,commandId,action,reason,actorId,time}){
 db.prepare(`INSERT INTO settlement_revisions(id,entry_id,version,command_id,
 action,status,settlement_no,settlement_type,amount_fen,occurred_on,evidence,
 reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
 id,entry.id,entry.version+1,commandId,action,
 action==='void'?'voided':'active',entry.settlement_no,entry.settlement_type,
 entry.amount_fen,entry.occurred_on,entry.evidence,reason,actorId,time);
}
const TOTAL_FIELDS={
 project:'project_id',
 scope:'project_scope_id'
};
export function effectiveSettlementNet(kind,id){
 const col=TOTAL_FIELDS[kind];
 if(!col)throw Error('不支持的结算汇总维度');
 return db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment'
 THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE `+col+'=?').get(id).n;
}
export const settlementReversedTotal=id=>db.prepare(`SELECT COALESCE(SUM(amount_fen),0) n
 FROM effective_settlement_entries WHERE reversal_of=?`).get(id).n;
export const settlementProject=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export const settlementScope=id=>db.prepare(
 'SELECT * FROM project_demand_scopes WHERE id=?').get(id);
export const settlementPlanStatus=itemId=>db.prepare(`SELECT e.status FROM executions e
 JOIN execution_items i ON i.execution_id=e.id WHERE i.id=?`).get(itemId);
export const originalSettlement=id=>db.prepare(
 'SELECT * FROM project_settlement_entries WHERE id=?').get(id);
export const settlementActorName=id=>db.prepare(
 'SELECT username FROM users WHERE id=?').get(id)?.username;
export const settlementRevisions=id=>db.prepare(`SELECT r.*,u.username AS changed_by_name
 FROM settlement_revisions r JOIN users u ON u.id=r.changed_by
 WHERE r.entry_id=? ORDER BY r.version`).all(id);
export const settlementLabels=id=>db.prepare(`SELECT p.name AS project_name,
 d.demand_no,e.number AS plan_number,a.version_no AS approval_version_no
 FROM project_settlement_entries se JOIN projects p ON p.id=se.project_id
 JOIN project_demand_scopes s ON s.id=se.project_scope_id
 JOIN demands d ON d.id=s.demand_id
 JOIN project_approval_versions a ON a.id=se.approval_version_id
 LEFT JOIN execution_items i ON i.id=se.execution_item_id
 LEFT JOIN executions e ON e.id=i.execution_id WHERE se.id=?`).get(id);
export const settlementFamily=root=>db.prepare(`SELECT * FROM settlement_current
 WHERE id=? OR reversal_of=? ORDER BY id`).all(root,root);
export const settlementFamilyChronological=root=>db.prepare(`SELECT * FROM settlement_current
 WHERE id=? OR reversal_of=? ORDER BY created_at,id`).all(root,root);
export const activePaymentFamily=id=>db.prepare(`SELECT * FROM settlement_current
 WHERE status='active' AND (id=? OR reversal_of=?) ORDER BY id`).all(id,id);
