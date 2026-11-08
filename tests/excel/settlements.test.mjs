import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { approvedFixture } from '../helpers.mjs';
import { createExchange } from '../../server/exchange/service.mjs';
import { makeWorkbook } from '../../server/exchange/workbook.mjs';
test('settlement workbook creates draft only, preserves independent resolution and revises approved history',async t=>{
 const {s,user,project,scope,approval,node}=approvedFixture(t),exchange=createExchange(s);
 const buffer=await makeWorkbook('settlements',{documents:[{number:'IMPORT-S01',project_id:project.id,approval_version_id:approval.id,expected_version:0}],items:[{number:'IMPORT-S01',cost_node_id:node.id,project_scope_id:scope.id,quantity_scaled:10000,amount_fen:30001,evidence:'结算依据'}],resolutions:[{number:'IMPORT-S01',project_scope_id:scope.id,resolved_quantity_scaled:0,evidence:'补结费用'}]});
 let preview=await exchange.preview(user,'settlements',buffer);assert.equal(preview.issues.length,0,JSON.stringify(preview.issues));let result=exchange.commit(user,preview.token,{request_key:'settle-import-key1',atomic:true});let bill=s.finance.settlement(result.results[0].id);assert.equal(bill.version,null);assert.equal(bill.draft.document.resolutions[0].resolved_quantity_scaled,0);
 bill=s.finance.submit(user,bill.id,{expected_version:0,expected_edit_version:1});bill=s.finance.review(user,bill.id,{expected_version:1,expected_event_seq:1,action:'approve'});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await exchange.exportData(user,'settlements',{ids:[bill.id]}));workbook.getWorksheet('费用明细').getCell('F2').value='350.99';
 preview=await exchange.preview(user,'settlements',Buffer.from(await workbook.xlsx.writeBuffer()),{mode:'update'});assert.equal(preview.issues.length,0,JSON.stringify(preview.issues));exchange.commit(user,preview.token,{request_key:'settle-import-key2'});bill=s.finance.settlement(bill.id);assert.equal(bill.items[0].amount_fen,30001);assert.equal(bill.draft.document.items[0].amount_fen,35099);
 bill=s.finance.submit(user,bill.id,{expected_version:1,expected_edit_version:1});s.finance.review(user,bill.id,{expected_version:2,expected_event_seq:1,action:'approve'});assert.equal(s.finance.history(bill.id).length,2);assert.equal(s.finance.summary(project.id).settlement_fen,35099);assert.equal(s.finance.summary(project.id).demands[0].resolved_quantity_scaled,0);
});
test('partial success excludes invalid documents, atomic batch rolls back every write',async t=>{
 const {s,user,project,scope,approval,node}=approvedFixture(t),exchange=createExchange(s);
 const make=async suffix=>makeWorkbook('settlements',{documents:[{number:'GOOD'+suffix,project_id:project.id,approval_version_id:approval.id},{number:'BAD'+suffix,project_id:project.id,approval_version_id:'missing'}],items:[{number:'GOOD'+suffix,cost_node_id:node.id,project_scope_id:scope.id,quantity_scaled:0,amount_fen:100,evidence:'凭据'},{number:'BAD'+suffix,cost_node_id:node.id,quantity_scaled:0,amount_fen:100,evidence:'凭据'}],resolutions:[{number:'GOOD'+suffix,project_scope_id:scope.id,resolved_quantity_scaled:0}]});
 let preview=await exchange.preview(user,'settlements',await make('1'));assert.ok(preview.issues.length);let result=exchange.commit(user,preview.token,{request_key:'partial-import-001'});assert.equal(result.results.length,1);assert.equal(s.finance.allSettlements().length,1);
 preview=await exchange.preview(user,'settlements',await make('2'));assert.throws(()=>exchange.commit(user,preview.token,{request_key:'atomic-import-001',atomic:true}),/全部未写入/);assert.equal(s.finance.allSettlements().length,1);
});
