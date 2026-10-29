import {backup} from 'node:sqlite';
import {mkdirSync,cpSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {db,dataRoot,now} from '../server/db.mjs';
const stamp=now().replace(/[:.]/g,'-'),dest=join(dataRoot,'backups',stamp);
mkdirSync(dest,{recursive:true});
await backup(db,join(dest,'business.sqlite'));
cpSync(join(dataRoot,'attachments'),join(dest,'attachments'),{recursive:true});
const files=[];
function collect(dir,prefix=''){
 for(const item of readdirSync(dir,{withFileTypes:true})){
  const name=prefix+item.name,full=join(dir,item.name);
  if(item.isDirectory())collect(full,name+'/');
  else files.push({name,bytes:readFileSync(full).length,sha256:createHash('sha256').update(readFileSync(full)).digest('hex')});
 }
}
collect(dest);
writeFileSync(join(dest,'manifest.json'),JSON.stringify({created_at:now(),files},null,2));
console.log('备份生成：'+dest);
console.log('建议复制至另一物理介质。正式业务并发附件写入期间应采用维护窗口。');
