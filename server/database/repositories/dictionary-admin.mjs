import {db} from '../connection.mjs';
import {dictionaryDeleted} from './dictionary-deletions.mjs';
import {operationById,updateOperation} from './operation-profiles.mjs';

// Administrative persistence: never accept an arbitrary table name from API input.
export function validAdminDictionaryType(type){
 return !!db.prepare(`SELECT 1 FROM dictionary_types WHERE id=?
  AND id NOT IN ('team','erection')`).get(type);
}
export function adminDictionaryItem(table,id){
 if(table==='voltage_levels')return db.prepare('SELECT * FROM voltage_levels WHERE id=?').get(id);
 if(table==='dictionary_items')return db.prepare('SELECT * FROM dictionary_items WHERE id=?').get(id);
 if(table==='operations')return operationById(id);
 throw Error('不支持的字典数据表');
}
export const isDictionaryDeleted=(table,id)=>dictionaryDeleted(db,table,id);
export function dictionaryVersions(id,type=''){
 if(type==='operation')return db.prepare(
  'SELECT * FROM operation_versions WHERE operation_id=? ORDER BY version').all(id);
 return db.prepare('SELECT * FROM dictionary_item_versions WHERE item_id=? ORDER BY version').all(id);
}
export function setAdminDictionaryStatus(table,next,actorId,versionId){
 if(table==='voltage_levels'){
  db.prepare('UPDATE voltage_levels SET status=?,version=?,updated_at=? WHERE id=?')
   .run(next.status,next.version,next.updated_at,next.id);
 }else if(table==='operations'){
  updateOperation(next);
  db.prepare('INSERT INTO operation_versions VALUES(?,?,?,?,?,?)')
   .run(versionId,next.id,next.version,JSON.stringify(next),actorId,next.updated_at);
 }else if(table==='dictionary_items'){
  db.prepare('UPDATE dictionary_items SET status=?,version=?,updated_at=? WHERE id=?')
   .run(next.status,next.version,next.updated_at,next.id);
  db.prepare('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)')
   .run(versionId,next.id,next.version,JSON.stringify(next),actorId,next.updated_at);
 }else throw Error('不支持的字典数据表');
}
export function removeAdminDictionary(table,id){
 if(table==='voltage_levels')db.prepare('DELETE FROM voltage_levels WHERE id=?').run(id);
 else if(table==='operations'){
  db.prepare('DELETE FROM operation_versions WHERE operation_id=?').run(id);
  db.prepare('DELETE FROM operations WHERE id=?').run(id);
 }else if(table==='dictionary_items'){
  db.prepare('DELETE FROM dictionary_item_versions WHERE item_id=?').run(id);
  db.prepare('DELETE FROM dictionary_items WHERE id=?').run(id);
 }else throw Error('不支持的字典数据表');
}
