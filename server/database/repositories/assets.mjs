import {db} from '../connection.mjs';
import {dictionaryDeleted} from './dictionary-deletions.mjs';

// Physical-tower identity and logical-line membership remain separate.
const CAN_UPDATE={
 voltage_levels:new Set(['code','name','status','sort_order','version','updated_at']),
 physical_towers:new Set(['asset_no','tower_type','longitude','latitude','commissioned_on','status','version','updated_at']),
 logical_towers:new Set(['tower_no','display_name','sort_rank','circuit_position','physical_tower_id','management_department','maintenance_team','status','version','updated_at'])
};
export function assetById(table,id){
 if(!(table in CAN_UPDATE))throw Error('不支持的设备资料表');
 const row=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);
 return row&&!(table==='voltage_levels'&&dictionaryDeleted(db,table,id))?row:null;
}
export const lineById=id=>db.prepare('SELECT * FROM transmission_lines WHERE id=?').get(id);
export const physicalById=id=>db.prepare('SELECT * FROM physical_towers WHERE id=?').get(id);
export const logicalAtLocation=id=>db.prepare(`SELECT t.*,l.name AS line_name,
 l.status AS line_status,l.voltage_level_id,l.setup_status,p.tower_code,
 p.status AS physical_status
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
 LEFT JOIN physical_towers p ON p.id=t.physical_tower_id WHERE t.id=?`).get(id);
export const hasActivePhysicalDependents=id=>!!db.prepare(`SELECT 1 FROM logical_towers
 WHERE physical_tower_id=? AND status='active' LIMIT 1`).get(id);
export const hasActiveLineDependents=id=>!!db.prepare(`SELECT 1 FROM logical_towers
 WHERE line_id=? AND status='active' LIMIT 1`).get(id);

export function createVoltage(item){
 db.prepare(`INSERT INTO voltage_levels(id,code,name,status,version,sort_order,updated_at)
 VALUES(?,?,?,?,?,?,?)`).run(item.id,item.code,item.name,item.status,item.version,item.sort_order,item.updated_at);
}
export function createPhysical(item){
 db.prepare(`INSERT INTO physical_towers(id,tower_code,asset_no,tower_type,longitude,latitude,
 commissioned_on,status,version,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(item.id,item.tower_code,item.asset_no,item.tower_type,
 item.longitude,item.latitude,item.commissioned_on,item.status,item.version,item.created_at,item.updated_at);
}
export function createLogical(item,physical,userId,time,historyIds){
 const keys=Object.keys(item);
 db.prepare('INSERT INTO logical_towers('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')')
  .run(...Object.values(item));
 db.prepare(`INSERT INTO logical_tower_name_history
  (id,logical_tower_id,tower_no,display_name,valid_from,valid_to,changed_by,reason)
  VALUES(?,?,?,?,?,NULL,?,?)`)
  .run(historyIds.name,item.id,item.tower_no,item.display_name,time,userId,'初始登记');
 if(physical)db.prepare(`INSERT INTO logical_tower_physical_history
  (id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason)
  VALUES(?,?,?,?,NULL,?,?,?)`)
  .run(historyIds.physical,item.id,physical.id,time,'initial',userId,'初始核实');
}
export function patchAsset(table,id,changes){
 if(!(table in CAN_UPDATE))throw Error('不支持的设备资料表');
 const keys=Object.keys(changes);
 if(!keys.length)return;
 if(keys.some(key=>!CAN_UPDATE[table].has(key)))throw Error('修改字段不属于设备资料结构');
 db.prepare('UPDATE '+table+' SET '+keys.map(key=>key+'=?').join(',')+' WHERE id=?')
  .run(...keys.map(key=>changes[key]),id);
}
export function recordTowerNameChange(id,next,userId,reason,time,eventId){
 db.prepare(`UPDATE logical_tower_name_history SET valid_to=?
  WHERE logical_tower_id=? AND valid_to IS NULL`).run(time,id);
 db.prepare(`INSERT INTO logical_tower_name_history
 (id,logical_tower_id,tower_no,display_name,valid_from,valid_to,changed_by,reason)
 VALUES(?,?,?,?,?,NULL,?,?)`).run(eventId,id,next.tower_no,next.display_name,time,userId,reason);
}
export function recordPhysicalBindingChange(id,physicalId,userId,reason,time,kind,eventId){
 db.prepare(`UPDATE logical_tower_physical_history SET valid_to=?
  WHERE logical_tower_id=? AND valid_to IS NULL`).run(time,id);
 if(physicalId)db.prepare(`INSERT INTO logical_tower_physical_history
 (id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason)
 VALUES(?,?,?,?,NULL,?,?,?)`).run(eventId,id,physicalId,time,kind,userId,reason);
}
