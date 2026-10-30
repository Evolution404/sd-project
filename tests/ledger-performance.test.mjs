import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';

const root=mkdtempSync(join(tmpdir(),'sd-ledger-perf-'));
process.env.DATA_DIR=root;
const {db,one}=await import('../server/db.mjs');
const {listLedgerLines,ledgerTowers,ledgerSpans}=await import('../server/ledgers.mjs');

test('G5: large isolated line directory and paged tower/span queries preserve counts',()=>{
 const t0=performance.now();
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES('perf-user','perf-user','x','admin','2026-10-30')").run();
  db.prepare("INSERT INTO voltage_levels(id,code,name) VALUES('perf-v','PERF110','110kV')").run();
  const line=db.prepare("INSERT INTO transmission_lines(id,line_code,voltage_level_id,name) VALUES(?,?,?,?)");
  const physical=db.prepare("INSERT INTO physical_towers(id,tower_code,longitude,latitude) VALUES(?,?,?,?)");
  const tower=db.prepare("INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,tower_no,sort_rank,status) VALUES(?,?,?,?,?,?,?)");
  const span=db.prepare("INSERT INTO line_spans(id,line_id,start_tower_id,end_tower_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,'active','perf-user','2026-10-30','2026-10-30')");
  for(let i=0;i<60;i++){
   const lid='perf-line-'+i;line.run(lid,'PERF-'+i,'perf-v','性能线路'+String(i).padStart(3,'0'));
   for(let j=0;j<75;j++){
    const pid='perf-physical-'+i+'-'+Math.floor(j/2),tid='perf-tower-'+i+'-'+j;
    if(j%2===0)physical.run(pid,pid,118+i/1000,32+j/10000);
    tower.run(tid,tid,lid,pid,String(j+1).padStart(3,'0'),(j+1)*100,'active');
    if(j>0)span.run('perf-span-'+i+'-'+j,lid,'perf-tower-'+i+'-'+(j-1),tid);
   }
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 const seededMs=performance.now()-t0;
 const t1=performance.now();
 const lines=listLedgerLines();
 const t2=performance.now();
 const towers=ledgerTowers(new URLSearchParams({page:'3',page_size:'100'}));
 const t3=performance.now();
 const spans=ledgerSpans(new URLSearchParams({page:'2',page_size:'100'}));
 const t4=performance.now();
 assert.equal(lines.length,60);
 assert.ok(lines.every(x=>x.tower_count===75&&x.span_count===74));
 assert.equal(towers.total,4500);assert.equal(towers.rows.length,100);
 assert.ok(towers.rows.every(t=>t.shared_count>=1&&t.shared_count<=2));
 assert.equal(spans.total,4440);assert.equal(spans.rows.length,100);
 assert.ok(spans.rows.every(s=>s.demand_count===0&&s.length_scaled!==null));
 assert.equal(one('SELECT COUNT(*) n FROM logical_towers').n,4500);
 assert.equal(one('SELECT COUNT(*) n FROM line_spans').n,4440);
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 console.log('LEDGER_PERF_SYNTHETIC',JSON.stringify({
  lines:60,towers:4500,spans:4440,
  seed_ms:Number(seededMs.toFixed(1)),
  directory_ms:Number((t2-t1).toFixed(1)),
  towers_paged_ms:Number((t3-t2).toFixed(1)),
  spans_paged_ms:Number((t4-t3).toFixed(1))
 }));
});
process.on('exit',()=>{try{db.close()}catch{}rmSync(root,{recursive:true,force:true})});
