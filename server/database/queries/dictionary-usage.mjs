import {db} from '../connection.mjs';
import {dictionaryDeletions,currentDictionaryRows} from '../repositories/dictionary-deletions.mjs';
import {operationRows} from '../repositories/operation-profiles.mjs';

// Authoritative read model for administrative dictionary usage.
const COUNTS=[
 ['transmission_lines','voltage_level_id'],['reference_price_catalog','voltage_level_id'],
 ['demands','operation_id'],['demands','unit_id'],['demands','priority_id'],
 ['source_records','type_id'],['cost_drafts','category_id'],['cost_versions','category_id'],
 ['reference_price_catalog','operation_id'],['reference_price_catalog','unit_id'],['projects','category_id']
];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const includesId=(value,id)=>{
 if(value===id)return true;
 return value!==null&&typeof value==='object'&&Object.values(value).some(child=>includesId(child,id));
};

export function dictionaryWorkspaceFacts(){
 const types=db.prepare("SELECT * FROM dictionary_types WHERE id NOT IN ('team','erection') ORDER BY rowid").all();
 const counts=new Map();
 for(const [table,column] of COUNTS){
  for(const row of db.prepare('SELECT '+quote(column)+' id,COUNT(*) n FROM '+quote(table)+
   ' WHERE '+quote(column)+' IS NOT NULL GROUP BY '+quote(column)).all())
   counts.set(row.id,(counts.get(row.id)||0)+row.n);
 }
 const activeUnits=new Set(db.prepare("SELECT id FROM dictionary_items WHERE type_id='unit' AND status='active'").all().map(x=>x.id));
 const defaults=new Map(db.prepare(`SELECT default_unit_id id,COUNT(*) n FROM operations
  GROUP BY default_unit_id`).all().map(x=>[x.id,x.n]));
 const structure=new Map(db.prepare('SELECT tower_type name,COUNT(*) n FROM physical_towers GROUP BY tower_type')
  .all().map(x=>[x.name,x.n]));
 const purpose=new Map(db.prepare('SELECT purpose name,COUNT(*) n FROM physical_towers GROUP BY purpose')
  .all().map(x=>[x.name,x.n]));
 const items=[
  ...currentDictionaryRows(db,'voltage_levels',db.prepare("SELECT *,'voltage' type_id FROM voltage_levels").all()),
  ...currentDictionaryRows(db,'dictionary_items',db.prepare('SELECT * FROM dictionary_items').all()),
  ...currentDictionaryRows(db,'operations',operationRows())
 ];
 return {types,counts,activeUnits,defaults,structure,purpose,items,deleted:dictionaryDeletions(db)};
}

export function dictionaryReferences(table,item,type){
 const refs=[];
 // Historical snapshots are reference evidence, not an excuse to delete live business facts.
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
 for(const {name} of tables){
  if(name==='audit_events'||name==='operation_versions'&&table==='operations')continue;
  const fks=db.prepare('PRAGMA foreign_key_list('+quote(name)+')').all()
   .filter(key=>key.table===table&&!(name==='dictionary_item_versions'&&key.from==='item_id'));
  const jsonCols=db.prepare('PRAGMA table_info('+quote(name)+')').all()
   .filter(column=>column.name.endsWith('_json')).map(column=>column.name);
  const fields=[...new Set([...jsonCols,...fks.map(f=>f.from)])];
  if(!fields.length)continue;
  const filter=name==='dictionary_item_versions'?' WHERE item_id<>?':'';
  let count=0;
  for(const row of db.prepare('SELECT '+fields.map(quote).join(',')+
    ' FROM '+quote(name)+filter).all(...(filter?[item.id]:[]))){
   if(fks.some(key=>row[key.from]===item.id)||jsonCols.some(column=>{
    if(!row[column])return false;
    let value;
    try{value=JSON.parse(row[column])}
    catch{throw Object.assign(new Error('存在无法读取的历史数据，请先核查后再删除'),{status:409})}
    return includesId(value,item.id);
   }))count++;
  }
  if(count)refs.push({name,count});
 }
 if(type==='tower_structure'||type==='tower_purpose'){
  const col=type==='tower_structure'?'tower_type':'purpose';
  const count=db.prepare('SELECT COUNT(*) n FROM physical_towers WHERE '+quote(col)+'=?').get(item.name).n;
  if(count)refs.push({name:'physical_tower_by_name',count});
 }
 return refs;
}
