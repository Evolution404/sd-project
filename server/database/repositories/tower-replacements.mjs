import {db} from '../connection.mjs';

// All historical binding updates run under the caller's single write transaction.
export const replacementSource=id=>db.prepare('SELECT * FROM physical_towers WHERE id=?').get(id);
export const replacementCircuits=id=>db.prepare(`SELECT t.id,t.line_id,t.physical_tower_id,
 t.version,t.tower_no,t.status,l.name AS line_name,l.setup_status AS line_setup_status
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
 WHERE t.physical_tower_id=? AND t.status='active'
 ORDER BY l.name,t.tower_no,t.id`).all(id);
export function replaceTowerBindings(oldId,newId,circuits,actorId,reason,stamp,ids){
 const close=db.prepare(`UPDATE logical_tower_physical_history SET valid_to=?
 WHERE logical_tower_id=? AND valid_to IS NULL`);
 const insert=db.prepare(`INSERT INTO logical_tower_physical_history
 (id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason)
 VALUES(?,?,?,?,NULL,?,?,?)`);
 const update=db.prepare(`UPDATE logical_towers SET physical_tower_id=?,
 version=version+1,updated_at=? WHERE id=?`);
 for(const [index,tower] of circuits.entries()){
  close.run(stamp,tower.id);
  insert.run(ids[index],tower.id,newId,stamp,'replacement',actorId,reason);
  update.run(newId,stamp,tower.id);
 }
 const lineIds=[...new Set(circuits.map(x=>x.line_id))];
 const lineUpdate=db.prepare(`UPDATE transmission_lines
 SET version=version+1,updated_at=? WHERE id=?`);
 for(const id of lineIds)lineUpdate.run(stamp,id);
 db.prepare(`UPDATE physical_towers SET version=version+1,updated_at=?
 WHERE id IN (?,?)`).run(stamp,oldId,newId);
}
