import {db} from '../connection.mjs';

export const auditRow=id=>db.prepare(`SELECT a.*,u.username actor_name
 FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.id=?`).get(id);
export const auditControls=id=>db.prepare(`SELECT a.*,u.username actor_name
 FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
 WHERE a.entity_id=? AND a.entity IN ('audit_annotations','audit_visibility')
 ORDER BY a.created_at,a.rowid`).all(id);
export const manualAuditRow=id=>db.prepare(`SELECT a.*,u.username actor_name
 FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
 WHERE a.entity='manual_notes' AND a.entity_id=? ORDER BY a.rowid DESC LIMIT 1`).get(id);
export function auditList({entity,search,status,page,limit}){
 const where=["a.entity NOT IN ('audit_annotations','audit_visibility')"],args=[];
 if(entity){where.push('a.entity=?');args.push(entity)}
 if(search){where.push(`(a.reason LIKE ? OR u.username LIKE ? OR a.entity_id LIKE ?
 OR EXISTS(SELECT 1 FROM audit_events c WHERE c.entity='audit_annotations'
 AND c.entity_id=a.id AND c.after_json LIKE ?))`);args.push(...Array(4).fill('%'+search+'%'))}
 const hidden=`COALESCE((SELECT v.action FROM audit_events v WHERE v.entity='audit_visibility'
 AND v.entity_id=a.id ORDER BY v.created_at DESC,v.rowid DESC LIMIT 1),'show')='hide'`;
 if(status!=='all')where.push(status==='deleted'?hidden:'NOT ('+hidden+')');
 const condition=where.join(' AND '),sql=` FROM audit_events a
 LEFT JOIN users u ON u.id=a.actor_id WHERE `+condition;
 const total=db.prepare('SELECT COUNT(*) n'+sql).get(...args).n;
 const items=db.prepare(`SELECT a.*,u.username actor_name`+sql+
  ' ORDER BY a.created_at DESC,a.rowid DESC LIMIT ? OFFSET ?')
  .all(...args,limit,(page-1)*limit);
 const entities=db.prepare(`SELECT DISTINCT entity FROM audit_events WHERE
 entity NOT IN ('audit_annotations','audit_visibility') ORDER BY entity`)
  .all().map(x=>x.entity);
 return {items,total,entities};
}
