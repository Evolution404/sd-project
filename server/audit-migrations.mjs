import {createHash} from 'node:crypto';
const quantityKeys=new Set(['quantity_milli','default_quantity_milli','planned_quantity_milli','completed_quantity_milli','approved_scope_quantity_milli','demand_quantity_milli']);
function upgradeJSON(value){
 if(Array.isArray(value))return value.map(upgradeJSON);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,v])=>quantityKeys.has(key)?[key.replace('_milli','_scaled'),v===null?null:v*10]:[key,upgradeJSON(v)]));
}
export function migrateQuantities(db){
 for(const [table,column] of [['dictionary_items','default_quantity_milli'],['demands','quantity_milli'],['project_demand_scopes','quantity_milli'],['execution_items','planned_quantity_milli'],['completion_records','quantity_milli']]){
  const next=column.replace('_milli','_scaled');
  db.exec(`ALTER TABLE ${table} RENAME COLUMN ${column} TO ${next}; UPDATE ${table} SET ${next}=${next}*10 WHERE ${next} IS NOT NULL;`);
 }
 for(const [table,columns] of [['dictionary_item_versions',['snapshot_json']],['demand_revisions',['snapshot_json']],['project_stage_events',['snapshot_json']],['audit_events',['before_json','after_json']]]){
  for(const row of db.prepare(`SELECT id,${columns.join(',')} FROM ${table}`).all()){
   for(const col of columns)if(row[col]!==null)db.prepare(`UPDATE ${table} SET ${col}=? WHERE id=?`).run(JSON.stringify(upgradeJSON(JSON.parse(row[col]))),row.id);
  }
 }
 // Completion keys must still replay successfully after the integer scale changes.
 for(const c of db.prepare(`SELECT c.*,i.execution_id FROM completion_records c JOIN execution_items i ON i.id=c.execution_item_id`).all()){
  const hash=createHash('sha256').update(JSON.stringify({executionId:c.execution_id,itemId:c.execution_item_id,q:c.quantity_scaled,date:c.occurred_on,evidence:c.evidence})).digest('hex');
  db.prepare('UPDATE completion_records SET payload_hash=? WHERE id=?').run(hash,c.id);
 }
}
export function migrateSnapshots(db){
 db.exec(`ALTER TABLE demands ADD COLUMN custom_fields_json TEXT NOT NULL DEFAULT '{}';
 ALTER TABLE demands ADD COLUMN field_definitions_json TEXT NOT NULL DEFAULT '[]';
 ALTER TABLE project_demand_scopes ADD COLUMN demand_snapshot_json TEXT;`);
 const hydrate=d=>{
  const version=db.prepare('SELECT snapshot_json FROM dictionary_item_versions WHERE item_id=? AND version=?').get(d.operation_id,d.operation_version);
  return {...d,custom_fields_json:d.custom_fields_json||'{}',field_definitions_json:d.field_definitions_json|| (version?JSON.parse(version.snapshot_json).fields_json:'[]')||'[]'};
 };
 const historical=(id,version)=>{
  const current=db.prepare('SELECT * FROM demands WHERE id=?').get(id);
  if(current?.version===version)return hydrate(current);
  const old=db.prepare('SELECT snapshot_json FROM demand_revisions WHERE demand_id=? AND version=?').get(id,version);
  if(old)return hydrate(JSON.parse(old.snapshot_json));
  throw Error('无法恢复需求历史版本，请先核对历史记录：'+id+' v'+version);
 };
 for(const scope of db.prepare('SELECT * FROM project_demand_scopes').all()){
  db.prepare('UPDATE project_demand_scopes SET demand_snapshot_json=? WHERE id=?').run(JSON.stringify(historical(scope.demand_id,scope.demand_version)),scope.id);
 }
 for(const event of db.prepare('SELECT * FROM project_stage_events').all()){
  const snapshot=JSON.parse(event.snapshot_json);
  for(const scope of snapshot.scopes||[])scope.demand_snapshot=historical(scope.demand_id,scope.demand_version);
  db.prepare('UPDATE project_stage_events SET snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot),event.id);
 }
 db.exec(`CREATE TRIGGER frozen_scope_snapshot BEFORE UPDATE OF demand_snapshot_json ON project_demand_scopes
 WHEN (SELECT status FROM projects WHERE id=OLD.project_id)!='reserve' AND NEW.demand_snapshot_json IS NOT OLD.demand_snapshot_json
 BEGIN SELECT RAISE(ABORT,'入库需求快照不可改写'); END;`);
}
