import {dictionaryDeletions} from './dictionary-deletions.mjs';
import {randomUUID} from 'node:crypto';

// Initial business defaults, not mandated technical standards or settlement rates.
// Never overwrite configured options. Stable identifiers also prevent re-seeding
// when an administrator renames or disables one of the factory defaults.
export const VOLTAGE_DEFAULTS=[
 ['AC35','35kV'],['AC110','110kV'],['AC220','220kV'],
 ['AC500','500kV'],['AC1000','1000kV'],
 ['DC200','±200kV'],['DC500','±500kV'],['DC800','±800kV']
];
const BASIC_OPTIONS={
 unit:[
  ['ITEM','项'],['LOCATION','处'],['TOWER','基'],['SET','套'],['PIECE','个'],
  ['GROUP','组'],['STRING','串'],['METRE','米'],['KM','千米'],
  ['DEVICE','台'],['ROOT','根'],['SLICE','片'],['PHASE','相'],['SPAN','档']
 ],
 source:[
  ['PATROL','巡视'],['INSPECTION','专项检查'],['DEFECT','缺陷排查'],
  ['MONITOR','在线监测'],['SUPERVISION','技术监督'],['REPAIR','故障排查'],
  ['OTHER','其他']
 ],
 priority:[['NORMAL','一般'],['IMPORTANT','较高'],['URGENT','紧急']],
 category:[['DEFECT','设备缺陷'],['RISK','隐患治理'],['ROUTINE','日常检修'],['SPECIAL','专项整治']],
 project_category:[['MAINTENANCE','检修项目'],['REPAIR','修理项目'],['UPGRADE','技术改造'],['EMERGENCY','应急抢修']],
 tower_structure:[['ANGLE_STEEL','角钢塔'],['STEEL_TUBE','钢管塔'],['STEEL_POLE','钢管杆'],['CONCRETE_POLE','混凝土杆']],
 tower_purpose:[['SUSPENSION','直线塔'],['TENSION','耐张塔'],['ANGLE','转角塔'],['TERMINAL','终端塔'],['TRANSPOSITION','换位塔']]
};
// Suggested operation templates, all default to one unit. No acceptance criteria
// are invented: completion standards and specialized fields remain configurable.
const OPERATIONS=[
 ['INSULATOR_REPLACE','更换绝缘子','line','串'],
 ['INSULATOR_CLEAN','清扫绝缘子','line','串'],
 ['BIRD_PROTECTION_INSTALL','安装防鸟装置','line','套'],
 ['BIRD_PROTECTION_REPLACE','更换防鸟装置','line','套'],
 ['DAMPER_REPLACE','更换防振锤','line','个'],
 ['FITTING_REPLACE','更换金具','line','套'],
 ['CONDUCTOR_REPAIR','导线修补','line','处'],
 ['GROUND_WIRE_REPAIR','地线修补','line','处'],
 ['CONDUCTOR_REPLACE','更换导线','line','米'],
 ['GROUND_WIRE_REPLACE','更换地线','line','米'],
 ['TOWER_CORROSION_PROTECTION','杆塔防腐','physical','基'],
 ['TOWER_REPLACE','更换杆塔','physical','基'],
 ['GROUNDING_DEVICE_REPLACE','更换接地装置','physical','套'],
 ['GUY_WIRE_REPLACE','更换拉线','physical','根']
];

/**
 * Called only after an administrator exists. Idempotent for both fresh and
 * existing databases; never upgrades a schema or rewrites a user-edited row.
 * The caller decides the transaction boundary.
 */
export function seedSystemDictionaries(db,actorId){
 if(!actorId)return {voltage:0,items:0};
 const t=new Date().toISOString(),count={voltage:0,items:0};
 const removed=dictionaryDeletions(db);
 const wasDeleted=(type,id,code,name)=>removed.some(({event,before})=>event.entity===(type==='voltage'?'voltage_levels':'dictionary_items')&&(type==='voltage'||before.type_id===type)&&(before.id===id||before.code===code||before.name===name));
 const findVoltage=db.prepare('SELECT id FROM voltage_levels WHERE id=? OR code=? OR name=? LIMIT 1');
 const insertVoltage=db.prepare('INSERT INTO voltage_levels(id,code,name,status,version,sort_order,updated_at) VALUES(?,?,?,\'active\',1,?,?)');
 VOLTAGE_DEFAULTS.forEach(([code,name],index)=>{
  const id='builtin-voltage-'+code;
  if(wasDeleted('voltage',id,code,name)||findVoltage.get(id,code,name))return;
  insertVoltage.run(id,code,name,(index+1)*10,t);count.voltage++;
 });
 const findItem=db.prepare('SELECT id,status FROM dictionary_items WHERE type_id=? AND (id=? OR code=? OR name=?) LIMIT 1');
 const insertItem=db.prepare(`INSERT INTO dictionary_items(id,type_id,code,name,status,sort_order,version,work_target_type,default_unit_id,default_quantity_scaled,completion_standard,fields_json,updated_at)
 VALUES(?,?,?,?,'active',?,1,?,?,?,NULL,'[]',?)`);
 const versionStmt=db.prepare('INSERT INTO dictionary_item_versions(id,item_id,version,snapshot_json,changed_by,changed_at) VALUES(?,?,1,?,?,?)');
 function ensure(type,code,name,order,{work_target_type=null,unit_id=null,default_quantity_scaled=null}={}){
  const id='builtin-'+type+'-'+code;
  if(wasDeleted(type,id,code,name)||findItem.get(type,id,code,name))return;
  const row={
   id,type_id:type,code,name,status:'active',sort_order:order,version:1,
   work_target_type,default_unit_id:unit_id,default_quantity_scaled,
   completion_standard:null,fields_json:'[]',updated_at:t
  };
  insertItem.run(row.id,row.type_id,row.code,row.name,row.sort_order,
   row.work_target_type,row.default_unit_id,row.default_quantity_scaled,row.updated_at);
  versionStmt.run(randomUUID(),id,JSON.stringify(row),actorId,t);
  count.items++;
 }
 for(const [type,options] of Object.entries(BASIC_OPTIONS)){
  options.forEach(([code,name],index)=>ensure(type,code,name,(index+1)*10));
 }
 for(const [code,name,target,unitName] of OPERATIONS){
  const unit=db.prepare("SELECT id,status FROM dictionary_items WHERE type_id='unit' AND name=? ORDER BY id LIMIT 1").get(unitName);
  // A missing/deleted unit is a user decision, not a reason to restore it.
  const available=unit&&unit.status==='active'&&!removed.some(({event})=>event.entity==='dictionary_items'&&event.entity_id===unit.id)?unit:null;
  ensure('operation',code,name,(OPERATIONS.findIndex(item=>item[0]===code)+1)*10,{
   work_target_type:target,unit_id:available?.id||null,default_quantity_scaled:10000
  });
 }
 return count;
}
