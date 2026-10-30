import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

const SCHEMA_VERSION=106; // One canonical development schema, no legacy upgrades.
const ROOT=process.env.DATA_DIR||(process.platform==='win32'
  ?join(process.env.LOCALAPPDATA||homedir(),'SDProject')
  :join(homedir(),'.local','share','sd-project'));
export const dataRoot=ROOT;
mkdirSync(ROOT,{recursive:true});
mkdirSync(join(ROOT,'attachments'),{recursive:true});
mkdirSync(join(ROOT,'backups'),{recursive:true});
export const db=new DatabaseSync(join(ROOT,'business.sqlite'),{timeout:5000});
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');

const current=db.prepare('PRAGMA user_version').get().user_version;
if(current===0){
 const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
 if(existing)throw Error('发现非空的未识别数据库，已停止初始化；请为开发环境指定新的 DATA_DIR（不会删除原始数据）');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const types=[
   ['operation','操作类型'],['unit','计量单位'],['source','来源类型'],
   ['priority','优先级'],['category','需求类别'],['project_category','项目类别'],
   ['team','运维班组'],['erection','架设方式'],
   ['tower_structure','杆塔结构类型'],['tower_purpose','杆塔用途']
  ];
  const insert=db.prepare('INSERT INTO dictionary_types(id,title) VALUES(?,?)');
  for(const [id,title] of types)insert.run(id,title);
  db.exec('PRAGMA user_version='+SCHEMA_VERSION);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}else if(current!==SCHEMA_VERSION){
 throw Error('开发数据库结构版本不匹配（现有 '+current+'，需要 '+SCHEMA_VERSION+'）；无旧库迁移支持，请备份并使用全新的 DATA_DIR');
}
export const now=()=>new Date().toISOString();
export const uid=()=>randomUUID();
export function transaction(fn){
 db.exec('BEGIN IMMEDIATE');
 try{const result=fn();db.exec('COMMIT');return result}
 catch(e){db.exec('ROLLBACK');throw e}
}
export const one=(sql,...args)=>db.prepare(sql).get(...args);
export const all=(sql,...args)=>db.prepare(sql).all(...args);
export const exec=(sql,...args)=>db.prepare(sql).run(...args);
export function audit(actor,entity,id,action,before,after,reason=''){
 exec('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)',
  uid(),actor,entity,id,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason,now());
}
export function snapshot(item){return Object.fromEntries(Object.entries(item).filter(([key])=>!key.startsWith('_')))}
