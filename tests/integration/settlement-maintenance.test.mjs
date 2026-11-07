import {financeFixture} from '../helpers/finance-fixture.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const root=mkdtempSync(join(tmpdir(),'sd-settlement-maintenance-'));
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
const voucher=(number,amount,extra={})=>({
 settlement_no:number,amount_yuan:String(amount),entry_kind:'payment',
 settlement_type:'progress',occurred_on:'2026-10-30',evidence:'检修计划结算凭证',...extra
});
let count=0;
async function fixture(){return financeFixture(api,"R01-"+(++count))}

const post=async(f,suffix,amount,extra={})=>api('/executions/'+f.a.id+'/settlements','POST',{
 ...voucher(f.tag+suffix,amount),execution_item_id:f.ai,...extra},201);
const correction=(entry,extra={})=>({version:entry.version||1,request_key:entry.id+'-'+Math.random(),reason:'核对原始业务凭证后更正',
 settlement_no:entry.settlement_no,settlement_type:entry.settlement_type,
 amount_yuan:String(entry.amount_fen/100),occurred_on:entry.occurred_on,evidence:entry.evidence,...extra});
const revoke=async(entry,extra={},expected=200)=>{
 const preview=await api('/settlements/'+entry.id+'/void-preview');
 return api('/settlements/'+entry.id,'DELETE',{version:entry.version||1,request_key:entry.id+'-void-'+Math.random(),reason:'凭证作废依据',preview_token:preview.preview_token,affected_ids:preview.affected.map(e=>e.id),...extra},expected);
};
async function reconcile(f,allocated,unallocated=0){
 const p=await api('/projects/'+f.project.id+'/settlement-summary');
 assert.equal(p.allocated_fen,allocated);assert.equal(p.unallocated_fen,unallocated);assert.equal(p.settled_fen,allocated+unallocated);
 assert.equal((await api('/projects/'+f.project.id+'/progress')).settled_fen,p.settled_fen);
 assert.equal((await api('/agreements/'+f.ag.id+'/settlement-summary')).settled_fen,p.settled_fen);
 assert.equal((await api('/frameworks/'+f.fw.id+'/settlement-summary')).settled_fen,p.settled_fen);
 assert.equal((await api('/agreements/'+f.ag.id)).settled_fen,p.settled_fen);
}
test('R01 corrections retain original facts, scope/approval attribution and all four funding rollups',async()=>{
 const f=await fixture(),payment=await post(f,'PAY',100);
 await post(f,'REV',40,{entry_kind:'reversal',reversal_of:payment.id});
 await api('/executions/'+f.b.id+'/settlements','POST',{...voucher(f.tag+'B',100),execution_item_id:f.bi},201);
 await api('/projects/'+f.project.id+'/settlements','POST',{...voucher(f.tag+'UNALLOC',50),scope_id:f.scope.id},201);
 await reconcile(f,16000,5000);
 const result=await api('/settlements/'+payment.id,'PATCH',correction(payment,{amount_yuan:'150',evidence:'复核金额150元'}));
 assert.equal(result.entry.version,2);assert.equal(result.entry.amount_fen,15000);
 assert.equal(result.entry.approval_version_id,payment.approval_version_id);
 assert.equal(result.entry.execution_item_id,payment.execution_item_id);
 assert.equal(result.original.amount_fen,10000);assert.equal(result.versions[1].reason,'核对原始业务凭证后更正');
 assert.equal(result.related.length,2);
 await reconcile(f,21000,5000);
 assert.equal((await api('/executions/'+f.a.id+'/settlements')).settled_fen,11000);
 assert.equal(one('SELECT amount_fen FROM project_settlement_entries WHERE id=?',payment.id).amount_fen,10000);
 assert.throws(()=>db.prepare('UPDATE settlement_revisions SET amount_fen=1 WHERE entry_id=?').run(payment.id),/不可修改/);
 assert.throws(()=>db.prepare('DELETE FROM settlement_commands WHERE target_id=?').run(payment.id),/不可删除/);
});
test('R01 reversal correction, version conflicts, concurrent updates and idempotent retries',async()=>{
 const f=await fixture(),p=await post(f,'PAY',100),r=await post(f,'REV',40,{entry_kind:'reversal',reversal_of:p.id});
 const body=correction(r,{amount_yuan:'50',request_key:f.tag+'retry'});
 const first=await api('/settlements/'+r.id,'PATCH',body),retry=await api('/settlements/'+r.id,'PATCH',{...body});
 assert.deepEqual(first,retry);assert.equal(first.entry.version,2);
 await api('/settlements/'+r.id,'PATCH',{...body,amount_yuan:'60'},409);
 await api('/settlements/'+r.id,'PATCH',correction(r,{amount_yuan:'60'}),409);
 await api('/settlements/'+r.id,'PATCH',correction(first.entry,{amount_yuan:'101'}),409);
 await api('/settlements/'+p.id,'PATCH',correction(p,{amount_yuan:'49'}),409);
 const responses=await Promise.all(['110','120'].map(amount=>fetch(base+'/api/settlements/'+p.id,{method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(correction(p,{amount_yuan:amount}))})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal(one('SELECT COUNT(*) n FROM settlement_revisions WHERE entry_id=?',p.id).n,1);
 const net=(await api('/settlements/'+p.id)).entry.amount_fen-5000;
 await reconcile(f,net);
});
test('R01 correction validation protects real dates, official number history, ownership and final-settlement evidence',async()=>{
 const f=await fixture(),p=await post(f,'PAY',100),second=await post(f,'OTHER',50);
 for(const extra of [{amount_yuan:'0'},{amount_yuan:'-1'},{amount_yuan:'1.001'},{occurred_on:'2026-02-30'},{reason:''},{scope_id:f.scope.id}])
  await api('/settlements/'+p.id,'PATCH',correction(p,extra),422);
 await api('/settlements/'+p.id,'PATCH',correction(p,{settlement_no:second.settlement_no}),409);
 await api('/settlements/'+p.id,'PATCH',correction(p,{settlement_type:'final'}),409);
 await api('/settlements/'+p.id,'PATCH',correction(p,{amount_yuan:'999.99'}),409);
 const revised=await api('/settlements/'+p.id,'PATCH',correction(p,{settlement_no:f.tag+'NEW'}));
 await api('/executions/'+f.a.id+'/settlements','POST',{...voucher(f.tag+'BADDATE',10,{occurred_on:'2026-02-30'}),execution_item_id:f.ai},422);
 await api('/settlements/'+second.id,'PATCH',correction(second,{settlement_no:p.settlement_no}),409);
 assert.equal(revised.original.settlement_no,p.settlement_no);await reconcile(f,15000);
});
test('R01 revoke preview detects new/changed reversals; explicit family revocation is atomic, traceable and repeat-safe',async()=>{
 const f=await fixture(),p=await post(f,'PAY',100),r=await post(f,'REV',40,{entry_kind:'reversal',reversal_of:p.id});
 const stale=await api('/settlements/'+p.id+'/void-preview');
 await api('/settlements/'+r.id,'PATCH',correction(r,{amount_yuan:'50'}));
 await api('/settlements/'+p.id,'DELETE',{version:1,request_key:f.tag+'stale',reason:'撤销',preview_token:stale.preview_token},409);
 const preview=await api('/settlements/'+p.id+'/void-preview');
 assert.equal(preview.affected.length,2);assert.equal(preview.net_change_fen,-5000);
 const body={version:1,request_key:f.tag+'void',reason:'确认撤销原凭证及其关联冲销',preview_token:preview.preview_token,affected_ids:preview.affected.map(e=>e.id)};
 await api('/settlements/'+p.id,'DELETE',{...body,affected_ids:[p.id]},422);
 assert.equal(one('SELECT COUNT(*) n FROM settlement_revisions WHERE entry_id=?',p.id).n,0);
 const result=await api('/settlements/'+p.id,'DELETE',body);
 assert.equal(result.affected_ids.length,2);assert.equal(result.entry.status,'voided');
 assert.deepEqual(await api('/settlements/'+p.id,'DELETE',body),result);
 await reconcile(f,0);
 assert.equal((await api('/projects/'+f.project.id+'/settlements')).length,0);
 assert.equal((await api('/projects/'+f.project.id+'/settlements?status=voided')).length,2);
 assert.equal((await api('/projects/'+f.project.id+'/settlements?status=all&q='+p.settlement_no)).length,1);
 assert.equal((await api('/settlements/'+r.id)).versions.length,3);
 assert.equal(one('SELECT COUNT(*) n FROM project_settlement_entries WHERE project_id=?',f.project.id).n,2);
 await api('/settlements/'+p.id,'PATCH',correction(p),409);
 await api('/executions/'+f.a.id+'/settlements','POST',{...voucher(f.tag+'BADREV',1,{entry_kind:'reversal',reversal_of:p.id}),execution_item_id:f.ai},422);
 await api('/executions/'+f.a.id+'/settlements','POST',{...voucher(p.settlement_no,1),execution_item_id:f.ai},409);
});
test('R01 actual budget change uses corrected net; voiding a reversal cannot exceed revised approved budget',async()=>{
 const f=await fixture(),p=await post(f,'PAY',100),r=await post(f,'REV',40,{entry_kind:'reversal',reversal_of:p.id});
 let a=await api('/executions/'+f.a.id),b=await api('/executions/'+f.b.id);
 await api('/executions/'+a.id+'/cancel','POST',{version:a.version,reason:'调整预算前结束计划'});
 await api('/executions/'+b.id+'/cancel','POST',{version:b.version,reason:'调整预算前结束计划'});
 const order=await api('/projects/'+f.project.id+'/change-orders','POST',{base_approval_version_id:p.approval_version_id,
  reason:'核定预算调减',changes:[{action:'adjust',scope_id:f.scope.id,quantity:'10',unit_price_yuan:'7',evidence:'批准每套7元'}]},201);
 await api('/change-orders/'+order.id+'/submit','POST',{reason:'提交'});
 await api('/change-orders/'+order.id+'/approve','POST',{reason:'批准预算70元'});
 await revoke(r,{},409);await reconcile(f,6000);
 const detail=await api('/settlements/'+p.id,'PATCH',correction(p,{amount_yuan:'90'}));
 assert.equal(detail.entry.approval_version_id,p.approval_version_id);await reconcile(f,5000);
 await api('/settlements/'+p.id,'PATCH',correction(detail.entry,{amount_yuan:'120'}),409);
});
test('R01 closed projects preserve history and permit documented reductions without new financial commitments',async()=>{
 const f=await fixture(),p=await post(f,'PAY',100),r=await post(f,'REV',40,{entry_kind:'reversal',reversal_of:p.id});
 db.prepare("UPDATE projects SET status='closed' WHERE id=?").run(f.project.id);
 const revised=await api('/settlements/'+p.id,'PATCH',correction(p,{evidence:'结项后资料补正'}));
 await api('/settlements/'+p.id,'PATCH',correction(revised.entry,{amount_yuan:'110'}),409);
 await revoke(r,{},409);
 const smaller=await api('/settlements/'+p.id,'PATCH',correction(revised.entry,{amount_yuan:'80'}));
 await reconcile(f,4000);
 await revoke(smaller.entry);await reconcile(f,0);
 assert.equal((await api('/settlements/'+p.id)).original.amount_fen,10000);
});
test('R01 server permissions and reopened database retain effective balances and immutable history',async()=>{
 const f=await fixture(),p=await post(f,'PAY',100);
 for(const role of ['viewer','editor']){
  const id=f.tag+role,session=f.tag+'session'+role;
  db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',new Date().toISOString());
  const {createHash}=await import('node:crypto');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(session).digest('hex'),id,'2099-01-01T00:00:00.000Z',new Date().toISOString());
  const as='sd_session='+session;
  await api('/settlements/'+p.id,'GET',undefined,200,as);
  await api('/settlements/'+p.id,'PATCH',correction(p),403,as);
  await api('/settlements/'+p.id,'DELETE',{},403,as);
 }
 await api('/settlements/'+p.id,'PATCH',correction(p,{amount_yuan:'80'}));
 const code=`import {db,one} from './server/database/index.mjs'; console.log(JSON.stringify({net:one("SELECT SUM(amount_fen) n FROM effective_settlement_entries WHERE project_id=?",process.argv[1]).n,raw:one("SELECT SUM(amount_fen) n FROM project_settlement_entries WHERE project_id=?",process.argv[1]).n,integrity:one('PRAGMA integrity_check').integrity_check})); db.close();`;
 const data=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,f.project.id],{env:{...process.env,DATA_DIR:root},encoding:'utf8'}));
 assert.deepEqual(data,{net:8000,raw:10000,integrity:'ok'});
 assert.equal((await api('/projects/'+f.project.id+'/settlements?execution_id='+f.b.id)).length,0);
 assert.equal(all('PRAGMA foreign_key_check').length,0);
});
test('R01 partial implementation, plan remainder release and new approval never rewrite voucher/completion history',async()=>{
 const f=await fixture(),p=await post(f,'ADV',100,{settlement_type:'advance'});
 let a=await api('/executions/'+f.a.id+'/start','POST',{version:f.a.version,reason:'按计划实施'});
 a=await api('/executions/'+a.id+'/items/'+f.ai+'/complete','POST',{idempotency_key:f.tag+'done',quantity:'2',occurred_on:'2026-10-30',evidence:'本批完成两套'},201);
 a=await api('/executions/'+a.id+'/finish','POST',{version:a.version,reason:'本次完成两套，释放余量'});
 const other=await api('/executions/'+f.b.id+'/settlements','POST',{...voucher(f.tag+'B-PAY',50),execution_item_id:f.bi},201);
 await api('/settlements/'+other.id,'PATCH',correction(other,{settlement_type:'final'}),409);
 const final=await api('/settlements/'+p.id,'PATCH',correction(p,{settlement_type:'final',amount_yuan:'200'}));
 let c=await api('/projects/'+f.project.id+'/executions','POST',{plan_type:'non_outage'},201);
 c=await api('/executions/'+c.id+'/items','POST',{version:c.version,scope_id:f.scope.id,quantity:'3'},201);
 await api('/executions/'+c.id+'/cancel','POST',{version:c.version,reason:'重新核定计划'});
 await api('/executions/'+f.b.id+'/cancel','POST',{version:f.b.version,reason:'重新核定计划'});
 const change=await api('/projects/'+f.project.id+'/change-orders','POST',{base_approval_version_id:p.approval_version_id,reason:'核定新范围单价',changes:[{action:'adjust',scope_id:f.scope.id,quantity:'9',unit_price_yuan:'80',evidence:'复核九套80元'}]},201);
 await api('/change-orders/'+change.id+'/submit','POST',{reason:'提审'});
 await api('/change-orders/'+change.id+'/approve','POST',{reason:'批准720元'});
 const amended=await api('/settlements/'+p.id,'PATCH',correction(final.entry,{amount_yuan:'250'}));
 assert.equal(amended.entry.approval_version_id,p.approval_version_id);
 assert.notEqual((await api('/projects/'+f.project.id+'/approval-versions'))[0].id,p.approval_version_id);
 await reconcile(f,30000);
 await revoke(amended.entry);await revoke(other);await reconcile(f,0);
 const progress=await api('/projects/'+f.project.id+'/progress');
 assert.equal(progress.scopes[0].completed_quantity_scaled,20000);
 assert.equal(progress.scopes[0].dual_status,'implemented_unsettled');
 assert.equal(one('SELECT COUNT(*) n FROM completion_records WHERE execution_item_id=?',f.ai).n,1);
});
