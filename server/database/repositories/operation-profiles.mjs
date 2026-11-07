import {db} from '../connection.mjs';

// All current operation capabilities live in the operation entity itself.
export function withOperationProfiles(rows){
 return rows.map(row=>{
  if(row.type_id!=='operation')return row;
  if(row.operation_profile)return row;
  const {allow_tower,allow_span,default_location_kind,
   default_target_object,entry_hint,...fields}=row;
  return {...fields,operation_profile:{
   location_kinds:[...(allow_tower?['tower']:[]),...(allow_span?['span']:[])],
   default_location_kind,default_target_object,entry_hint
  }};
 });
}
export function operationById(id){
 const row=db.prepare('SELECT * FROM operations WHERE id=?').get(id);
 return row?withOperationProfiles([{...row,type_id:'operation'}])[0]:null;
}
export function operationRows(status){
 const rows=status?db.prepare('SELECT * FROM operations WHERE status=?').all(status):
  db.prepare('SELECT * FROM operations ORDER BY sort_order,name').all();
 return withOperationProfiles(rows.map(row=>({...row,type_id:'operation'})));
}
export function saveOperation(item){
 const profile=item.operation_profile;
 if(!profile||!Array.isArray(profile.location_kinds))throw Error('缺少作业位置定义');
 const fields=[
  item.id,item.code,item.name,item.status,item.sort_order,item.version,
  item.work_target_type,item.default_unit_id,item.default_quantity_scaled,
  item.completion_standard,item.fields_json,
  Number(profile.location_kinds.includes('tower')),
  Number(profile.location_kinds.includes('span')),
  profile.default_location_kind,profile.default_target_object??'',
  profile.entry_hint??'',item.updated_at
 ];
 db.prepare(`INSERT INTO operations
  (id,code,name,status,sort_order,version,work_target_type,default_unit_id,
   default_quantity_scaled,completion_standard,fields_json,allow_tower,
   allow_span,default_location_kind,default_target_object,entry_hint,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...fields);
}
export function updateOperation(item){
 const profile=item.operation_profile;
 db.prepare(`UPDATE operations SET code=?,name=?,status=?,sort_order=?,version=?,
  work_target_type=?,default_unit_id=?,default_quantity_scaled=?,completion_standard=?,
  fields_json=?,allow_tower=?,allow_span=?,default_location_kind=?,
  default_target_object=?,entry_hint=?,updated_at=? WHERE id=?`).run(
  item.code,item.name,item.status,item.sort_order,item.version,item.work_target_type,
  item.default_unit_id,item.default_quantity_scaled,item.completion_standard,item.fields_json,
  Number(profile.location_kinds.includes('tower')),
  Number(profile.location_kinds.includes('span')),
  profile.default_location_kind,profile.default_target_object??'',
  profile.entry_hint??'',item.updated_at,item.id);
}
