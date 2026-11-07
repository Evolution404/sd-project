import {financeFixture} from '../helpers/finance-fixture.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const root=mkdtempSync(join(tmpdir(),'sd-completion-maintenance-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one,all}=await import('../../server/database/index.mjs');
const {app}=await import('../../server/main.mjs');
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
async function api(path,method='GET',body,expected=200,asCookie=cookie){
 const r=await fetch(base+'/api'+path,{method,headers:{cookie:asCookie,'content-type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(data));return data;
}
let count=0;
const fixture=()=>financeFixture(api,'COMPLETE-'+(++count));
async function start(f,plan=f.a){return api('/executions/'+plan.id+'/start','POST',{version:plan.version,reason:'正式实施'})}
async function complete(f,q,key=f.tag+'done',plan=f.a,item=f.ai){
 const body={idempotency_key:key,quantity:String(q),occurred_on:'2026-10-30',evidence:'实施验收'+key};
 await api('/executions/'+plan.id+'/items/'+item+'/complete','POST',body,201);
 const records=await api('/executions/'+plan.id+'/completion-records');
 return {...records.find(r=>r.evidence===body.evidence),body};
}
async function finish(plan){const e=await api('/executions/'+plan.id);return api('/executions/'+plan.id+'/finish','POST',{version:e.version,reason:'本计划结束并释放未完成量'})}
const correction=(r,extra={})=>({version:r.version,request_key:r.id+'-'+Math.random(),quantity:String(r.quantity_scaled/10000),occurred_on:r.occurred_on,evidence:r.evidence,reason:'核对实施验收资料后更正',...extra});
async function revoke(r,extra={},expected=200){const p=await api('/completion-records/'+r.id+'/void-preview');return api('/completion-records/'+r.id,'DELETE',{version:r.version,request_key:r.id+'-void-'+Math.random(),preview_token:p.preview_token,reason:'撤销错误验收事实',...extra},expected)}
async function postFinal(f,item=f.ai,plan=f.a){return api('/executions/'+plan.id+'/settlements','POST',{execution_item_id:item,settlement_no:f.tag+'FINAL-'+item,entry_kind:'payment',settlement_type:'final',amount_yuan:'100',occurred_on:'2026-10-30',evidence:'终结结算原始依据'},201)}
test('R02 corrections preserve original work evidence and update all projections; running reservation remains intact',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,3);
 const result=await api('/completion-records/'+r.id,'PATCH',correction(r,{quantity:'1.5001',evidence:'复核确认1.5001套'}));
 assert.equal(result.original.quantity_scaled,30000);assert.equal(result.entry.quantity_scaled,15001);assert.equal(result.entry.version,2);
 assert.equal((await api('/executions/'+f.a.id)).items[0].completed_quantity_scaled,15001);
 assert.equal((await api('/projects/'+f.project.id+'/progress')).scopes[0].completed_quantity_scaled,15001);
 assert.equal((await api('/executions/'+f.a.id+'/settlements')).items[0].completed_quantity_scaled,15001);
 assert.equal((await api('/projects/'+f.project.id+'/executions')).find(x=>x.id===f.a.id).completed_quantity_scaled,15001);
 let c=await api('/projects/'+f.project.id+'/executions','POST',{plan_type:'outage'},201);
 await api('/executions/'+c.id+'/items','POST',{version:c.version,scope_id:f.scope.id,quantity:'1'},409);
 await finish(f.a);
 c=await api('/executions/'+c.id+'/items','POST',{version:c.version,scope_id:f.scope.id,quantity:'3.4999'},201);
 assert.equal(c.items[0].planned_quantity_scaled,34999);
 const event=one("SELECT * FROM audit_events WHERE entity='completion_records' AND entity_id=? AND action='correct'",r.id);
 assert.equal(JSON.parse(event.before_json).quantity_scaled,30000);assert.equal(JSON.parse(event.after_json).quantity_scaled,15001);
});
test('R02 finished-plan corrections respect reallocated scope, void releases only actual committed quantity',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,3);await finish(f.a);
 const stale=await api('/completion-records/'+r.id+'/void-preview');
 let c=await api('/projects/'+f.project.id+'/executions','POST',{plan_type:'non_outage'},201);
 c=await api('/executions/'+c.id+'/items','POST',{version:c.version,scope_id:f.scope.id,quantity:'2'},201);
 await api('/completion-records/'+r.id,'DELETE',{version:r.version,request_key:r.id+'stale',reason:'撤销',preview_token:stale.preview_token},409);
 await api('/completion-records/'+r.id,'PATCH',correction(r,{quantity:'4'}),409);
 const smaller=await api('/completion-records/'+r.id,'PATCH',correction(r,{quantity:'2'}));
 const preview=await api('/completion-records/'+r.id+'/void-preview');
 assert.equal(preview.released_quantity_scaled,20000);assert.equal(preview.scope_committed_before_scaled,90000);assert.equal(preview.scope_committed_after_scaled,70000);
 await revoke(smaller.entry);
 assert.equal((await api('/executions/'+f.a.id)).items[0].completed_quantity_scaled,0);
 const d=await api('/projects/'+f.project.id+'/executions','POST',{plan_type:'outage'},201);
 await api('/executions/'+d.id+'/items','POST',{version:d.version,scope_id:f.scope.id,quantity:'3'},201);
 assert.equal((await api('/projects/'+f.project.id+'/progress')).scopes[0].dual_status,'unimplemented_unsettled');
 assert.equal((await api('/executions/'+f.a.id+'/completion-records')).length,0);
 assert.equal((await api('/executions/'+f.a.id+'/completion-records?status=voided')).length,1);
 // Original confirmation replay must not restore a revised or voided record.
 await api('/executions/'+f.a.id+'/items/'+f.ai+'/complete','POST',r.body,201);
 assert.equal((await api('/executions/'+f.a.id)).items[0].completed_quantity_scaled,0);
 assert.equal(one('SELECT quantity_scaled FROM completion_records WHERE id=?',r.id).quantity_scaled,30000);
});
test('R02 final settlements retain completion basis; fully reversed final vouchers cannot be restored without basis',async()=>{
 const f=await fixture();await start(f);const a=await complete(f,1,f.tag+'a'),b=await complete(f,2,f.tag+'b');await finish(f.a);
 const p=await postFinal(f);await revoke(a);
 const impact=await api('/completion-records/'+b.id+'/void-preview');assert.equal(impact.blocking_settlements[0].id,p.id);
 await revoke(b,{},409);assert.equal((await api('/executions/'+f.a.id)).items[0].completed_quantity_scaled,20000);
 const reverse=await api('/executions/'+f.a.id+'/settlements','POST',{execution_item_id:f.ai,settlement_no:f.tag+'REV',entry_kind:'reversal',reversal_of:p.id,amount_yuan:'100',occurred_on:'2026-10-30',evidence:'终结凭证全部冲销'},201);
 await revoke(b);assert.equal((await api('/projects/'+f.project.id+'/settlement-summary')).settled_fen,0);
 const sp=await api('/settlements/'+reverse.id+'/void-preview');
 await api('/settlements/'+reverse.id,'DELETE',{version:1,request_key:reverse.id+'restore',reason:'不可恢复无完成依据的终结结算',preview_token:sp.preview_token,affected_ids:[reverse.id]},409);
 await api('/settlements/'+reverse.id,'PATCH',{version:1,request_key:reverse.id+'correct',reason:'减少冲销会恢复终结净额',settlement_no:reverse.settlement_no,settlement_type:null,amount_yuan:'50',occurred_on:reverse.occurred_on,evidence:reverse.evidence},409);
 await api('/executions/'+f.a.id+'/settlements','POST',{execution_item_id:f.ai,settlement_no:f.tag+'NEWFINAL',entry_kind:'payment',settlement_type:'final',amount_yuan:'1',occurred_on:'2026-10-30',evidence:'缺少有效完成记录'},409);
 assert.equal((await api('/settlements/'+p.id)).original.amount_fen,10000);
});
test('R02 unallocated finals may use scope basis; plan-bound finals cannot borrow another plan completion',async()=>{
 const f=await fixture();await start(f);const a=await complete(f,2);await finish(f.a);
 await start(f,f.b);const b=await complete(f,1,f.tag+'B',f.b,f.bi);await finish(f.b);
 const final=await postFinal(f);
 await api('/projects/'+f.project.id+'/settlements','POST',{scope_id:f.scope.id,settlement_no:f.tag+'UNALLOC-FINAL',entry_kind:'payment',settlement_type:'final',amount_yuan:'50',occurred_on:'2026-10-30',evidence:'项目未归集终结结算'},201);
 await revoke(a,{},409);
 assert.equal((await api('/completion-records/'+a.id+'/void-preview')).blocking_settlements[0].id,final.id);
 await revoke(b); // Project-level final still has A; no plan-bound final refers to B.
});
test('R02 validation, optimistic locks, concurrent edits, idempotent retry and immutable history',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,2);
 for(const body of [{quantity:'0'},{quantity:'-1'},{quantity:'1.00001'},{occurred_on:'2026-02-30'},{reason:''},{execution_item_id:f.bi}])
  await api('/completion-records/'+r.id,'PATCH',correction(r,body),422);
 await api('/completion-records/'+r.id,'PATCH',correction(r,{quantity:'6'}),409);
 const body=correction(r,{quantity:'1',request_key:r.id+'retry'});
 const first=await api('/completion-records/'+r.id,'PATCH',body);assert.deepEqual(await api('/completion-records/'+r.id,'PATCH',body),first);
 await api('/completion-records/'+r.id,'PATCH',{...body,quantity:'1.5'},409);
 await api('/completion-records/'+r.id,'PATCH',correction(r),409);
 const outcomes=await Promise.all(['1.1','1.2'].map(q=>fetch(base+'/api/completion-records/'+r.id,{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(correction(first.entry,{quantity:q}))})));
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 assert.equal(one('SELECT COUNT(*) n FROM completion_revisions WHERE record_id=?',r.id).n,2);
 assert.throws(()=>db.prepare('UPDATE completion_records SET quantity_scaled=1 WHERE id=?').run(r.id),/不可覆盖/);
 assert.throws(()=>db.prepare('DELETE FROM completion_revisions WHERE record_id=?').run(r.id),/不可清除/);
});
test('R02 current approved quantity and historical plan snapshot both constrain late corrections',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,3);await finish(f.a);
 await api('/executions/'+f.b.id+'/cancel','POST',{version:f.b.version,reason:'取消待实施计划'});
 const draft=await api('/projects/'+f.project.id+'/change-orders','POST',{base_approval_version_id:f.a.approval_version_id,reason:'调减当前范围至2套',changes:[{action:'adjust',scope_id:f.scope.id,quantity:'2',unit_price_yuan:'100',evidence:'重新核定剩余范围'}]},201);
 await api('/change-orders/'+draft.id+'/submit','POST',{reason:'提交'});
 await api('/change-orders/'+draft.id+'/approve','POST',{reason:'尚有完成3套，不能降低至2套'},409);
 const corrected=await api('/completion-records/'+r.id,'PATCH',correction(r,{quantity:'1.5'}));
 await api('/change-orders/'+draft.id+'/approve','POST',{reason:'更正实际完成量后批准'});
 await api('/completion-records/'+r.id,'PATCH',correction(corrected.entry,{quantity:'3'}),409);
 const metadata=await api('/completion-records/'+r.id,'PATCH',correction(corrected.entry,{evidence:'补充验收资料'}));
 assert.equal(metadata.entry.approval_version_id,f.a.approval_version_id);
 assert.equal(metadata.original.quantity_scaled,30000);
});
test('R02 concurrent late correction and new plan allocation never overcommit approved quantity',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,3);await finish(f.a);
 const c=await api('/projects/'+f.project.id+'/executions','POST',{plan_type:'outage'},201);
 const results=await Promise.all([
  fetch(base+'/api/completion-records/'+r.id,{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(correction(r,{quantity:'4'}))}),
  fetch(base+'/api/executions/'+c.id+'/items',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({version:c.version,scope_id:f.scope.id,quantity:'2'})})
 ]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const {scopeCompletionUsage}=await import('../../server/application/completion-rules.mjs');assert.ok(scopeCompletionUsage(f.scope.id)<=100000);
});
test('R02 permissions, logical deletion, request replay and reopened database preserve original facts',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,2);
 const {createHash}=await import('node:crypto');
 for(const role of ['viewer','editor']){
  const id=f.tag+role,token=id+'token';db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00.000Z',new Date().toISOString());
  const as='sd_session='+token;
  await api('/completion-records/'+r.id,'GET',undefined,200,as);
  if(role==='viewer'){
   await api('/completion-records/'+r.id,'PATCH',correction(r),403,as);await api('/completion-records/'+r.id,'DELETE',{},403,as);
  }else await api('/completion-records/'+r.id,'PATCH',correction(r,{quantity:'1'}),200,as);
 }
 const latest=(await api('/completion-records/'+r.id)).entry;
 const preview=await api('/completion-records/'+r.id+'/void-preview'),body={version:latest.version,request_key:r.id+'void',reason:'核对后撤销',preview_token:preview.preview_token};
 const result=await api('/completion-records/'+r.id,'DELETE',body);assert.deepEqual(await api('/completion-records/'+r.id,'DELETE',body),result);
 const code=`import {db,one,all} from './server/database/index.mjs';console.log(JSON.stringify({raw:one('SELECT quantity_scaled FROM completion_records WHERE id=?',process.argv[1]).quantity_scaled,status:one('SELECT status FROM completion_current WHERE id=?',process.argv[1]).status,active:one('SELECT COUNT(*) n FROM effective_completion_records WHERE id=?',process.argv[1]).n,foreignKeys:all('PRAGMA foreign_key_check').length,integrity:one('PRAGMA integrity_check').integrity_check}));db.close();`;
 const data=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,r.id],{env:{...process.env,DATA_DIR:root},encoding:'utf8'}));
 assert.deepEqual(data,{raw:20000,status:'voided',active:0,foreignKeys:0,integrity:'ok'});
});
test('R02 concurrent final settlement and last completion withdrawal cannot commit an unsupported terminal voucher',async()=>{
 const f=await fixture();await start(f);const r=await complete(f,2);await finish(f.a);
 const preview=await api('/completion-records/'+r.id+'/void-preview');
 const outcomes=await Promise.all([
  fetch(base+'/api/completion-records/'+r.id,{method:'DELETE',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({version:r.version,request_key:r.id+'race',preview_token:preview.preview_token,reason:'撤销错误完成记录'})}),
  fetch(base+'/api/executions/'+f.a.id+'/settlements',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({execution_item_id:f.ai,settlement_no:f.tag+'RACE-FINAL',entry_kind:'payment',settlement_type:'final',amount_yuan:'100',occurred_on:'2026-10-30',evidence:'真实终结结算依据'})})
 ]);
 assert.ok(outcomes[0].status===200&&outcomes[1].status===409||outcomes[0].status===409&&outcomes[1].status===201);
 const {unsupportedFinalSettlements}=await import('../../server/application/completion-rules.mjs');assert.equal(unsupportedFinalSettlements(f.scope.id).length,0);
});
