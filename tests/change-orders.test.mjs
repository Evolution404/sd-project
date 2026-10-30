import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
const root=mkdtempSync(join(tmpdir(),'sd-change-orders-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one,all}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let base,cookie;
before(async()=>{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'changeadmin',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');base='http://127.0.0.1:'+app.address().port;
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'changeadmin',password:'test'})});
 cookie=r.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await new Promise(resolve=>app.close(resolve));db.close();rmSync(root,{recursive:true,force:true})});
async function api(path,method='GET',body,expected=200,asCookie=cookie){
 const r=await fetch(base+'/api'+path,{method,headers:{cookie:asCookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(result));return result;
}
let n=0;
async function fixture(){
 const tag='C'+(++n),v=await api('/voltage-levels','POST',{code:tag,name:'110kV'},201);
 const l=await api('/lines','POST',{line_code:tag,name:'输电线路'+tag,voltage_level_id:v.id},201);
 const physical=await api('/physical-towers','POST',{tower_code:tag},201);
 const tower=await api('/logical-towers','POST',{logical_code:tag,line_id:l.id,physical_tower_id:physical.id,tower_no:'#1',sort_rank:1},201);
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:tag+'UNIT',name:'套'},201);
 const op=await api('/dictionary-items','POST',{type_id:'operation',code:tag+'OP',name:'更换辅材',work_target_type:'line'},201);
 const src=await api('/dictionary-items','POST',{type_id:'source',code:tag+'SRC',name:'巡视'},201);
 const cat=await api('/dictionary-items','POST',{type_id:'project_category',code:tag+'CAT',name:'修理项目'},201);
 const batch=await api('/demand-batches/submit','POST',{idempotency_key:tag+'BATCH',work_target_type:'line',operation_id:op.id,
   unit_id:unit.id,target_object:'支撑件',quantity:'2',completion_standard:'验收合格',problem_description:'需更换',
   source:{type_id:src.id,proposed_by:'运检班',discovered_on:'2026-10-30'},rows:[{logical_tower_id:tower.id}]},201);
 let d=await api('/demands/'+batch.ids[0]);
 d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'实地核实'});
 const fw=await api('/frameworks','POST',{code:tag+'FW',name:'框架',limit_yuan:'300'},201);
 const ag=await api('/agreements','POST',{code:tag+'AG',name:'协议',framework_id:fw.id,limit_yuan:'300'},201);
 let p=await api('/projects','POST',{code:tag+'PROJ',name:'储备',agreement_id:ag.id},201);
 p=await api('/projects/'+p.id+'/scopes','POST',{version:p.version,demand_id:d.id,quantity:'2'},201);
 p=await api('/projects/'+p.id+'/preliminary-estimate','POST',{version:p.version,category_id:cat.id,amount_yuan:'200',basis:'定额测算'});
 p=await api('/projects/'+p.id+'/stock','POST',{version:p.version,reason:'入库资料完整'});
 p=await api('/projects/'+p.id+'/scopes/'+p.scopes[0].id,'PATCH',{version:p.version,unit_price_yuan:'100',price_source:'有效报价',price_date:'2026-10-30',tax_mode:'inclusive'});
 p=await api('/projects/'+p.id+'/approve','POST',{version:p.version,reason:'正式批准'});
 return {tag,p,d,scope:p.scopes[0],ag};
}
async function draft(f,code='CH1',quantity='1.5',price='120'){
 return api('/projects/'+f.p.id+'/change-orders','POST',{
  code:f.tag+code,base_approval_version_id:(await api('/projects/'+f.p.id+'/approval-versions'))[0].id,
  reason:'实施计划调整',changes:[{action:'adjust',scope_id:f.scope.id,quantity,unit_price_yuan:price,evidence:'施工复核资料'}]
 },201);
}
test('C06: submit/approve produces B2, preserves E1 facts, enforces release, quotas, and stale drafts',async()=>{
 const f=await fixture(),b1=(await api('/projects/'+f.p.id+'/approval-versions'))[0];
 let e1=await api('/projects/'+f.p.id+'/executions','POST',{number:'E1',plan_type:'outage'},201);
 e1=await api('/executions/'+e1.id+'/items','POST',{version:e1.version,scope_id:f.scope.id,quantity:'2'},201);
 const first=await draft(f,'CH1','1.5','120');
 await api('/change-orders/'+first.id+'/submit','POST',{reason:'提交预算变更'});
 await api('/change-orders/'+first.id+'/approve','POST',{reason:'仍有进行中批次'},409);
 assert.equal(one('SELECT COUNT(*) n FROM project_approval_versions WHERE project_id=?',f.p.id).n,1);
 e1=await api('/executions/'+e1.id+'/start','POST',{version:e1.version,reason:'开工'});
 e1=await api('/executions/'+e1.id+'/items/'+e1.items[0].id+'/complete','POST',{
   idempotency_key:f.tag+'DONE',quantity:'0.5',occurred_on:'2026-10-30',evidence:'验收记录'
 },201);
 await api('/change-orders/'+first.id+'/approve','POST',{reason:'在途仍不能变更'},409);
 e1=await api('/executions/'+e1.id+'/finish','POST',{version:e1.version,reason:'本次已结束'});
 const applied=await api('/change-orders/'+first.id+'/approve','POST',{reason:'结束在途批次后正式批准'});
 assert.equal(applied.version_no,2);assert.equal(applied.approved_budget_fen,18000);
 assert.equal((await api('/projects/'+f.p.id)).approved_budget_fen,18000);
 assert.equal(one('SELECT quantity_scaled FROM project_demand_scopes WHERE id=?',f.scope.id).quantity_scaled,15000);
 const versions=await api('/projects/'+f.p.id+'/approval-versions');
 assert.equal(versions.length,2);assert.equal(versions[1].approved_budget_fen,20000);
 assert.equal(JSON.parse(versions[1].snapshot_json).scopes[0].quantity_scaled,20000);
 assert.equal(e1.approval_version_id,b1.id);
 assert.equal((await api('/executions/'+e1.id)).items[0].demand_snapshot.id,f.d.id);
 assert.equal(JSON.parse((await api('/executions/'+e1.id)).items[0].scope_snapshot_json).quantity_scaled,20000);
 let e2=await api('/projects/'+f.p.id+'/executions','POST',{number:'E2',plan_type:'non_outage'},201);
 assert.equal(e2.approval_version_id,versions[0].id);
 await api('/executions/'+e2.id+'/items','POST',{version:e2.version,scope_id:f.scope.id,quantity:'1.1'},409);
 e2=await api('/executions/'+e2.id+'/items','POST',{version:e2.version,scope_id:f.scope.id,quantity:'1'},201);
 assert.equal(JSON.parse(e2.items[0].scope_snapshot_json).quantity_scaled,15000);
 assert.equal((await api('/agreements')).find(x=>x.id===f.ag.id).approved_budget_fen,18000);
 assert.throws(()=>db.prepare('UPDATE project_approval_versions SET approved_budget_fen=1 WHERE id=?').run(b1.id),/不可修改/);
 assert.throws(()=>db.prepare('DELETE FROM project_approval_versions WHERE id=?').run(b1.id),/不可删除/);
 assert.throws(()=>db.prepare('DELETE FROM completion_records WHERE execution_item_id=?').run(e1.items[0].id),/不可删除/);

 await api('/change-orders/'+first.id+'/approve','POST',{reason:'不能二次批准'},409);
 assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
 assert.equal(all('PRAGMA foreign_key_check').length,0);
});
test('C06: reject, insufficient budget, and completed quantities fail closed',async()=>{
 const f=await fixture();
 const reject=await draft(f,'REJECT','1.5','100');
 await api('/change-orders/'+reject.id+'/submit','POST',{reason:'提审'});
 await api('/change-orders/'+reject.id+'/reject','POST',{reason:'依据不充分'});
 assert.equal((await api('/change-orders/'+reject.id)).status,'rejected');
 await api('/change-orders/'+reject.id+'/approve','POST',{reason:'不能越过驳回'},409);
 const expensive=await draft(f,'EXPENSIVE','2','200');
 await api('/change-orders/'+expensive.id+'/submit','POST',{reason:'预算提交'});
 await api('/change-orders/'+expensive.id+'/approve','POST',{reason:'超过协议 300 元'},409);
 assert.equal((await api('/projects/'+f.p.id)).approved_budget_fen,20000);
 const older=await draft(f,'OLDER','2','80');
 const valid=await draft(f,'VALID','2','90');
 await api('/change-orders/'+valid.id+'/submit','POST',{reason:'提请'});
 await api('/change-orders/'+valid.id+'/approve','POST',{reason:'90元有效报价'});
 await api('/change-orders/'+older.id+'/submit','POST',{reason:'过期基线'},409);
 assert.equal((await api('/projects/'+f.p.id+'/approval-versions')).length,2);
});
test('C06: editor cannot approve, and submission preserves identity',async()=>{
 const f=await fixture();
 const uid='change-editor-user',token='change-editor-token';
 db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(uid,'changeeditor','unused','editor','active',new Date().toISOString());
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),uid,'2099-01-01T00:00:00.000Z',new Date().toISOString());
 const editor='sd_session='+token;
 const latest=(await api('/projects/'+f.p.id+'/approval-versions'))[0];
 const order=await api('/projects/'+f.p.id+'/change-orders','POST',{code:f.tag+'EDITOR',base_approval_version_id:latest.id,reason:'编制人发现新增成本',
  changes:[{action:'adjust',scope_id:f.scope.id,quantity:'1.8',unit_price_yuan:'100',evidence:'复核资料'}]},201,editor);
 await api('/change-orders/'+order.id+'/submit','POST',{reason:'申请确认'},200,editor);
 await api('/change-orders/'+order.id+'/approve','POST',{reason:'无授权'},403,editor);
 await api('/change-orders/'+order.id+'/reject','POST',{reason:'无授权'},403,editor);
 assert.equal((await api('/change-orders/'+order.id)).status,'submitted');
});
test('C06: add, retire and re-include an approved demand without erasing prior versions',async()=>{
 const f=await fixture(),original=await api('/demands/'+f.d.id);
 const secondBatch=await api('/demand-batches/submit','POST',{
  idempotency_key:f.tag+'-SECOND',work_target_type:'line',operation_id:original.operation_id,
  unit_id:original.unit_id,target_object:'另一处支撑件',quantity:'1',
  completion_standard:'验收合格',problem_description:'新的独立问题',
  source:{type_id:original.sources[0].type_id,proposed_by:'另一次巡视',discovered_on:'2026-10-30'},
  rows:[{logical_tower_id:original.logical_tower_id}]
 },201);
 let second=await api('/demands/'+secondBatch.ids[0]);
 second=await api('/demands/'+second.id+'/verify','POST',{version:second.version,status:'active',reason:'单独核实'});
 async function change(code,action,attrs){
  const base=(await api('/projects/'+f.p.id+'/approval-versions'))[0];
  const row={action,scope_id:f.scope.id,quantity:'0.5',unit_price_yuan:'100',
   price_source:'核定定额',price_date:'2026-10-30',tax_mode:'inclusive',evidence:'现场复查',...attrs};
  const order=await api('/projects/'+f.p.id+'/change-orders','POST',{
   code:f.tag+code,base_approval_version_id:base.id,reason:'调整范围',changes:[row]},201);
  await api('/change-orders/'+order.id+'/submit','POST',{reason:'提请审核'});
  return api('/change-orders/'+order.id+'/approve','POST',{reason:'复核需求与额度'});
 }
 const added=await change('ADD','add',{scope_id:undefined,demand_id:second.id,quantity:'1',unit_price_yuan:'20'});
 assert.equal(added.version_no,2);
 assert.equal(added.approved_budget_fen,22000);
 const addScope=added.scopes.find(x=>x.demand_id===second.id);
 assert.equal((await api('/projects/'+f.p.id)).scopes.length,2);
 const removed=await change('REMOVE','remove',{scope_id:f.scope.id,quantity:undefined,unit_price_yuan:undefined});
 assert.equal(removed.version_no,3);
 assert.equal(removed.approved_budget_fen,2000);
 assert.equal(one('SELECT status FROM project_demand_scopes WHERE id=?',f.scope.id).status,'retired');
 assert.equal((await api('/projects/'+f.p.id)).scopes.length,1);
 assert.equal((await api('/projects/'+f.p.id+'/approval-versions')).length,3);
 assert.equal(JSON.parse((await api('/projects/'+f.p.id+'/approval-versions'))[2].snapshot_json).scopes.length,1);
 const readded=await change('READD','add',{scope_id:undefined,demand_id:original.id,quantity:'0.5',unit_price_yuan:'100'});
 assert.equal(readded.version_no,4);
 assert.equal(readded.approved_budget_fen,7000);
 assert.equal(readded.scopes.find(x=>x.demand_id===original.id).scope_id,f.scope.id,'reactivate same stable scope ID');
 assert.equal(one('SELECT status FROM project_demand_scopes WHERE id=?',f.scope.id).status,'active');
 assert.equal(one('SELECT COUNT(*) n FROM project_demand_scopes WHERE project_id=?',f.p.id).n,2,'no duplicate scope rows');
 assert.equal((await api('/projects/'+f.p.id)).scopes.length,2);
 assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
});
test('settlement ledger: four implementation/settlement states, append-only reversal, budget safety',async()=>{
 const f=await fixture();
 const path='/projects/'+f.p.id;
 const scopeId=f.scope.id;
 let progress=await api(path+'/progress');
 assert.equal(progress.scopes[0].dual_status,'unimplemented_unsettled');
 assert.equal(progress.scopes[0].settled_fen,0);
 const payment=await api(path+'/settlements','POST',{
  scope_id:scopeId,settlement_no:f.tag+'ADV',entry_kind:'payment',settlement_type:'advance',
  amount_yuan:'40',occurred_on:'2026-10-30',evidence:'财务系统的预付款登记凭证'
 },201);
 assert.equal(payment.amount_fen,4000);
 progress=await api(path+'/progress');
 assert.equal(progress.scopes[0].dual_status,'unimplemented_settled');
 await api(path+'/settlements','POST',{
  scope_id:scopeId,settlement_no:f.tag+'OVER',settlement_type:'advance',
  amount_yuan:'200',occurred_on:'2026-10-30',evidence:'不应超过范围'
 },409);
 await api(path+'/settlements','POST',{
  scope_id:scopeId,settlement_no:f.tag+'FINAL-BAD',settlement_type:'final',
  amount_yuan:'10',occurred_on:'2026-10-30',evidence:'没有实际完成量'
 },409);
 await api(path+'/settlements','POST',{
  scope_id:scopeId,settlement_no:f.tag+'REV-OVER',entry_kind:'reversal',
  amount_yuan:'40.01',reversal_of:payment.id,occurred_on:'2026-10-30',evidence:'冲销不得超额'
 },409);
 const reversal=await api(path+'/settlements','POST',{
  scope_id:scopeId,settlement_no:f.tag+'REV',entry_kind:'reversal',
  amount_yuan:'40',reversal_of:payment.id,occurred_on:'2026-10-30',evidence:'预付款已退款'
 },201);
 assert.equal(reversal.reversal_of,payment.id);
 progress=await api(path+'/progress');
 assert.equal(progress.scopes[0].dual_status,'unimplemented_unsettled');
 assert.throws(()=>db.prepare('UPDATE project_settlement_entries SET amount_fen=1 WHERE id=?').run(payment.id),/不可修改/);
 assert.throws(()=>db.prepare('DELETE FROM project_settlement_entries WHERE id=?').run(payment.id),/不可删除/);
 let e=await api(path+'/executions','POST',{number:'SETTLE-E1',plan_type:'outage'},201);
 e=await api('/executions/'+e.id+'/items','POST',{version:e.version,scope_id:scopeId,quantity:'1'},201);
 e=await api('/executions/'+e.id+'/start','POST',{version:e.version,reason:'开工'});
 e=await api('/executions/'+e.id+'/items/'+e.items[0].id+'/complete','POST',{
  idempotency_key:f.tag+'WORK',quantity:'1',occurred_on:'2026-10-30',evidence:'现场实物验收'
 },201);
 e=await api('/executions/'+e.id+'/finish','POST',{version:e.version,reason:'完成本次'});
 progress=await api(path+'/progress');
 assert.equal(progress.scopes[0].dual_status,'implemented_unsettled');
 assert.equal(progress.scopes[0].completed_quantity_scaled,10000);
 const settled=await api(path+'/settlements','POST',{
  scope_id:scopeId,settlement_no:f.tag+'FINAL',settlement_type:'final',
  amount_yuan:'100',occurred_on:'2026-10-30',evidence:'已签字的结算单据'
 },201);
 assert.equal(settled.approval_version_id,(await api(path+'/approval-versions'))[0].id);
 progress=await api(path+'/progress');
 assert.equal(progress.scopes[0].dual_status,'implemented_settled');
 assert.equal(progress.settled_fen,10000);
 assert.equal(progress.unsettled_approved_fen,10000);
 const smaller=await draft(f,'TOO-SMALL','1.5','50');
 await api('/change-orders/'+smaller.id+'/submit','POST',{reason:'拟降价格'});
 await api('/change-orders/'+smaller.id+'/approve','POST',{reason:'预算不得低于真实结算'},409);
 assert.equal((await api('/projects/'+f.p.id)).approved_budget_fen,20000);
 assert.equal((await api(path+'/settlements')).length,3);
 assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
});
