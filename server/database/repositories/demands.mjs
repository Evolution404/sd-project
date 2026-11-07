import {db} from '../connection.mjs';

// Only these canonical columns may be revised through application commands.
const columns=new Set(db.prepare('PRAGMA table_info(demands)').all()
 .map(row=>row.name).filter(name=>name!=='id'));
export const demandById=id=>db.prepare('SELECT * FROM demands WHERE id=?').get(id);

export function saveDemandRevision(id,old,reason,actorId,timestamp,revisionId){
 db.prepare(`INSERT INTO demand_revisions
 (id,demand_id,version,snapshot_json,reason,changed_by,changed_at)
 VALUES(?,?,?,?,?,?,?)`).run(revisionId,id,old.version,JSON.stringify(old),
  reason,actorId,timestamp);
}
export function patchDemandFields(id,changes){
 const keys=Object.keys(changes);
 if(keys.some(key=>!columns.has(key)))throw Error('需求记录包含不允许修改的字段');
 if(!keys.length)return;
 db.prepare('UPDATE demands SET '+keys.map(key=>key+'=?').join(',')+' WHERE id=?')
  .run(...keys.map(key=>changes[key]),id);
}
