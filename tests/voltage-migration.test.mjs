import test from 'node:test';
import {legacyDatabase} from './legacy-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';

test('v4 -> current voltage dictionary migration retains existing voltage IDs and line references',()=>{
 const root=mkdtempSync(join(tmpdir(),'sd-voltage-migration-'));
 const old=legacyDatabase(root);
 try{
  old.prepare('INSERT INTO voltage_levels VALUES(?,?,?,?)').run('v-legacy','110','110kV','active');
  old.prepare('INSERT INTO transmission_lines VALUES(?,?,?,?,?,?,?,?)').run('line-legacy','LINE01','v-legacy','既有线路','active',1,'2026-01-01','2026-01-01');
  old.close();
  // Import the live migration code, not a duplicate SQL implementation.
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import {db,one,all} from './server/db.mjs';
    const v=one('SELECT * FROM voltage_levels WHERE id=?','v-legacy');
    const line=one('SELECT * FROM transmission_lines WHERE id=?','line-legacy');
    if(one('PRAGMA user_version').user_version!==8||v.version!==1||v.sort_order!==100||line.voltage_level_id!==v.id)process.exit(2);
    db.close();
  `],{cwd:process.cwd(),env:{...process.env,DATA_DIR:root},encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const migrated=new DatabaseSync(join(root,'business.sqlite'));
  assert.equal(migrated.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length,0);
  migrated.close();
 }finally{try{old.close()}catch{}rmSync(root,{recursive:true,force:true})}
});
