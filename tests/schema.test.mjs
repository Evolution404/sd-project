import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const run=(dir,script)=>spawnSync(process.execPath,['--input-type=module','-e',script],{
 cwd:process.cwd(),encoding:'utf8',env:{...process.env,DATA_DIR:dir}
});
test('canonical schema: one-time bootstrap, persistent reopen, foreign keys and integrity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sd-canonical-'));
 const code=`import {db,one,all} from './server/db.mjs';
 import assert from 'node:assert/strict';
 assert.equal(one('PRAGMA user_version').user_version,102);
 assert.equal(one('PRAGMA foreign_keys').foreign_keys,1);
 assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
 assert.equal(all('PRAGMA foreign_key_check').length,0);
 assert.ok(one("SELECT COUNT(*) n FROM sqlite_master WHERE name='project_approval_versions'").n);
 assert.ok(one("SELECT COUNT(*) n FROM sqlite_master WHERE name='project_demand_scopes'").n);
 assert.ok(one("SELECT COUNT(*) n FROM pragma_table_info('project_demand_scopes') WHERE name='status'").n);
 assert.ok(one("SELECT COUNT(*) n FROM sqlite_master WHERE name='frozen_scope_snapshot'").n);
 assert.equal(one('SELECT COUNT(*) n FROM dictionary_types').n,10);
 db.close();`;
 try{
  assert.equal(run(dir,code).status,0,'bootstrap failed');
  assert.equal(run(dir,code).status,0,'reopening same schema must not alter data');
  const raw=new DatabaseSync(join(dir,'business.sqlite'));
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='schema_migrations'").get().n,0);
  raw.close();
 }catch(e){throw e}
 finally{rmSync(dir,{recursive:true,force:true})}
});
test('old or partial development databases fail closed and are never silently wiped',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sd-old-'));
 try{
  const raw=new DatabaseSync(join(dir,'business.sqlite'));
  raw.exec("CREATE TABLE old_data (id TEXT PRIMARY KEY); INSERT INTO old_data VALUES('retain'); PRAGMA user_version=12");
  raw.close();
  const attempted=run(dir,"import './server/db.mjs'");
  assert.notEqual(attempted.status,0);
  assert.match(attempted.stderr,/无旧库迁移支持/);
  const verified=new DatabaseSync(join(dir,'business.sqlite'));
  assert.equal(verified.prepare('SELECT id FROM old_data').get().id,'retain');
  verified.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('nonempty unknown zero-version schema is not overwritten',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sd-partial-'));
 try{
  const raw=new DatabaseSync(join(dir,'business.sqlite'));
  raw.exec("CREATE TABLE valuable_data(id INTEGER); INSERT INTO valuable_data VALUES(88)");
  raw.close();
  const attempted=run(dir,"import './server/db.mjs'");
  assert.notEqual(attempted.status,0);
  assert.match(attempted.stderr,/非空的未识别数据库/);
  const verified=new DatabaseSync(join(dir,'business.sqlite'));
  assert.equal(verified.prepare('SELECT id FROM valuable_data').get().id,88);
  verified.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
