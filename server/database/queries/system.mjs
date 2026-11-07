import {db} from '../connection.mjs';
import {dictionaryDeleted,currentDictionaryRows} from '../repositories/dictionary-deletions.mjs';
import {operationById,operationRows} from '../repositories/operation-profiles.mjs';

const REGISTRY=new Set(['voltage_levels','transmission_lines','physical_towers','logical_towers']);
const requireTable=name=>{
 if(!REGISTRY.has(name))throw Error('不支持的基础台账实体');
 return name;
};

export const healthStatus=()=>({
 ok:true,
 database:db.prepare('PRAGMA quick_check').get().quick_check==='ok',
 schema:db.prepare('PRAGMA user_version').get().user_version
});
export function overviewCounts(){
 return {
  lines:db.prepare('SELECT COUNT(*) n FROM transmission_lines').get().n,
  physical:db.prepare('SELECT COUNT(*) n FROM physical_towers').get().n,
  logical:db.prepare('SELECT COUNT(*) n FROM logical_towers').get().n,
  pending:db.prepare("SELECT COUNT(*) n FROM demands WHERE status='pending'").get().n,
  active:db.prepare("SELECT COUNT(*) n FROM demands WHERE status='active'").get().n
 };
}
export const dictionaryTypes=()=>db.prepare(
 "SELECT * FROM dictionary_types WHERE id NOT IN ('team','erection') ORDER BY rowid").all();
export const dictionaryType=id=>db.prepare('SELECT * FROM dictionary_types WHERE id=?').get(id);
export function dictionaryItem(id,type){
 if(type==='operation'){
  const op=operationById(id);return op&&!dictionaryDeleted(db,'operations',id)?op:null;
 }
 const x=db.prepare('SELECT * FROM dictionary_items WHERE id=? AND type_id=?').get(id,type);
 return x&&!dictionaryDeleted(db,'dictionary_items',id)?x:null;
}
export function dictionaryRawItem(id){
 const op=operationById(id);
 if(op&&!dictionaryDeleted(db,'operations',id))return op;
 const x=db.prepare('SELECT * FROM dictionary_items WHERE id=?').get(id);
 return x&&!dictionaryDeleted(db,'dictionary_items',id)?x:null;
}
export function dictionaryItems(type){
 const rows=type==='operation'?[]:type?
  db.prepare('SELECT * FROM dictionary_items WHERE type_id=? ORDER BY sort_order,name').all(type):
  db.prepare('SELECT * FROM dictionary_items ORDER BY type_id,sort_order,name').all();
 const regular=currentDictionaryRows(db,'dictionary_items',rows);
 const ops=type&&type!=='operation'?[]:
  currentDictionaryRows(db,'operations',operationRows());
 return [...regular,...ops];
}
export function registryList(name,lineId=null){
 const table=requireTable(name);
 if(table==='logical_towers')return db.prepare(`SELECT t.*,l.name AS line_name,
  v.name AS voltage_name,p.tower_code AS physical_code FROM logical_towers t
  JOIN transmission_lines l ON l.id=t.line_id
  JOIN voltage_levels v ON v.id=l.voltage_level_id
  LEFT JOIN physical_towers p ON p.id=t.physical_tower_id
  WHERE (? IS NULL OR t.line_id=?) ORDER BY l.name,t.sort_rank`).all(lineId,lineId);
 if(table==='transmission_lines')return db.prepare(`SELECT l.*,v.name AS voltage_name
  FROM transmission_lines l JOIN voltage_levels v ON v.id=l.voltage_level_id
  ORDER BY l.name`).all();
 const rows=db.prepare('SELECT * FROM '+table+
  (table==='voltage_levels'?' ORDER BY sort_order,name':' ORDER BY rowid DESC')+' LIMIT 1000').all();
 return table==='voltage_levels'?currentDictionaryRows(db,table,rows):rows;
}
export function registryDetail(name,id){
 const table=requireTable(name);
 const item=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);
 if(!item||table==='voltage_levels'&&dictionaryDeleted(db,table,id))return null;
 const names={
  transmission_lines:['line_name_history','line_id'],
  logical_towers:['logical_tower_name_history','logical_tower_id']
 };
 const history=names[table]?db.prepare('SELECT * FROM '+names[table][0]+' WHERE '+
  names[table][1]+'=? ORDER BY valid_from DESC').all(id):[];
 const physical=table==='logical_towers'?db.prepare(`SELECT * FROM logical_tower_physical_history
  WHERE logical_tower_id=? ORDER BY valid_from DESC`).all(id):[];
 return {...item,name_history:history,physical_history:physical};
}
