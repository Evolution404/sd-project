import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {legacyDatabase,legacyBusiness} from './legacy-fixture.mjs';
function migrate(root,code){return spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,DATA_DIR:root},encoding:'utf8'})}
test('v4 migration preserves quantity, budget, historical facts, draft strings and completion idempotence across two restarts',()=>{
 const root=mkdtempSync(join(tmpdir(),'sd-audit-migration-'));const old=legacyDatabase(root);legacyBusiness(old);old.close();
 try{
  const code=`import assert from 'node:assert/strict';
   import {db,one} from './server/db.mjs';
   import {projectDetail} from './server/projects.mjs';
   import {executionDetail,confirmCompletion} from './server/executions.mjs';
   assert.equal(one('PRAGMA user_version').user_version,8);
   assert.equal(one('SELECT quantity_scaled FROM demands').quantity_scaled,20000);
   assert.equal(one('SELECT default_quantity_scaled FROM dictionary_items WHERE id=?','op').default_quantity_scaled,20000);
   const p=projectDetail('pr');assert.equal(p.approved_budget_fen,20002);assert.equal(p.estimate.known_total_fen,20002);
   assert.equal(p.scopes[0].demand_snapshot.problem_description,'原始问题');
   assert.equal(p.scopes[0].demand_snapshot.quantity_scaled,20000);
   const stage=JSON.parse(p.events[0].snapshot_json);assert.equal(stage.scopes[0].quantity_scaled,20000);assert.equal(stage.scopes[0].demand_snapshot.problem_description,'原始问题');
   const e=executionDetail('ex');assert.equal(e.items[0].planned_quantity_scaled,5000);assert.equal(e.items[0].completed_quantity_scaled,2500);
   confirmCompletion('ex','item',{quantity:'0.25',occurred_on:'2026-10-01',evidence:'验收',idempotency_key:'completion'},{id:'u'});
   assert.equal(one('SELECT COUNT(*) n FROM completion_records').n,1);
   assert.equal(JSON.parse(one('SELECT draft_json FROM demand_batches').draft_json).quantity,'2');
   assert.equal(one('SELECT payload_sha256 FROM demand_batches').payload_sha256,'unchanged');
   assert.equal(JSON.parse(one('SELECT before_json FROM audit_events WHERE id=?','audit').before_json).quantity_scaled,20000);
   assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();`;
  for(let i=0;i<2;i++){const result=migrate(root,code);assert.equal(result.status,0,result.stderr)}
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('missing historical version stops snapshot migration without fabricating facts; can recover and retry',()=>{
 const root=mkdtempSync(join(tmpdir(),'sd-audit-migration-fail-'));const old=legacyDatabase(root);legacyBusiness(old);
 const revision=old.prepare('SELECT * FROM demand_revisions').get();old.exec('DELETE FROM demand_revisions');old.close();
 try{
  const failed=migrate(root,"import './server/db.mjs'");assert.notEqual(failed.status,0);assert.match(failed.stderr,/无法恢复需求历史版本/);
  const partial=new DatabaseSync(join(root,'business.sqlite'));
  assert.equal(partial.prepare('PRAGMA user_version').get().user_version,6);
  assert.equal(partial.prepare("SELECT COUNT(*) n FROM pragma_table_info('demands') WHERE name='custom_fields_json'").get().n,0);
  const snapshot=JSON.parse(revision.snapshot_json);snapshot.quantity_scaled=snapshot.quantity_milli*10;delete snapshot.quantity_milli;
  partial.prepare('INSERT INTO demand_revisions VALUES(?,?,?,?,?,?,?)').run(revision.id,revision.demand_id,revision.version,JSON.stringify(snapshot),revision.reason,revision.changed_by,revision.changed_at);partial.close();
  const retry=migrate(root,"import {db} from './server/db.mjs';db.close()");assert.equal(retry.status,0,retry.stderr);
 }finally{rmSync(root,{recursive:true,force:true})}
});
