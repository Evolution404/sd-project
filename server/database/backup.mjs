import {backup} from 'node:sqlite';
import {mkdirSync,cpSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {db} from './connection.mjs';
import {dataRoot} from './data-path.mjs';

export async function backupDatabase(){
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const dest=join(dataRoot,'backups',stamp);
 mkdirSync(dest,{recursive:true});
 await backup(db,join(dest,'business.sqlite'));
 cpSync(join(dataRoot,'attachments'),join(dest,'attachments'),{recursive:true});
 const files=[];
 function collect(dir,prefix=''){
  for(const item of readdirSync(dir,{withFileTypes:true})){
   const name=prefix+item.name,full=join(dir,item.name);
   if(item.isDirectory())collect(full,name+'/');
   else{
    const bytes=readFileSync(full);
    files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
   }
  }
 }
 collect(dest);
 writeFileSync(join(dest,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),files},null,2));
 return dest;
}
