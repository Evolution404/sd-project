import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {migrateQuantities,migrateSnapshots} from './audit-migrations.mjs';
const ROOT = process.env.DATA_DIR || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || homedir(),'SDProject') : join(homedir(), '.local','share','sd-project'));
export const dataRoot = ROOT;
mkdirSync(ROOT,{recursive:true}); mkdirSync(join(ROOT,'attachments'),{recursive:true}); mkdirSync(join(ROOT,'backups'),{recursive:true});
export const db = new DatabaseSync(join(ROOT,'business.sqlite'),{timeout:5000});
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
const migrationVersion = db.prepare('PRAGMA user_version').get().user_version;
if(migrationVersion===0){
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(readFileSync(new URL('./core-towers.sql',import.meta.url),'utf8'));
    db.exec(readFileSync(new URL('./business.sql',import.meta.url),'utf8'));
    const types=[['operation','操作类型'],['unit','工作单位'],['source','来源类型'],['priority','优先级'],['category','需求类别']];
    for(const [id,title] of types) db.prepare('INSERT INTO dictionary_types(id,title) VALUES(?,?)').run(id,title);
    db.exec("PRAGMA user_version=1"); db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}else if(migrationVersion>11){throw Error('不支持的数据库版本 '+migrationVersion)}
if(migrationVersion<2){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(readFileSync(new URL('./migration-002.sql',import.meta.url),'utf8'));
  db.exec('PRAGMA user_version=2');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<3){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(readFileSync(new URL('./migration-003.sql',import.meta.url),'utf8'));
  db.exec('PRAGMA user_version=3');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<4){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(readFileSync(new URL('./migration-004.sql',import.meta.url),'utf8'));
  db.exec('PRAGMA user_version=4');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<5){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(readFileSync(new URL('./migration-005.sql',import.meta.url),'utf8'));
  db.exec('PRAGMA user_version=5');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
for(const [version,migrate] of [[6,migrateQuantities],[7,migrateSnapshots]])if(migrationVersion<version){
 db.exec('BEGIN IMMEDIATE');
 try{migrate(db);db.exec('PRAGMA user_version='+version);db.exec('COMMIT')}
 catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<8){
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(readFileSync(new URL('./migration-008.sql',import.meta.url),'utf8'));db.exec('PRAGMA user_version=8');db.exec('COMMIT')}
 catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<9){
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(readFileSync(new URL('./migration-009.sql',import.meta.url),'utf8'));db.exec('PRAGMA user_version=9');db.exec('COMMIT')}
 catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<10){
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(readFileSync(new URL('./migration-010.sql',import.meta.url),'utf8'));db.exec('PRAGMA user_version=10');db.exec('COMMIT')}
 catch(e){db.exec('ROLLBACK');throw e}
}
if(migrationVersion<11){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(readFileSync(new URL('./migration-011.sql',import.meta.url),'utf8'));
  const approved=db.prepare("SELECT * FROM projects WHERE status IN ('approved','closed')").all();
  for(const p of approved){
   const stage=db.prepare("SELECT * FROM project_stage_events WHERE project_id=? AND stage='approved'").get(p.id);
   if(!stage||!p.approved_budget_fen&&p.approved_budget_fen!==0)
    throw Error('已立项项目缺少不可变的批准事件或批准预算，停止迁移：'+p.id);
   const versionId=randomUUID();
   db.prepare('INSERT INTO project_approval_versions VALUES(?,?,?,?,?,?,?)').run(
    versionId,p.id,1,stage.snapshot_json,p.approved_budget_fen,stage.actor_id,stage.created_at);
   db.prepare('UPDATE executions SET approval_version_id=? WHERE project_id=?').run(versionId,p.id);
  }
  for(const i of db.prepare('SELECT * FROM execution_items').all()){
   const scope=db.prepare('SELECT * FROM project_demand_scopes WHERE id=?').get(i.project_scope_id);
   if(!scope||!scope.demand_snapshot_json)throw Error('执行历史快照缺失，停止迁移：'+i.id);
   db.prepare('UPDATE execution_items SET scope_snapshot_json=? WHERE id=?').run(
    JSON.stringify({demand_snapshot_json:scope.demand_snapshot_json,quantity_scaled:scope.quantity_scaled,
      unit_price_fen:scope.unit_price_fen,price_source:scope.price_source,price_date:scope.price_date,
      tax_mode:scope.tax_mode}),i.id);
  }
  db.exec('PRAGMA user_version=11');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
export const now=()=>new Date().toISOString();
export const uid=()=>randomUUID();
export function transaction(fn){
 db.exec('BEGIN IMMEDIATE');
 try { const value=fn(); db.exec('COMMIT');return value; }
 catch(e){db.exec('ROLLBACK');throw e;}
}
export const one=(sql,...args)=>db.prepare(sql).get(...args);
export const all=(sql,...args)=>db.prepare(sql).all(...args);
export const exec=(sql,...args)=>db.prepare(sql).run(...args);
export function audit(actor,entity,id,action,before,after,reason=''){
 exec('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)',uid(),actor,entity,id,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason,now());
}
export function snapshot(item){return Object.fromEntries(Object.entries(item).filter(([k])=>!k.startsWith('_')))}
