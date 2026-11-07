import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('database module backup stores SQLite and attachments under DATA_DIR',()=>{
 const data=mkdtempSync(join(tmpdir(),'sd-backup-'));
 try{
  const program=`
   import {writeFileSync,readFileSync} from 'node:fs';
   import {join} from 'node:path';
   import {DatabaseSync} from 'node:sqlite';
   import {backupDatabase,db,dataRoot} from './server/database/index.mjs';
   writeFileSync(join(dataRoot,'attachments','proof.txt'),'backup-test');
   const dest=await backupDatabase();
   const manifest=JSON.parse(readFileSync(join(dest,'manifest.json'),'utf8'));
   const copy=new DatabaseSync(join(dest,'business.sqlite'));
   const version=copy.prepare('PRAGMA user_version').get().user_version;
   copy.close();db.close();
   console.log(JSON.stringify({dest,version,files:manifest.files.length,
    attachment:readFileSync(join(dest,'attachments','proof.txt'),'utf8')}));
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],
   {cwd:join(import.meta.dirname,'..','..'),env:{...process.env,DATA_DIR:data},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(child.stdout.trim());
  assert.equal(result.version,112);
  assert.equal(result.attachment,'backup-test');
  assert.equal(result.files,2);
  assert.ok(result.dest.startsWith(join(data,'backups')+'/'));
  assert.ok(existsSync(join(result.dest,'manifest.json')));
 }finally{rmSync(data,{recursive:true,force:true})}
});
