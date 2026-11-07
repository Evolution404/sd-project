import {readFileSync} from 'node:fs';
import {SCHEMA_VERSION} from './schema-version.mjs';

const DICTIONARY_TYPES=[
 ['operation','操作类型'],['unit','计量单位'],['source','来源类型'],
 ['priority','优先级'],['category','需求类别'],['project_category','项目类别'],
 ['team','运维班组'],['erection','架设方式'],
 ['tower_structure','杆塔结构类型'],['tower_purpose','杆塔用途'],['expense_category','费用类别']
];

export function initializeSchema(db){
 const current=db.prepare('PRAGMA user_version').get().user_version;
 if(current===0){
  const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
  if(existing)throw Error('发现非空的未识别数据库，已停止初始化；请为开发环境指定新的 DATA_DIR（不会删除原始数据）');
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const part of ['tables.sql','indexes.sql','views.sql','constraints.sql']){
    db.exec(readFileSync(new URL('./schema/'+part,import.meta.url),'utf8'));
   }
   const insert=db.prepare('INSERT INTO dictionary_types(id,title) VALUES(?,?)');
   for(const [id,title] of DICTIONARY_TYPES)insert.run(id,title);
   db.exec('PRAGMA user_version='+SCHEMA_VERSION);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
 }else if(current!==SCHEMA_VERSION){
  throw Error('开发数据库结构版本不匹配（现有 '+current+'，需要 '+SCHEMA_VERSION+'）；无旧库迁移支持，请备份并使用全新的 DATA_DIR');
 }
}
