import {financeFixture} from '../helpers/finance-fixture.mjs';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';

const root=mkdtempSync(join(tmpdir(),'sd-plan-budgets-'));
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
const fixture=()=>financeFixture(api,'BUDGET-'+(++count));
async function prepare(f,plan,amount,basis='计划预算人工编制'){
 const state=await api('/executions/'+plan.id+'/budget');
 return api('/executions/'+plan.id+'/budget-drafts','POST',{
  kind:'set',amount_yuan:String(amount),basis,base_budget_version:state.budget_version,
  project_approval_version_id:state.project_approval_version_id},201);
}
const confirm=(row,key=row.id+'-confirm',expected=200,as=cookie)=>api('/plan-budget-drafts/'+row.id+'/confirm','POST',{version:row.version,request_key:key},expected,as);
const summary=f=>api('/projects/'+f.project.id+'/plan-budgets');
async function adjust(f,plan,amount){const d=await prepare(f,plan,amount);return confirm(d)}
async function rebase(row,extra={}){
 const state=await api('/executions/'+row.execution_id+'/budget');
 return api('/plan-budget-drafts/'+row.id,'PATCH',{version:row.version,kind:row.kind,amount_yuan:String(row.amount_fen/100),basis:row.basis,
 base_budget_version:state.budget_version,project_approval_version_id:state.project_approval_version_id,...extra});
}
async function stopPlans(f){
 for(const p of [f.a,f.b]){const e=await api('/executions/'+p.id);await api('/executions/'+p.id+'/cancel','POST',{version:e.version,reason:'范围调整前取消未开工计划'})}
}
async function budgetChange(f,price){
 const latest=(await api('/projects/'+f.project.id+'/approval-versions'))[0];
 const c=await api('/projects/'+f.project.id+'/change-orders','POST',{base_approval_version_id:latest.id,reason:'复核项目批准预算',changes:[{action:'adjust',scope_id:f.scope.id,quantity:'10',unit_price_yuan:String(price),evidence:'新的核定单价'}]},201);
 await api('/change-orders/'+c.id+'/submit','POST',{reason:'申请预算变更'});return c;
}
test('plan budgets: manual drafts have no allocation, admin-confirmed current versions roll up once',async()=>{
 const f=await fixture();let a=await prepare(f,f.a,350),b=await prepare(f,f.b,400);
 assert.equal((await summary(f)).allocated_budget_fen,0);
 const first=await confirm(a);await confirm(b);
 let sums=await summary(f);assert.equal(sums.allocated_budget_fen,75000);assert.equal(sums.unallocated_budget_fen,25000);
 await adjust(f,f.a,500);sums=await summary(f);
 assert.equal(sums.allocated_budget_fen,90000);assert.equal(sums.unallocated_budget_fen,10000);
 const detail=await api('/executions/'+f.a.id+'/budget');
 assert.equal(detail.current.amount_fen,50000);assert.equal(detail.versions.length,2);assert.equal(detail.versions[1].id,first.id);
 assert.equal(detail.versions[1].amount_fen,35000);assert.equal(detail.settled_fen,0);
 const p=await api('/projects/'+f.project.id+'/settlement-summary');
 assert.equal(p.allocated_plan_budget_fen,90000);assert.equal(p.unallocated_plan_budget_fen,10000);assert.equal(p.settled_fen,0);
 for(const [kind,id] of [['agreements',f.ag.id],['frameworks',f.fw.id]]){
  const s=await api('/'+kind+'/'+id+'/settlement-summary');
  assert.equal(s.allocated_plan_budget_fen,90000);assert.equal(s.approved_budget_fen,100000);assert.equal(s.settled_fen,0);
  assert.equal((await api('/'+kind+'/'+id)).allocated_plan_budget_fen,90000);
 }
});
test('plan budget draft CRUD preserves deleted drafts and revision audit without allocating funds',async()=>{
 const f=await fixture(),state=await api('/executions/'+f.a.id+'/budget');
 const body={amount_yuan:'100',basis:'编制依据',base_budget_version:0,project_approval_version_id:state.project_approval_version_id};
 for(const bad of [{amount_yuan:'0'},{amount_yuan:'-1'},{amount_yuan:'1.001'},{basis:''}])
  await api('/executions/'+f.a.id+'/budget-drafts','POST',{...body,...bad},422);
 let d=await prepare(f,f.a,1500); // An unconfirmed alternative never occupies the budget.
 d=await rebase(d,{amount_yuan:'100',basis:'复核金额为100元'});
 await api('/plan-budget-drafts/'+d.id,'PATCH',{...body,version:1},409);
 await api('/plan-budget-drafts/'+d.id,'DELETE',{version:d.version,reason:''},422);
 const removed=await api('/plan-budget-drafts/'+d.id,'DELETE',{version:d.version,reason:'重复编制，删除此草稿'});
 assert.equal((await api('/executions/'+f.a.id+'/budget')).drafts.length,0);
 assert.equal(removed.status,'deleted');assert.equal((await summary(f)).allocated_budget_fen,0);
 const historic=await api('/plan-budget-drafts/'+d.id);
 assert.equal(historic.history.length,3);assert.equal(historic.history[0].after.amount_fen,150000);
 assert.equal((await api('/executions/'+f.a.id+'/budget?draft_status=deleted')).drafts.find(x=>x.id===d.id).status,'deleted');
 await confirm(removed,removed.id+'blocked',409);
 await api('/plan-budget-drafts/'+d.id,'DELETE',{version:removed.version,reason:'再次删除'},409);
});
test('plan budgets: approval checks aggregate cap inside transactions, conflicts and idempotent confirmations',async()=>{
 const f=await fixture(),a=await prepare(f,f.a,700),b=await prepare(f,f.b,600);
 const responses=await Promise.all([a,b].map(d=>fetch(base+'/api/plan-budget-drafts/'+d.id+'/confirm',{
  method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({version:d.version,request_key:d.id+'-race'})})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const successful=responses[0].status===200?a:b,loser=successful===a?b:a;
 const expected=successful.amount_fen;
 assert.equal((await summary(f)).allocated_budget_fen,expected);
 const original=await confirm(successful,successful.id+'-race');
 assert.equal(original.amount_fen,expected);assert.equal(one('SELECT COUNT(*) n FROM plan_budget_versions WHERE execution_id=?',successful.execution_id).n,1);
 await confirm(loser,successful.id+'-race',409);
 await confirm(successful,successful.id+'different-key',409);
 const small=await rebase(loser,{amount_yuan:'200'});await confirm(small);
 assert.equal((await summary(f)).allocated_budget_fen,expected+20000);
 const pending=await prepare(f,successful===a?f.a:f.b,100);
 await adjust(f,successful===a?f.a:f.b,150);
 await confirm(pending,pending.id+'stale',409);
 const rebased=await rebase(pending);await confirm(rebased);
});
test('plan end/cancel retains allocation; explicit release confirmation deletes current budget while facts remain',async()=>{
 const f=await fixture();await adjust(f,f.a,400);await adjust(f,f.b,300);
 let a=await api('/executions/'+f.a.id+'/start','POST',{version:f.a.version,reason:'按计划开工'});
 a=await api('/executions/'+a.id+'/items/'+f.ai+'/complete','POST',{idempotency_key:f.tag+'done',quantity:'2',occurred_on:'2026-10-30',evidence:'已完成2套'},201);
 await api('/executions/'+a.id+'/finish','POST',{version:a.version,reason:'结束并释放3套余量'});
 await api('/executions/'+f.b.id+'/cancel','POST',{version:f.b.version,reason:'取消未开工计划'});
 assert.equal((await summary(f)).allocated_budget_fen,70000);
 const state=await api('/executions/'+f.a.id+'/budget');
 const release=await api('/executions/'+f.a.id+'/budget-drafts','POST',{kind:'release',basis:'明确撤销本计划预算',base_budget_version:state.budget_version,project_approval_version_id:state.project_approval_version_id},201);
 assert.equal((await summary(f)).allocated_budget_fen,70000);
 await confirm(release);
 const after=await api('/executions/'+f.a.id+'/budget');
 assert.equal(after.budget_status,'released');assert.equal(after.current.amount_fen,0);assert.equal(after.versions[1].amount_fen,40000);
 assert.equal((await summary(f)).allocated_budget_fen,30000);
 assert.equal(one('SELECT SUM(quantity_scaled) n FROM completion_records WHERE execution_item_id=?',f.ai).n,20000);
 const fresh=await prepare(f,f.a,100);await confirm(fresh);
 assert.equal((await api('/executions/'+f.a.id+'/budget')).current.version_no,3);
 assert.throws(()=>db.prepare('UPDATE plan_budget_versions SET amount_fen=1 WHERE execution_id=?').run(f.a.id),/不可覆盖/);
 assert.throws(()=>db.prepare('DELETE FROM plan_budget_versions WHERE execution_id=?').run(f.a.id),/不可清除/);
});
test('project budget reduction requires confirmed plan reductions first; new project approval invalidates old drafts',async()=>{
 const f=await fixture();await adjust(f,f.a,500);await adjust(f,f.b,400);
 const stale=await prepare(f,f.a,100);await stopPlans(f);
 const change=await budgetChange(f,60); // Proposed project budget 600, allocated plans 900.
 await api('/change-orders/'+change.id+'/approve','POST',{reason:'不得先降项目预算'},409);
 assert.equal((await api('/projects/'+f.project.id)).approved_budget_fen,100000);
 assert.equal((await api('/projects/'+f.project.id+'/approval-versions')).length,1);
 await adjust(f,f.a,200); // 200 + 400 = 600, no automatic release on cancellation.
 const adjusted=await api('/change-orders/'+change.id+'/approve','POST',{reason:'计划预算先调减后批准'});
 assert.equal(adjusted.approved_budget_fen,60000);
 assert.equal((await summary(f)).unallocated_budget_fen,0);
 await confirm(stale,stale.id+'newapproval',409);
 const rechecked=await rebase(stale);await confirm(rechecked);
 assert.equal((await summary(f)).allocated_budget_fen,50000);
 const versions=(await api('/executions/'+f.a.id+'/budget')).versions;
 assert.equal(versions[0].project_approval_version_no,2);assert.equal(versions.at(-1).project_approval_version_no,1);
});
test('plan budgets are distinct from settlements; reduction/release never deletes or reallocates financial facts',async()=>{
 const f=await fixture();await adjust(f,f.a,100);
 const voucher=await api('/executions/'+f.a.id+'/settlements','POST',{execution_item_id:f.ai,settlement_no:f.tag+'S',entry_kind:'payment',settlement_type:'progress',amount_yuan:'150',occurred_on:'2026-10-30',evidence:'已确认的结算依据'},201);
 const state=await api('/executions/'+f.a.id+'/budget');assert.equal(state.budget_minus_settled_fen,-5000);
 const release=await api('/executions/'+f.a.id+'/budget-drafts','POST',{kind:'release',basis:'撤销独立核定预算，资金事实保留',base_budget_version:state.budget_version,project_approval_version_id:state.project_approval_version_id},201);
 await confirm(release);
 assert.equal((await api('/projects/'+f.project.id+'/settlement-summary')).settled_fen,15000);
 assert.equal((await api('/settlements/'+voucher.id)).entry.status,'active');
 assert.equal((await api('/executions/'+f.a.id+'/budget')).settled_fen,15000);
 assert.equal((await summary(f)).allocated_budget_fen,0);
});
test('plan budget server permissions: editors prepare, only admins confirm, viewers only query',async()=>{
 const f=await fixture(),state=await api('/executions/'+f.a.id+'/budget');
 const {createHash}=await import('node:crypto');
 const sessions={};
 for(const role of ['editor','viewer']){
  const id=f.tag+role,token=id+'token';
  db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00.000Z',new Date().toISOString());
  sessions[role]='sd_session='+token;
 }
 const body={amount_yuan:'100',basis:'编制员提交核定',base_budget_version:0,project_approval_version_id:state.project_approval_version_id};
 await api('/executions/'+f.a.id+'/budget-drafts','POST',body,403,sessions.viewer);
 const d=await api('/executions/'+f.a.id+'/budget-drafts','POST',body,201,sessions.editor);
 for(const role of ['editor','viewer']){
  await api('/executions/'+f.a.id+'/budget','GET',undefined,200,sessions[role]);
  await confirm(d,d.id+role,403,sessions[role]);
 }
 await api('/plan-budget-drafts/'+d.id,'PATCH',{...body,version:d.version},403,sessions.viewer);
 await api('/plan-budget-drafts/'+d.id,'DELETE',{version:d.version,reason:'越权删除'},403,sessions.viewer);
 await confirm(d);assert.equal((await summary(f)).allocated_budget_fen,10000);
});
test('budget history, deleted drafts and allocations persist when reopened in another process',async()=>{
 const f=await fixture();await adjust(f,f.a,123.45);
 const d=await prepare(f,f.b,200);await api('/plan-budget-drafts/'+d.id,'DELETE',{version:d.version,reason:'保留删除历史'});
 const code=`import {db,one,all} from './server/database/index.mjs'; console.log(JSON.stringify({amount:one('SELECT amount_fen FROM plan_budget_current WHERE execution_id=?',process.argv[1]).amount_fen,deleted:one('SELECT status FROM plan_budget_drafts WHERE id=?',process.argv[2]).status,foreignKeys:all('PRAGMA foreign_key_check').length,integrity:one('PRAGMA integrity_check').integrity_check})); db.close();`;
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,f.a.id,d.id],{env:{...process.env,DATA_DIR:root},encoding:'utf8'}));
 assert.deepEqual(result,{amount:12345,deleted:'deleted',foreignKeys:0,integrity:'ok'});
});
test('concurrent project reduction and plan confirmation serialize without an overallocated committed state',async()=>{
 const f=await fixture();await adjust(f,f.a,300);await stopPlans(f);
 const pending=await prepare(f,f.b,600),change=await budgetChange(f,60);
 const outcomes=await Promise.all([
  fetch(base+'/api/plan-budget-drafts/'+pending.id+'/confirm',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({version:pending.version,request_key:pending.id+'-project-race'})}),
  fetch(base+'/api/change-orders/'+change.id+'/approve',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({reason:'并发调减项目预算'})})
 ]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 const allocation=await summary(f),p=await api('/projects/'+f.project.id);
 assert.ok(allocation.allocated_budget_fen<=p.approved_budget_fen);
 if(outcomes[0].status===200){assert.equal(allocation.allocated_budget_fen,90000);assert.equal(p.approved_budget_fen,100000)}
 else{assert.equal(allocation.allocated_budget_fen,30000);assert.equal(p.approved_budget_fen,60000)}
 assert.equal(all('PRAGMA foreign_key_check').length,0);
});
