import { DatabaseSync } from 'node:sqlite';
import { readFileSync,existsSync,mkdirSync,copyFileSync,cpSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function restoreBackup(sourceDirectory,destinationDirectory){
 const source=resolve(sourceDirectory),target=resolve(destinationDirectory);
 if(source===target||existsSync(target))throw Error('恢复目标必须为尚不存在的独立目录');
 const path=join(source,'schema113.sqlite'),db=new DatabaseSync(path,{readOnly:true});
 try {
  if(db.prepare('PRAGMA user_version').get().user_version!==113)throw Error('备份结构版本无效');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('备份数据库完整性校验失败');
  for(const file of db.prepare('SELECT * FROM evidence_files').all()){
   if(file.storage_key!==`sha256/${file.sha256.slice(0,2)}/${file.sha256}`)throw Error('附件路径无效');
   const bytes=readFileSync(join(source,'objects',file.storage_key));
   if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('备份附件不完整');
  }
 }finally{db.close();}
 mkdirSync(target,{recursive:true});copyFileSync(path,join(target,'schema113.sqlite'));
 if(existsSync(join(source,'objects')))cpSync(join(source,'objects'),join(target,'objects'),{recursive:true});
 return target;
}
