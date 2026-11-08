import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../helpers.mjs';
import { createExchange } from '../../server/exchange/service.mjs';
import { makeWorkbook } from '../../server/exchange/workbook.mjs';
test('5000 complete demands preflight and single atomic batch, retry and restart-safe identities',async t=>{
 const {s,user,operation}=fixture(t),exchange=createExchange(s),timestamp=new Date().toISOString();
 s.repo.transaction(()=>{for(let i=0;i<5000;i++)s.repo.insert('physical_towers',{id:`bulk-tower-${i}`,tower_code:`BULK-${i}`,created_by:user.id,created_at:timestamp,updated_at:timestamp});});
 const documents=[],work_locations=[];for(let i=0;i<5000;i++){const number=`BULK-D${i}`;documents.push({demand_no:number,operation_id:operation.id,problem_description:'批量巡视事实',completion_standard:'安装牢固'});work_locations.push({demand_no:number,location_kind:'physical_tower',physical_tower_id:`bulk-tower-${i}`,quantity_scaled:10000});}
 const started=performance.now(),buffer=await makeWorkbook('demands',{documents,work_locations});const preview=await exchange.preview(user,'demands',buffer,{mode:'create'});assert.equal(preview.issues.length,0,JSON.stringify(preview.issues.slice(0,2)));assert.equal(preview.summary.created,5000);
 const result=exchange.commit(user,preview.token,{request_key:'bulk5000-import-001',atomic:true});assert.equal(result.results.length,5000);assert.equal(s.repo.list('v_demand_current').length,5000);assert.equal(s.repo.list('demand_version_work_locations').length,5000);assert.deepEqual(exchange.commit(user,preview.token,{request_key:'bulk5000-import-001',atomic:true}),result);assert.equal(s.repo.integrity().foreignKeys.length,0);console.log('BULK_5000_MS',Math.round(performance.now()-started));
});
