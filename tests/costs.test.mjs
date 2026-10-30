import {financeFixture} from './helpers/finance-fixture.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const root=mkdtempSync(join(tmpdir(),'sd-costs-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one,all}=await import('../server/db.mjs');
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
async function api(path,method='GET',body,expected=200,asCookie=cookie){
 const r=await fetch(base+'/api'+path,{method,headers:{cookie:asCookie,'content-type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(data));return data;
}
let count=0;
async function fixture(twoScopes=false){const f=await financeFixture(api,'COST-'+(++count),{twoScopes});const c=await api('/executions/'+f.a.id+'/costs');f.category=c.categories[0];assert.ok(f.category);return f}
const body=(f,amount=300,extra={})=>({base_version:0,category_id:f.category.id,name:'实际施工费',occurred_on:'2026-10-30',amount_yuan:String(amount),evidence:'真实费用凭据',allocations:[{execution_item_id:f.ai,amount_yuan:String(amount)}],...extra});
const prepare=(f,amount=300,extra={})=>api('/executions/'+f.a.id+'/cost-drafts','POST',body(f,amount,extra),201);
const confirm=(d,expected=200,key=d.id+'confirm',as=cookie)=>api('/cost-drafts/'+d.id+'/confirm','POST',{version:d.version,request_key:key},expected,as);
async function cost(f,amount=300,extra={}){return confirm(await prepare(f,amount,extra))}
async function voucher(f,amount=250,extra={}){return api('/executions/'+f.a.id+'/settlements','POST',{execution_item_id:f.ai,settlement_no:f.tag+'S'+Math.random(),entry_kind:'payment',settlement_type:'progress',amount_yuan:String(amount),occurred_on:'2026-10-30',evidence:'实际结算凭据',...extra},201)}
const matchBody=(f,c,s,extra={})=>({request_key:'match'+Math.random(),cost_entry_id:c.entry_id,cost_version:c.version_no,settlement_entry_id:s.id,settlement_version:s.version||1,execution_item_id:f.ai,expense_amount_yuan:String(c.amount_fen/100),settled_amount_yuan:String(s.amount_fen/100),is_final:true,evidence:'费用对应及核减依据',...extra});
const match=(f,c,s,extra={},expected=201)=>api('/executions/'+f.a.id+'/cost-reconciliations','POST',matchBody(f,c,s,extra),expected);
async function revise(f,c,amount){return prepare(f,amount,{entry_id:c.entry_id,base_version:c.version_no,reason:'真实费用更正依据'})}
test('actual cost drafts do not count; confirmed over-budget facts roll up without changing budget or settlement',async()=>{
 const f=await fixture();
 const state=await api('/executions/'+f.a.id+'/budget');const bd=await api('/executions/'+f.a.id+'/budget-drafts','POST',{amount_yuan:'100',basis:'计划预算100元',base_budget_version:0,project_approval_version_id:state.project_approval_version_id},201);
 await api('/plan-budget-drafts/'+bd.id+'/confirm','POST',{version:bd.version,request_key:bd.id});
 const d=await prepare(f,1500);assert.equal((await api('/executions/'+f.a.id+'/costs')).actual_cost_fen,0);
 const c=await confirm(d);assert.deepEqual(await confirm(d),c);
 const totals=await api('/executions/'+f.a.id+'/costs');assert.equal(totals.actual_cost_fen,150000);assert.equal(totals.budget_variance_fen,140000);
 assert.equal(totals.pending_final_expense_fen,150000);
 for(const [kind,id] of [['projects',f.project.id],['agreements',f.ag.id],['frameworks',f.fw.id]]){
  const result=await api('/'+kind+'/'+id+'/settlement-summary');assert.equal(result.actual_cost_fen,150000);assert.equal(result.settled_fen,0);assert.equal(result.approved_budget_fen,100000);
 }
 assert.equal((await api('/frameworks/'+f.fw.id)).actual_cost_fen,150000);
 assert.equal((await api('/executions/'+f.a.id+'/budget')).actual_cost_fen,150000);
});
test('common costs require exact, unique and same-plan manual allocations',async()=>{
 const f=await fixture(true);
 await api('/executions/'+f.a.id+'/cost-drafts','POST',body(f,900,{allocations:[{execution_item_id:f.ai,amount_yuan:'300'},{execution_item_id:f.extraItemId,amount_yuan:'500'}]}),422);
 await api('/executions/'+f.a.id+'/cost-drafts','POST',body(f,900,{allocations:[{execution_item_id:f.ai,amount_yuan:'300'},{execution_item_id:f.ai,amount_yuan:'600'}]}),422);
 await api('/executions/'+f.a.id+'/cost-drafts','POST',body(f,900,{allocations:[{execution_item_id:f.bi,amount_yuan:'900'}]}),422);
 const c=await cost(f,900,{allocations:[{execution_item_id:f.ai,amount_yuan:'300'},{execution_item_id:f.extraItemId,amount_yuan:'600'}]});
 const detail=await api('/costs/'+c.entry_id);assert.equal(detail.allocations.length,2);assert.equal(detail.allocations.reduce((n,a)=>n+a.amount_fen,0),90000);
 assert.equal((await api('/projects/'+f.project.id+'/settlement-summary')).actual_cost_fen,90000);
});
test('expense draft CRUD, confirmed correction and explicit void retain all originals and deleted queries',async()=>{
 const f=await fixture();let d=await prepare(f,300);
 d=await api('/cost-drafts/'+d.id,'PATCH',{...body(f,350),version:d.version});
 await api('/cost-drafts/'+d.id,'PATCH',{...body(f,350),version:1},409);
 await api('/cost-drafts/'+d.id,'DELETE',{version:d.version,reason:'不采用此草稿'});
 assert.equal((await api('/executions/'+f.a.id+'/costs')).drafts.length,0);
 assert.equal((await api('/executions/'+f.a.id+'/costs?draft_status=deleted')).drafts[0].status,'deleted');
 assert.equal((await api('/cost-drafts/'+d.id)).history.length,3);
 const c=await cost(f,300);const amended=await confirm(await revise(f,c,250));
 assert.equal((await api('/costs/'+c.entry_id)).versions[1].amount_fen,30000);
 const withdraw=await prepare(f,1,{entry_id:c.entry_id,base_version:amended.version_no,kind:'void',reason:'明确撤销错误费用'});await confirm(withdraw);
 assert.equal((await api('/executions/'+f.a.id+'/costs')).entries.length,0);
 assert.equal((await api('/executions/'+f.a.id+'/costs?status=voided')).entries[0].status,'voided');
 assert.equal((await api('/costs/'+c.entry_id)).versions.length,3);
 assert.throws(()=>db.prepare('UPDATE cost_versions SET amount_fen=1 WHERE entry_id=?').run(c.entry_id),/不可覆盖/);
 assert.throws(()=>db.prepare('DELETE FROM cost_allocations WHERE version_id=?').run(c.id),/不可清除/);
});
test('cost-to-settlement reconciliation tracks final expense shares and differences instead of cost minus settlement',async()=>{
 const f=await fixture(),c=await cost(f,300),s=await voucher(f,250),r=await match(f,c,s);
 const totals=await api('/executions/'+f.a.id+'/costs');assert.equal(totals.final_reconciled_expense_fen,30000);assert.equal(totals.pending_final_expense_fen,0);assert.equal(totals.actual_cost_fen,30000);
 assert.equal((await api('/projects/'+f.project.id+'/settlement-summary')).pending_final_expense_fen,0);
 await match(f,c,s,{expense_amount_yuan:'1',settled_amount_yuan:'0'},409);
 const c2=await cost(f,100);await match(f,c2,s,{settled_amount_yuan:'1'},409);
 const changed=await api('/cost-reconciliations/'+r.record_id,'PATCH',{...matchBody(f,c,s,{expense_amount_yuan:'200',settled_amount_yuan:'200',is_final:false}),version:r.version_no});
 assert.equal((await api('/executions/'+f.a.id+'/costs')).pending_final_expense_fen,40000);
 assert.equal((await api('/cost-reconciliations/'+r.record_id)).versions.length,2);
 const final=await api('/cost-reconciliations/'+r.record_id,'PATCH',{...matchBody(f,c,s,{expense_amount_yuan:'200',settled_amount_yuan:'200'}),version:changed.version_no});
 assert.equal(final.is_final,1);assert.equal((await api('/executions/'+f.a.id+'/costs')).pending_final_expense_fen,20000); // 400 costs total, 200 finally checked.
});
test('linked costs and vouchers cannot invalidate reconciliation; withdrawing the link releases both capacities',async()=>{
 const f=await fixture(),c=await cost(f,300),s=await voucher(f,250),r=await match(f,c,s);
 await confirm(await revise(f,c,250),409);
 await confirm(await prepare(f,1,{entry_id:c.entry_id,base_version:c.version_no,kind:'void',reason:'必须先处理核对'}),409);
 await api('/settlements/'+s.id,'PATCH',{version:1,request_key:s.id+'smaller',reason:'降低凭证金额',settlement_no:s.settlement_no,settlement_type:s.settlement_type,amount_yuan:'240',occurred_on:s.occurred_on,evidence:s.evidence},409);
 await api('/executions/'+f.a.id+'/settlements','POST',{execution_item_id:f.ai,settlement_no:f.tag+'REV',entry_kind:'reversal',reversal_of:s.id,amount_yuan:'1',occurred_on:'2026-10-30',evidence:'应先调整核对'},409);
 let preview=await api('/settlements/'+s.id+'/void-preview');assert.equal(preview.cost_reconciliations[0].record_id,r.record_id);
 await api('/settlements/'+s.id,'DELETE',{version:1,request_key:s.id+'void',reason:'应先调整核对',preview_token:preview.preview_token,affected_ids:[s.id]},409);
 await api('/cost-reconciliations/'+r.record_id,'DELETE',{version:r.version_no,request_key:r.record_id+'void',evidence:'先撤销错误核对关系'});
 await confirm(await prepare(f,1,{entry_id:c.entry_id,base_version:c.version_no,kind:'void',reason:'现已处理核对，可撤销费用'}));
 preview=await api('/settlements/'+s.id+'/void-preview');await api('/settlements/'+s.id,'DELETE',{version:1,request_key:s.id+'void2',reason:'明确撤销原凭证',preview_token:preview.preview_token,affected_ids:[s.id]});
 assert.equal((await api('/executions/'+f.a.id+'/costs')).actual_cost_fen,0);
 assert.equal((await api('/projects/'+f.project.id+'/settlement-summary')).settled_fen,0);
 assert.equal((await api('/cost-reconciliations/'+r.record_id)).entry.status,'voided');
});
test('reconciliation rejects cross-plan/unallocated sources and stale cost or settlement versions',async()=>{
 const f=await fixture(),c=await cost(f,300),s=await voucher(f,250);
 await match(f,c,s,{execution_item_id:f.bi},422);
 const unallocated=await api('/projects/'+f.project.id+'/settlements','POST',{scope_id:f.scope.id,settlement_no:f.tag+'UNALLOC',entry_kind:'payment',settlement_type:'advance',amount_yuan:'100',occurred_on:'2026-10-30',evidence:'项目级未归集凭证'},201);
 await match(f,c,unallocated,{},422);
 const updated=await confirm(await revise(f,c,350));await match(f,c,s,{},409);
 const amended=await api('/settlements/'+s.id,'PATCH',{version:1,request_key:s.id+'v2',reason:'凭据资料更正',settlement_no:s.settlement_no,settlement_type:s.settlement_type,amount_yuan:'250',occurred_on:s.occurred_on,evidence:'更新后的依据'});
 await match(f,updated,s,{},409);await match(f,updated,amended.entry,{settled_amount_yuan:'250'});
});
test('expense increase after partial final reconciliation exposes newly unmatched costs; concurrent matching does not overconsume',async()=>{
 const f=await fixture(),c=await cost(f,300),s=await voucher(f,250);
 const bodies=[matchBody(f,c,s,{expense_amount_yuan:'200',settled_amount_yuan:'100'}),matchBody(f,c,s,{expense_amount_yuan:'200',settled_amount_yuan:'100'})];
 const results=await Promise.all(bodies.map(b=>fetch(base+'/api/executions/'+f.a.id+'/cost-reconciliations',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)})));
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const index=results[0].status===201?0:1;const first=await results[index].json();assert.deepEqual(await api('/executions/'+f.a.id+'/cost-reconciliations','POST',bodies[index],201),first);
 assert.equal((await api('/executions/'+f.a.id+'/costs')).pending_final_expense_fen,10000);
 await confirm(await revise(f,c,400));assert.equal((await api('/executions/'+f.a.id+'/costs')).pending_final_expense_fen,20000);
 assert.equal((await api('/cost-reconciliations/'+first.record_id)).versions[0].cost_version_id,c.id);
});
test('expense confirmation/reconciliation require admin; editors prepare and viewers query only',async()=>{
 const f=await fixture(),d=await prepare(f),tokens={};const {createHash}=await import('node:crypto');
 for(const role of ['editor','viewer']){const id=f.tag+role,token=id+'token';db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',new Date().toISOString());db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00.000Z',new Date().toISOString());tokens[role]='sd_session='+token;await confirm(d,403,id,tokens[role]);await api('/executions/'+f.a.id+'/costs','GET',undefined,200,tokens[role])}
 await api('/executions/'+f.a.id+'/cost-drafts','POST',body(f),403,tokens.viewer);
 await api('/executions/'+f.a.id+'/cost-drafts','POST',body(f),201,tokens.editor);
 const c=await confirm(d),s=await voucher(f);await api('/executions/'+f.a.id+'/cost-reconciliations','POST',matchBody(f,c,s),403,tokens.editor);
});
test('category deletion preserves adopted cost names and reopened ledgers retain amounts, links and FK integrity',async()=>{
 const f=await fixture(),c=await cost(f),s=await voucher(f),r=await match(f,c,s);
 const preview=await api('/dictionary-deletion/expense_category/'+f.category.id);
 await api('/dictionary-deletion/expense_category/'+f.category.id,'DELETE',{version:f.category.version,preview_token:preview.token,reason:'费用分类调整，保留历史引用'});
 const detail=await api('/costs/'+c.entry_id);assert.equal(detail.entry.category_snapshot.name,f.category.name);
 await api('/executions/'+f.a.id+'/cost-drafts','POST',body(f),422);
 const changed=await confirm(await revise(f,c,350));assert.equal(JSON.parse(changed.category_snapshot_json).name,f.category.name);
 const code=`import {db,one,all} from './server/db.mjs';console.log(JSON.stringify({cost:one('SELECT amount_fen FROM cost_current WHERE entry_id=?',process.argv[1]).amount_fen,links:one('SELECT COUNT(*) n FROM cost_reconciliation_current WHERE record_id=?',process.argv[2]).n,foreignKeys:all('PRAGMA foreign_key_check').length,integrity:one('PRAGMA integrity_check').integrity_check}));db.close();`;
 const data=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,c.entry_id,r.record_id],{env:{...process.env,DATA_DIR:root},encoding:'utf8'}));assert.deepEqual(data,{cost:35000,links:1,foreignKeys:0,integrity:'ok'});
});
test('malformed cost mutation payloads return validation errors without partial ledger writes',async()=>{
 const f=await fixture(),d=await prepare(f);
 for(const bad of [null,[],"invalid"]){
  await api('/executions/'+f.a.id+'/cost-drafts','POST',bad,422);
  await api('/cost-drafts/'+d.id,'PATCH',bad,422);
  await api('/cost-drafts/'+d.id,'DELETE',bad,422);
  await api('/cost-drafts/'+d.id+'/confirm','POST',bad,422);
  await api('/executions/'+f.a.id+'/cost-reconciliations','POST',bad,422);
 }
 assert.equal((await api('/executions/'+f.a.id+'/costs')).actual_cost_fen,0);
 assert.equal((await api('/cost-drafts/'+d.id)).status,'draft');
});
