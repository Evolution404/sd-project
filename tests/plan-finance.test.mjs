import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const root=mkdtempSync(join(tmpdir(),'sd-plan-finance-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let base,cookie;
before(async()=>{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{
  env:{...process.env,SD_ADMIN_USER:'finance-admin',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 base='http://127.0.0.1:'+app.address().port;
 const result=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({username:'finance-admin',password:'test'})});
 assert.equal(result.status,200);cookie=result.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await new Promise(done=>app.close(done));db.close();rmSync(root,{recursive:true,force:true})});
async function api(path,method='GET',body,expected=200){
 const r=await fetch(base+'/api'+path,{method,headers:{cookie,'content-type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(data));return data;
}
const voucher=(number,amount,extra={})=>({
 settlement_no:number,amount_yuan:String(amount),entry_kind:'payment',
 settlement_type:'progress',occurred_on:'2026-10-30',evidence:'检修计划结算凭证',...extra
});
test('W5: two plans, separately attributed vouchers, unallocated advance, reversals and funding reconciliation',async()=>{
 assert.equal(one('PRAGMA user_version').user_version,107);
 const vl=await api('/voltage-levels','POST',{code:'PLAN110',name:'110kV'},201);
 const l=await api('/lines','POST',{line_code:'PLAN-L',name:'检修试验线路',voltage_level_id:vl.id},201);
 const t=await api('/physical-towers','POST',{tower_code:'PLAN-T'},201);
 const tower=await api('/logical-towers','POST',{logical_code:'PLAN-LT',line_id:l.id,physical_tower_id:t.id,tower_no:'#1',sort_rank:1},201);
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'PLAN-UNIT',name:'套'},201);
 const op=await api('/dictionary-items','POST',{type_id:'operation',code:'PLAN-OP',name:'更换防鸟装置',work_target_type:'line'},201);
 const src=await api('/dictionary-items','POST',{type_id:'source',code:'PLAN-SRC',name:'巡视'},201);
 const cat=await api('/dictionary-items','POST',{type_id:'project_category',code:'PLAN-CAT',name:'检修'},201);
 const batch=await api('/demand-batches/submit','POST',{
  idempotency_key:'plan-finance-10',work_target_type:'line',operation_id:op.id,unit_id:unit.id,
  target_object:'防鸟装置',quantity:'10',completion_standard:'验收合格',problem_description:'更换10套',
  source:{type_id:src.id,proposed_by:'检修班',discovered_on:'2026-10-29'},rows:[{logical_tower_id:tower.id}]
 },201);
 let d=await api('/demands/'+batch.ids[0]);
 d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'核实'});
 const fw=await api('/frameworks','POST',{code:'PLAN-FW',name:'年度框架',fiscal_year:2026,limit_yuan:'2000'},201);
 const ag=await api('/agreements','POST',{code:'PLAN-AG',name:'执行协议',framework_id:fw.id,limit_yuan:'1500'},201);
 let project=await api('/projects','POST',{code:'PLAN-PROJ',name:'同一需求分两个检修计划',framework_id:fw.id},201);
 project=await api('/projects/'+project.id+'/scopes','POST',{version:project.version,demand_id:d.id,quantity:'10'},201);
 project=await api('/projects/'+project.id+'/preliminary-estimate','POST',{
  version:project.version,category_id:cat.id,amount_yuan:'1000',basis:'十套测算'},200);
 project=await api('/projects/'+project.id+'/stock','POST',{version:project.version,reason:'正式储备'});
 project=await api('/projects/'+project.id+'/agreement','POST',{version:project.version,agreement_id:ag.id});
 project=await api('/projects/'+project.id+'/scopes/'+project.scopes[0].id,'PATCH',{
  version:project.version,unit_price_yuan:'100',price_source:'核准价',price_date:'2026-10-30',tax_mode:'inclusive'});
 project=await api('/projects/'+project.id+'/approve','POST',{version:project.version,reason:'批准'});
 const scope=project.scopes[0];
 let a=await api('/projects/'+project.id+'/executions','POST',{number:'A',plan_type:'outage'},201);
 let b=await api('/projects/'+project.id+'/executions','POST',{number:'B',plan_type:'non_outage'},201);
 a=await api('/executions/'+a.id+'/items','POST',{version:a.version,scope_id:scope.id,quantity:'5'},201);
 b=await api('/executions/'+b.id+'/items','POST',{version:b.version,scope_id:scope.id,quantity:'5'},201);
 const ai=a.items[0].id,bi=b.items[0].id;
 const unallocated=await api('/projects/'+project.id+'/settlements','POST',{
  ...voucher('UNALLOC-ADV',50,{settlement_type:'advance'}),scope_id:scope.id
 },201);
 assert.equal(unallocated.execution_item_id,null);
 const pa=await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('PLAN-A-PROG',250),execution_item_id:ai
 },201);
 const pb=await api('/executions/'+b.id+'/settlements','POST',{
  ...voucher('PLAN-B-PROG',100),execution_item_id:bi
 },201);
 assert.equal(pa.execution_item_id,ai);
 assert.equal(pb.execution_item_id,bi);
 await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('WRONG-ITEM',1),execution_item_id:bi
 },422);
 await api('/executions/'+b.id+'/settlements','POST',{
  ...voucher('WRONG-REVERSE',20,{entry_kind:'reversal',reversal_of:pa.id}),execution_item_id:bi
 },409);
 await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('WRONG-UNALLOC-REVERSE',20,{entry_kind:'reversal',reversal_of:unallocated.id}),execution_item_id:ai
 },409);
 const reverse=await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('PLAN-A-REV',50,{entry_kind:'reversal',reversal_of:pa.id}),execution_item_id:ai
 },201);
 assert.equal(reverse.reversal_of,pa.id);
 await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('PLAN-A-TOO-MUCH',250,{entry_kind:'reversal',reversal_of:pa.id}),execution_item_id:ai
 },409);
 const aSummary=await api('/executions/'+a.id+'/settlements');
 const bSummary=await api('/executions/'+b.id+'/settlements');
 assert.equal(aSummary.planned_estimate_fen,50000);
 assert.equal(aSummary.settled_fen,20000);
 assert.equal(bSummary.planned_estimate_fen,50000);
 assert.equal(bSummary.settled_fen,10000);
 assert.equal(aSummary.items[0].project_scope_id,scope.id);
 assert.equal(aSummary.entries.length,2);
 // Final settlement cannot be inferred from a different completed plan.
 await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('PLAN-A-EARLY-FINAL',100,{settlement_type:'final'}),execution_item_id:ai
 },409);
 a=await api('/executions/'+a.id+'/start','POST',{version:a.version,reason:'停电开工'});
 a=await api('/executions/'+a.id+'/items/'+ai+'/complete','POST',{
  idempotency_key:'plan-finance-completed-3',quantity:'3',occurred_on:'2026-10-30',evidence:'实际完成3套'},201);
 a=await api('/executions/'+a.id+'/finish','POST',{version:a.version,reason:'计划结束，余量释放'});
 const final=await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('PLAN-A-FINAL',100,{settlement_type:'final'}),execution_item_id:ai
 },201);
 assert.equal(final.execution_item_id,ai);
 const pSummary=await api('/projects/'+project.id+'/settlement-summary');
 assert.equal(pSummary.settled_fen,45000);
 assert.equal(pSummary.allocated_fen,40000);
 assert.equal(pSummary.unallocated_fen,5000);
 assert.equal(pSummary.plans.reduce((x,y)=>x+y.settled_fen,0),40000);
 const aFunding=await api('/agreements/'+ag.id+'/settlement-summary');
 const fFunding=await api('/frameworks/'+fw.id+'/settlement-summary');
 assert.equal(aFunding.settled_fen,45000);
 assert.equal(fFunding.settled_fen,45000);
 assert.equal(fFunding.unallocated_fen,5000);
 assert.equal(fFunding.agreements[0].settled_fen,45000);
 assert.equal((await api('/projects/'+project.id+'/settlements')).length,5);
 // Cancellation does not erase historical financial facts. Only compensating
 // reversals are allowed after cancellation, not new positive vouchers.
 b=await api('/executions/'+b.id+'/cancel','POST',{version:b.version,reason:'计划取消，需要冲销已登记凭证'});
 await api('/executions/'+b.id+'/settlements','POST',{
  ...voucher('PLAN-B-CANCELLED-PAY',1),execution_item_id:bi
 },409);
 const reverseCancelled=await api('/executions/'+b.id+'/settlements','POST',{
  ...voucher('PLAN-B-CANCELLED-REV',100,{entry_kind:'reversal',reversal_of:pb.id}),execution_item_id:bi
 },201);
 assert.equal(reverseCancelled.reversal_of,pb.id);
 assert.equal((await api('/executions/'+b.id+'/settlements')).settled_fen,0);
 assert.equal((await api('/projects/'+project.id+'/settlement-summary')).settled_fen,35000);
 assert.throws(()=>db.prepare('DELETE FROM project_settlement_entries WHERE id=?').run(final.id),/不可删除/);
 assert.throws(()=>db.prepare('UPDATE project_settlement_entries SET amount_fen=1 WHERE id=?').run(final.id),/不可修改/);
 // Read-only historical scope/project state must not make corrections impossible.
 // Simulate an approved closeout and retirement, then reverse the old receipt.
 db.prepare("UPDATE project_demand_scopes SET status='retired' WHERE id=?").run(scope.id);
 db.prepare("UPDATE projects SET status='closed' WHERE id=?").run(project.id);
 await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('CLOSED-POSITIVE',1),execution_item_id:ai
 },409);
 const closedReversal=await api('/executions/'+a.id+'/settlements','POST',{
  ...voucher('CLOSED-HISTORY-REVERSE',100,{entry_kind:'reversal',reversal_of:final.id}),execution_item_id:ai
 },201);
 assert.equal(closedReversal.approval_version_id,final.approval_version_id);
 assert.equal((await api('/projects/'+project.id+'/settlement-summary')).settled_fen,25000);

});
