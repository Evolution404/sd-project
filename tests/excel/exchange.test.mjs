import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { fixture } from '../helpers.mjs';
import { createExchange } from '../../server/exchange/service.mjs';
import { makeWorkbook } from '../../server/exchange/workbook.mjs';
test('demand maintenance export, diff, revision, idempotency and stale version',async t=>{
 const {s,user,demandInput}=fixture(t),exchange=createExchange(s),demand=s.demands.save(user,demandInput);
 const buffer=await exchange.exportData(user,'demands',{ids:[demand.id]});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
 workbook.getWorksheet('作业位置').getRow(2).getCell(7).value=5;
 const edited=Buffer.from(await workbook.xlsx.writeBuffer());
 const preview=await exchange.preview(user,'demands',edited,{mode:'update'});assert.equal(preview.issues.length,0,JSON.stringify(preview.issues));assert.equal(preview.summary.updated,1);
 const result=exchange.commit(user,preview.token,{request_key:'excel-request-0001'});assert.equal(result.issues.length,0,JSON.stringify(result.issues));assert.equal(s.demands.get(demand.id).current_version,2);assert.equal(s.demands.get(demand.id).quantity_scaled,110000);
 assert.deepEqual(exchange.commit(user,preview.token,{request_key:'excel-request-0001'}),result);
 const stale=await exchange.preview(user,'demands',edited,{mode:'update'});assert.ok(stale.issues.some(x=>x.field==='expected_version'));
 const report=await exchange.exportData(user,'demands',{report:true});await assert.rejects(()=>exchange.preview(user,'demands',report),/业务报表/);
});
test('formula cells are rejected and missing detail rows preserve existing positions',async t=>{
 const {s,user,demandInput}=fixture(t),exchange=createExchange(s),demand=s.demands.save(user,demandInput);
 const buffer=await makeWorkbook('demands',{documents:[{demand_no:demand.demand_no,id:demand.id,expected_version:1,problem_description:'新描述'}]});
 const preview=await exchange.preview(user,'demands',buffer);assert.equal(preview.issues.length,0,JSON.stringify(preview.issues));const result=exchange.commit(user,preview.token,{request_key:'excel-preserve-001',atomic:true});assert.equal(result.issues.length,0);assert.equal(s.demands.get(demand.id).work_locations.length,3);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);workbook.getWorksheet('需求清单').getCell('E2').value={formula:'1+1'};const invalid=await exchange.preview(user,'demands',Buffer.from(await workbook.xlsx.writeBuffer()));assert.ok(invalid.issues.some(x=>x.reason.includes('公式')));
});
