import {db} from '../connection.mjs';

// The topology service owns atomic transactions; SQL and schema field admission
// exist only in this module. Each mutation is a prepared, allowlisted statement.
const INSERT_TABLES=new Set([
 'transmission_lines','line_name_history','physical_towers','logical_towers',
 'logical_tower_name_history','logical_tower_physical_history','ledger_requests',
 'line_spans'
]);
const UPDATE_TABLES=new Set([
 'transmission_lines','physical_towers','logical_towers','line_spans'
]);
const columns=new Map();
function requireColumns(table,fields,allowed){
 if(!allowed.has(table))throw Error('台账数据表不在允许范围内');
 if(!columns.has(table))columns.set(table,new Set(
  db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name)));
 if(fields.some(field=>!columns.get(table).has(field)||field==='id'))
  throw Error('台账数据字段不在允许范围内');
}
export function insertLedgerRecord(table,row){
 const fields=Object.keys(row);
 // An insert is the only statement allowed to supply the immutable primary key.
 requireColumns(table,fields.filter(x=>x!=='id'),INSERT_TABLES);
 if(!fields.length||fields.some(field=>!columns.get(table).has(field)))
  throw Error('不支持的台账插入字段');
 db.prepare('INSERT INTO '+table+'('+fields.join(',')+') VALUES('+
  fields.map(()=>'?').join(',')+')').run(...Object.values(row));
}
export function updateLedgerRecord(table,id,changes){
 const fields=Object.keys(changes);
 requireColumns(table,fields,UPDATE_TABLES);
 if(!fields.length)return;
 db.prepare('UPDATE '+table+' SET '+fields.map(field=>field+'=?').join(',')+
  ' WHERE id=?').run(...fields.map(field=>changes[field]),id);
}
export function touchLedgerLine(id,time){
 db.prepare('UPDATE transmission_lines SET version=version+1,updated_at=? WHERE id=?')
  .run(time,id);
}
export function closeLedgerLineName(id,time){
 db.prepare(`UPDATE line_name_history SET valid_to=?
 WHERE line_id=? AND valid_to IS NULL`).run(time,id);
}
export function deleteLedgerLine(id){
 db.prepare('DELETE FROM line_name_history WHERE line_id=?').run(id);
 db.prepare('DELETE FROM transmission_lines WHERE id=?').run(id);
}
export function reorderLedgerRanks(lineId,ids,time){
 const max=db.prepare(`SELECT COALESCE(MAX(sort_rank),0) n
 FROM logical_towers WHERE line_id=?`).get(lineId).n;
 const first=db.prepare('UPDATE logical_towers SET sort_rank=? WHERE id=?');
 const next=db.prepare(`UPDATE logical_towers SET sort_rank=?,
 version=version+1,updated_at=? WHERE id=?`);
 // Use disjoint temporary rank space to satisfy the partial unique index.
 ids.forEach((id,i)=>first.run(Math.max(max,ids.length*100)+ids.length+i+1,id));
 ids.forEach((id,i)=>next.run((i+1)*100,time,id));
}
export function closeLedgerTowerName(id,time){
 db.prepare(`UPDATE logical_tower_name_history SET valid_to=?
 WHERE logical_tower_id=? AND valid_to IS NULL`).run(time,id);
}
export function closeLedgerPhysicalBinding(id,time){
 db.prepare(`UPDATE logical_tower_physical_history SET valid_to=?
 WHERE logical_tower_id=? AND valid_to IS NULL`).run(time,id);
}
export function deleteLedgerTower(id){
 db.prepare('DELETE FROM logical_tower_name_history WHERE logical_tower_id=?').run(id);
 db.prepare('DELETE FROM logical_tower_physical_history WHERE logical_tower_id=?').run(id);
 db.prepare('DELETE FROM logical_towers WHERE id=?').run(id);
}
export function deleteLedgerSpan(id){
 db.prepare('DELETE FROM line_spans WHERE id=?').run(id);
}
