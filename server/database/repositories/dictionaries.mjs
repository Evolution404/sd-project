import {randomUUID} from 'node:crypto';
import {db} from '../connection.mjs';
import {saveOperation,updateOperation,operationRows} from './operation-profiles.mjs';
import {currentDictionaryRows} from './dictionary-deletions.mjs';

// Persistence-only operations. The Application/Domain owns business validity,
// the database owns relational integrity and the one atomic write transaction.
export function insertDictionaryItem(item,snapshot,actor){
 if(item.type_id==='operation'){
  saveOperation(snapshot);
  db.prepare('INSERT INTO operation_versions VALUES(?,?,?,?,?,?)').run(
   randomUUID(),item.id,item.version,JSON.stringify(snapshot),actor,item.updated_at);
  return;
 }
 db.prepare(`INSERT INTO dictionary_items
  (id,type_id,code,name,status,sort_order,version,fields_json,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).run(item.id,item.type_id,item.code,item.name,
  item.status,item.sort_order,item.version,item.fields_json,item.updated_at);
 db.prepare('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)').run(
  randomUUID(),item.id,item.version,JSON.stringify(snapshot),actor,item.updated_at);
}

export function updateDictionaryItem(old,next,actor){
 if(old.type_id==='operation'){
  updateOperation(next);
  db.prepare('INSERT INTO operation_versions VALUES(?,?,?,?,?,?)').run(
   randomUUID(),next.id,next.version,JSON.stringify(next),actor,next.updated_at);
  return;
 }
 db.prepare(`UPDATE dictionary_items SET
  code=?,name=?,status=?,sort_order=?,version=?,fields_json=?,updated_at=?
  WHERE id=?`).run(next.code,next.name,next.status,next.sort_order,next.version,
  next.fields_json,next.updated_at,next.id);
 db.prepare('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)').run(
  randomUUID(),next.id,next.version,JSON.stringify(next),actor,next.updated_at);
}

// Dictionary administrative ordering: only these two canonical tables are used.
export const dictionaryTypeExists=id=>!!db.prepare('SELECT id FROM dictionary_types WHERE id=?').get(id);
export function nextOrderNumber(type){
 const row=type==='voltage'
  ?db.prepare('SELECT MAX(sort_order) n FROM voltage_levels').get()
  :type==='operation'?db.prepare('SELECT MAX(sort_order) n FROM operations').get()
  :db.prepare('SELECT MAX(sort_order) n FROM dictionary_items WHERE type_id=?').get(type);
 return Math.max(100,(row.n??0)+10);
}
export function dictionaryRowsForOrder(type){
 if(type==='voltage')return currentDictionaryRows(db,'voltage_levels',
  db.prepare('SELECT * FROM voltage_levels').all());
 if(type==='operation')return currentDictionaryRows(db,'operations',operationRows());
 return currentDictionaryRows(db,'dictionary_items',
  db.prepare('SELECT * FROM dictionary_items WHERE type_id=?').all(type));
}
export function setDictionaryOrder(table,next,actorId,versionId){
 if(table==='voltage_levels'){
  db.prepare('UPDATE voltage_levels SET sort_order=?,version=?,updated_at=? WHERE id=?')
   .run(next.sort_order,next.version,next.updated_at,next.id);
 }else if(table==='operations'){
  updateOperation(next);
  db.prepare('INSERT INTO operation_versions VALUES(?,?,?,?,?,?)')
   .run(versionId,next.id,next.version,JSON.stringify(next),actorId,next.updated_at);
 }else if(table==='dictionary_items'){
  db.prepare('UPDATE dictionary_items SET sort_order=?,version=?,updated_at=? WHERE id=?')
   .run(next.sort_order,next.version,next.updated_at,next.id);
  db.prepare('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)')
   .run(versionId,next.id,next.version,JSON.stringify(next),actorId,next.updated_at);
 }else throw Error('字典排序只支持标准字典表');
}
