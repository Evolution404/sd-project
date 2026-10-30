import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {createHash} from 'node:crypto';
import { once } from 'node:events';
const root=mkdtempSync(join(tmpdir(),'sd-project-integration-'));
process.env.DATA_DIR=root;
process.env.SD_DISABLE_LISTEN='1';
const {db,one,all}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
const {normalizeIP,isPermittedIP}=await import('../server/ip-access.mjs');
execFileSync(process.execPath,['scripts/init-admin.mjs'],{cwd:process.cwd(),env:{...process.env,SD_ADMIN_USER:'tester',SD_ADMIN_PASSWORD:'Test-Secure-Passw0rd-36'}});
app.listen(0,'127.0.0.1');await once(app,'listening');
const base='http://127.0.0.1:'+app.address().port;
let cookie='';
async function request(path,method='GET',body,expected=200){
 const headers={};
 if(cookie)headers.cookie=cookie;
 if(body!==undefined)headers['content-type']='application/json';
 const res=await fetch(base+'/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const text=await res.text();let data;try{data=JSON.parse(text)}catch{data=text}
 assert.equal(res.status,expected,path+': '+text);
 if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
 return data;
}
test('end-to-end: bootstrap, session, dictionaries, shared towers, batch, audit, conflict, export',async()=>{
 try{
  await request('/auth/me','GET',undefined,401);
  const login=await request('/auth/login','POST',{username:'tester',password:'Test-Secure-Passw0rd-36'});
  assert.equal(login.user.role,'admin');
  assert.equal(one('PRAGMA user_version').user_version,105);
  assert.equal(isPermittedIP('127.0.0.1'),true);
  assert.equal(isPermittedIP('::1'),true);
  assert.equal(isPermittedIP('::ffff:127.0.0.1'),true);
  assert.equal(isPermittedIP('127.0.0.2'),false,'not all loopback range exempt');
  assert.equal(isPermittedIP('192.168.8.15'),false,'remote default deny');
  assert.equal(normalizeIP('2001:0DB8:0000::0002'),'2001:db8::2');
  const firstIp=await request('/access/ips','POST',{ip:'192.168.8.15',note:'测试终端'},201);
  assert.equal(isPermittedIP('192.168.8.15'),true);
  await request('/access/ips','POST',{ip:'192.168.8.15'},409);
  await request('/access/ips','POST',{ip:'192.168.8.0/24'},422);
  await request('/access/ips','POST',{ip:'::1'},422);
  const ipv6=await request('/access/ips','POST',{ip:'2001:0db8:0000::2',note:'IPv6 终端'},201);
  assert.equal(ipv6.ip,'2001:db8::2');
  assert.equal(isPermittedIP('2001:db8::2'),true);
  assert.equal((await request('/access/ips')).entries.length,2);
  await request('/access/ips/'+firstIp.id,'DELETE');
  assert.equal(isPermittedIP('192.168.8.15'),false,'revocation immediate');
  const voltage=await request('/voltage-levels','POST',{code:'110',name:'110kV'},201);
  const v220=await request('/voltage-levels','POST',{name:'220kV'},201);
  assert.match(v220.code,/^VL-[0-9a-f]{32}$/,'name-only creation generates a stable code');
  const edited220=await request('/voltage-levels/'+v220.id,'PATCH',{version:1,sort_order:30});
  assert.equal(edited220.code,v220.code,'editing without code keeps the generated identifier');
  assert.equal(edited220.id,v220.id);
  assert.equal(voltage.version,1);
  assert.equal(voltage.sort_order,100);
  assert.equal((await request('/voltage-levels')).find(x=>x.id===voltage.id).id,voltage.id);
  await request('/voltage-levels/'+voltage.id,'PATCH',{version:1,name:'110千伏',sort_order:20,reason:'系统字典修订'});
  await request('/voltage-levels/'+voltage.id,'PATCH',{version:1,name:'旧版覆盖'},409);
  const updatedVoltage=(await request('/voltage-levels')).find(x=>x.id===voltage.id);
  assert.equal(updatedVoltage.version,2);
  assert.equal(updatedVoltage.name,'110千伏');
  assert.equal(updatedVoltage.sort_order,20);

  const line1=await request('/lines','POST',{line_code:'L01',name:'合成甲线',voltage_level_id:voltage.id},201);
  const line2=await request('/lines','POST',{line_code:'L02',name:'合成乙线',voltage_level_id:v220.id},201);
  const lineView=(await request('/lines')).find(x=>x.id===line1.id);
  assert.equal(lineView.voltage_name,'110千伏','existing line resolves updated dictionary name through unchanged stable ID');
  await request('/voltage-levels/'+voltage.id,'PATCH',{version:2,status:'inactive',reason:'电压字典停用'});
  await request('/lines','POST',{line_code:'L-BLOCKED',name:'不可新增线路',voltage_level_id:voltage.id},422);
  assert.equal((await request('/lines')).find(x=>x.id===line1.id).voltage_level_id,voltage.id,'existing references must survive inactivation');

  const physical=await request('/physical-towers','POST',{tower_code:'PH-001',tower_type:'角钢塔'},201);
  const otherPhysical=await request('/physical-towers','POST',{tower_code:'PH-002',tower_type:'角钢塔'},201);
  const lt1=await request('/logical-towers','POST',{logical_code:'L01-T01',line_id:line1.id,physical_tower_id:physical.id,tower_no:'#1',sort_rank:100},201);
  const lt2=await request('/logical-towers','POST',{logical_code:'L02-T09',line_id:line2.id,physical_tower_id:physical.id,tower_no:'#9',sort_rank:9},201);
  const lt3=await request('/logical-towers','POST',{logical_code:'L01-T02',line_id:line1.id,physical_tower_id:otherPhysical.id,tower_no:'#2',sort_rank:101},201);
  assert.equal((await request('/logical-towers')).filter(x=>x.physical_tower_id===physical.id).length,2,'cross-voltage sharing one physical');
  await request('/logical-towers','POST',{logical_code:'BAD',line_id:line1.id,tower_no:'#3',sort_rank:102},422);
  await request('/logical-towers','POST',{logical_code:'DUP',line_id:line1.id,physical_tower_id:physical.id,tower_no:'#99',sort_rank:100},409);
  const unit=await request('/dictionary-items','POST',{type_id:'unit',code:'TEST-SET',name:'套',sort_order:1},201);
  const op=await request('/dictionary-items','POST',{type_id:'operation',code:'INSTALL',name:'安装防鸟装置',work_target_type:'line',default_unit_id:unit.id,default_quantity:'2',completion_standard:'验收合格'},201);
  const src=await request('/dictionary-items','POST',{type_id:'source',code:'TEST-PATROL',name:'巡视发现'},201);
  const projectCategory=await request('/dictionary-items','POST',{type_id:'project_category',code:'TEST-REPAIR',name:'修理项目'},201);
  assert.equal(op.default_quantity_scaled,20000);
  const payload={idempotency_key:'batch-001',work_target_type:'line',operation_id:op.id,unit_id:unit.id,target_object:'防鸟装置',quantity:'2',completion_standard:'验收合格',problem_description:'合成巡视测试',source:{type_id:src.id,proposed_by:'测试班组',discovered_on:'2026-10-29',description:'一次巡视'},rows:[{logical_tower_id:lt1.id,quantity:'2'},{logical_tower_id:lt2.id,target_object:'横担部位',quantity:'3'},{logical_tower_id:lt3.id,quantity:'2'}]};
  const result=await request('/demand-batches/submit','POST',payload,201);
  assert.equal(result.count,3);assert.equal(result.ids.length,3);
  assert.equal(await request('/demand-batches/submit','POST',payload,201).then(x=>x.batch_id),result.batch_id);
  assert.equal(one('SELECT COUNT(*) n FROM source_records').n,1,'shared source');
  assert.equal(one('SELECT COUNT(*) n FROM demands').n,3);
  assert.equal(one('SELECT SUM(quantity_scaled) n FROM demands').n,70000,'individual overrides');
  assert.equal(one('SELECT COUNT(*) n FROM demand_sources').n,3,'shared source linkage');
  await request('/demand-batches/submit','POST',{...payload,quantity:'4'},409);
  const d=await request('/demands/'+result.ids[0]);
  assert.equal(d.status,'pending');assert.equal(d.physical_code_snapshot,'PH-001');
  await request('/demands/'+d.id+'/verify','POST',{status:'active',version:d.version,reason:'现场核实完成'});
  const fw=await request('/frameworks','POST',{name:'试验资金框架',limit_yuan:'100000.00'},201);
  const ag=await request('/agreements','POST',{name:'测试执行协议',framework_id:fw.id,limit_yuan:'30000'},201);
  assert.match(fw.code,/^FW-[0-9a-f]{32}$/);assert.match(ag.code,/^AG-[0-9a-f]{32}$/);
  const otherFw=await request('/frameworks','POST',{code:'FW-OTHER',name:'另一年度框架',fiscal_year:2027,limit_yuan:'10000'},201);
  const otherAg=await request('/agreements','POST',{code:'AG-OTHER',name:'其他框架协议',framework_id:otherFw.id,limit_yuan:'5000'},201);
  await request('/projects','POST',{code:'P-MISSING-FRAMEWORK',name:'不可无框架的储备'},422);
  await request('/projects','POST',{code:'P-WRONG-FRAMEWORK',name:'跨框架错误',framework_id:fw.id,agreement_id:otherAg.id},422);
  await request('/agreements','POST',{code:'AG-TOO-LARGE',name:'超额协议',framework_id:fw.id,limit_yuan:'80000'},422);
  const project=await request('/projects','POST',{name:'防鸟装置施工项目',framework_id:fw.id},201);
  assert.equal(project.agreement_id,null,'reserve may have unbound agreement');
  assert.match(project.code,/^PJ-[0-9a-f]{32}$/);
  let detail=await request('/projects/'+project.id);
  detail=await request('/projects/'+project.id+'/scopes','POST',{version:detail.version,demand_id:d.id,quantity:'1'},201);
  assert.equal(detail.estimate.missing_price_count,1);
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'不能越级'},409);
  const adminCookie=cookie,editorToken='editor-session-test-only';
  const editorId='editor_test_id',nowTest=new Date().toISOString();
  db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(editorId,'editing_only','unused','editor','active',nowTest);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(editorToken).digest('hex'),editorId,'2099-01-01T00:00:00.000Z',nowTest);
  cookie='sd_session='+editorToken;
  await request('/projects/'+project.id+'/stock','POST',{version:detail.version,reason:'编辑人员无权入库'},403);
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'编辑人员无权立项'},403);
  cookie=adminCookie;
  await request('/projects/'+project.id+'/stock','POST',{version:detail.version,reason:'缺类别和初步估算不得入库'},422);
  detail=await request('/projects/'+project.id+'/preliminary-estimate','POST',{version:detail.version,
   category_id:projectCategory.id,amount_yuan:'150.25',basis:'现场初步测算与历史定额依据'},200);
  detail=await request('/projects/'+project.id+'/stock','POST',{version:detail.version,reason:'纳入正式储备库，价格待核'},200);
  assert.equal(detail.status,'stocked');
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'缺协议'},422);
  await request('/projects/'+project.id+'/agreement','POST',{version:detail.version,agreement_id:otherAg.id},422);
  detail=await request('/projects/'+project.id+'/agreement','POST',{version:detail.version,agreement_id:ag.id,reason:'落实执行协议'},200);
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'缺价格'},422);
  detail=await request('/projects/'+project.id+'/scopes/'+detail.scopes[0].id,'PATCH',{
   version:detail.version,unit_price_yuan:'150.25',price_source:'合成定额资料',price_date:'2026-10-29',tax_mode:'inclusive',reason:'确定估价'
  },200);
  detail=await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'预算资料核实并批准'},200);
  assert.equal(detail.status,'approved');assert.equal(detail.approved_budget_fen,15025);
  assert.equal(detail.events.length,2,'stock and approval snapshots each retained');  const approvalVersions=await request('/projects/'+project.id+'/approval-versions');
  assert.equal(approvalVersions.length,1);
  assert.equal(approvalVersions[0].approved_budget_fen,15025);
  assert.equal(JSON.parse(approvalVersions[0].snapshot_json).framework_id,fw.id,'approved version freezes direct management framework');
  const change=await request('/projects/'+project.id+'/change-orders','POST',{
   base_approval_version_id:approvalVersions[0].id,
   reason:'现场发现新增工作内容，提出范围调整但尚未审批',
   changes:[{action:'adjust',scope_id:detail.scopes[0].id,quantity:'0.8',unit_price_yuan:'200',evidence:'现场复核资料'}]
  },201);
  assert.equal(change.status,'draft');assert.match(change.code,/^CH-[0-9a-f]{32}$/);
  assert.equal((await request('/projects/'+project.id+'/change-orders')).length,1);
  assert.equal((await request('/change-orders/'+change.id)).id,change.id);
  await request('/projects/'+project.id+'/change-orders','POST',{
    code:'CHG-BAD',base_approval_version_id:approvalVersions[0].id,reason:'无效工作范围',
    changes:[{action:'adjust',scope_id:'nonexistent',quantity:'1',evidence:'资料'}]
  },422);
  assert.equal((await request('/projects/'+project.id)).approved_budget_fen,15025,'change draft must not alter approved budget');

  const ex1=await request('/projects/'+project.id+'/executions','POST',{number:'EX1',description:'第一次作业',planned_on:'2026-10-30',plan_type:'outage'},201);
  assert.equal(ex1.status,'planned');
  assert.equal(ex1.plan_type,'outage');
  assert.equal(ex1.approval_version_id,approvalVersions[0].id,'execution must bind immutable approval version');

  const ex2=await request('/projects/'+project.id+'/executions','POST',{number:'EX2',description:'第二次作业',plan_type:'non_outage'},201);
  assert.equal(ex2.plan_type,'non_outage');
  const firstItem=await request('/executions/'+ex1.id+'/items','POST',{version:ex1.version,scope_id:detail.scopes[0].id,quantity:'1'},201);
  assert.equal(firstItem.items.length,1);
  assert.equal(firstItem.items[0].demand_snapshot.id,d.id);
  assert.equal(JSON.parse(firstItem.items[0].scope_snapshot_json).quantity_scaled,10000);

  await request('/executions/'+ex2.id+'/items','POST',{version:ex2.version,scope_id:detail.scopes[0].id,quantity:'0.5'},409);
  const secondItem=null;

  await request('/projects/'+project.id+'/executions','POST',{number:'EX2',plan_type:'non_outage'},409);
  const third=await request('/projects/'+project.id+'/executions','POST',{plan_type:'outage'},201);
  assert.equal(third.number,'第3次检修');
  await request('/executions/'+third.id+'/items','POST',{version:third.version,scope_id:detail.scopes[0].id,quantity:'0.1'},409);
  let running=await request('/executions/'+ex1.id+'/start','POST',{version:firstItem.version,reason:'实际开工'},200);
  await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'1.1',occurred_on:'2026-10-29',evidence:'验收记录A',idempotency_key:'completion-too-large'},409);
  running=await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.5',occurred_on:'2026-10-29',evidence:'验收记录A',idempotency_key:'completion-001'},201);
  assert.equal(running.items[0].completed_quantity_scaled,5000);
  const replay=await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.5',occurred_on:'2026-10-29',evidence:'验收记录A',idempotency_key:'completion-001'},201);
  assert.equal(replay.items[0].completed_quantity_scaled,5000,'replay must not duplicate');
  await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.1',occurred_on:'2026-10-29',evidence:'另一次实施',idempotency_key:'completion-001'},409);
  running=await request('/executions/'+ex1.id+'/finish','POST',{version:running.version,reason:'本批完成并归档'},200);
  assert.equal(running.status,'finished');
  assert.equal((await request('/projects/'+project.id+'/executions')).length,3);
  assert.equal(one('SELECT planned_quantity_scaled FROM execution_items WHERE id=?',running.items[0].id).planned_quantity_scaled,10000,'historic plan preserved');
  const releaseAudit=all("SELECT after_json FROM audit_events WHERE entity='executions' AND entity_id=? AND action='stage_finished'",ex1.id);
  assert.equal(JSON.parse(releaseAudit[0].after_json).closing_quantities[0].released_quantity_scaled,5000,'uncompleted quantity audited');
  const secondAfterRelease=await request('/executions/'+ex2.id+'/items','POST',{version:ex2.version,scope_id:detail.scopes[0].id,quantity:'0.5'},201);
  assert.equal(secondAfterRelease.items[0].planned_quantity_scaled,5000,'second batch reuses released remainder');
  await request('/executions/'+third.id+'/items','POST',{version:third.version,scope_id:detail.scopes[0].id,quantity:'0.1'},409);

  assert.equal((await request('/frameworks')).find(x=>x.id===fw.id).approved_project_budget_fen,15025,'real-time rollup from distinct projects');
  await request('/projects/'+project.id+'/agreement','POST',{version:detail.version,agreement_id:ag.id},409);
  const parallel=await request('/projects','POST',{code:'P-SECOND',name:'重复范围候选',framework_id:fw.id},201);
  // Although the total is within D's original quantity, a second formally approved project must not share this demand.
  let p2=await request('/projects/'+parallel.id+'/scopes','POST',{version:1,demand_id:d.id,quantity:'0.5'},201);
  p2=await request('/projects/'+parallel.id+'/preliminary-estimate','POST',{version:p2.version,
   category_id:projectCategory.id,amount_yuan:'400',basis:'估算依据：同类工程参考'},200);
  p2=await request('/projects/'+parallel.id+'/stock','POST',{version:p2.version,reason:'候选项目入库'},200);
  p2=await request('/projects/'+parallel.id+'/agreement','POST',{version:p2.version,agreement_id:ag.id},200);
  p2=await request('/projects/'+parallel.id+'/scopes/'+p2.scopes[0].id,'PATCH',{
   version:p2.version,unit_price_yuan:'200',price_source:'合成价目表',price_date:'2026-10-29',tax_mode:'inclusive'
  },200);
  await request('/projects/'+parallel.id+'/approve','POST',{version:p2.version,reason:'重复范围不应获批'},409);

  // One professional demand (10 sets) is owned by exactly one subproject,
  // but may be reserved by multiple maintenance plans within that subproject.
  let tenDemand=await request('/demands/'+result.ids[1]);
  tenDemand=await request('/demands/'+tenDemand.id,'PATCH',{version:tenDemand.version,quantity:'10',reason:'核实实际需更换10套'});
  tenDemand=await request('/demands/'+tenDemand.id+'/verify','POST',{version:tenDemand.version,status:'active',reason:'现场核实10套'});
  let tenProject=await request('/projects','POST',{code:'P-TEN',name:'分计划实施十套',framework_id:fw.id},201);
  tenProject=await request('/projects/'+tenProject.id+'/scopes','POST',{version:tenProject.version,demand_id:tenDemand.id,quantity:'10'},201);
  tenProject=await request('/projects/'+tenProject.id+'/preliminary-estimate','POST',{version:tenProject.version,category_id:projectCategory.id,amount_yuan:'10',basis:'经现场核实共十套'},200);
  tenProject=await request('/projects/'+tenProject.id+'/stock','POST',{version:tenProject.version,reason:'正式储备'},200);
  tenProject=await request('/projects/'+tenProject.id+'/agreement','POST',{version:tenProject.version,agreement_id:ag.id},200);
  tenProject=await request('/projects/'+tenProject.id+'/scopes/'+tenProject.scopes[0].id,'PATCH',{
   version:tenProject.version,unit_price_yuan:'1',price_source:'核定参考价',price_date:'2026-10-29',tax_mode:'inclusive'},200);
  tenProject=await request('/projects/'+tenProject.id+'/approve','POST',{version:tenProject.version,reason:'批准10套专业需求'},200);
  const tenScope=tenProject.scopes[0].id;
  let plan1=await request('/projects/'+tenProject.id+'/executions','POST',{number:'M01',plan_type:'outage'},201);
  let plan2=await request('/projects/'+tenProject.id+'/executions','POST',{number:'M02',plan_type:'outage'},201);
  plan1=await request('/executions/'+plan1.id+'/items','POST',{version:plan1.version,scope_id:tenScope,quantity:'5'},201);
  plan2=await request('/executions/'+plan2.id+'/items','POST',{version:plan2.version,scope_id:tenScope,quantity:'5'},201);
  assert.equal(plan1.items[0].project_scope_id,plan2.items[0].project_scope_id,'both plans reuse one approved demand scope');
  let plan3=await request('/projects/'+tenProject.id+'/executions','POST',{number:'M03',plan_type:'non_outage'},201);
  await request('/executions/'+plan3.id+'/items','POST',{version:plan3.version,scope_id:tenScope,quantity:'1'},409);
  plan1=await request('/executions/'+plan1.id+'/start','POST',{version:plan1.version,reason:'停电检修开工'});
  plan1=await request('/executions/'+plan1.id+'/items/'+plan1.items[0].id+'/complete','POST',{
   idempotency_key:'ten-scope-done-3',quantity:'3',occurred_on:'2026-10-30',evidence:'现场仅完成3套'},201);
  plan1=await request('/executions/'+plan1.id+'/finish','POST',{version:plan1.version,reason:'第一计划结束，2套转后续计划'});
  plan3=await request('/executions/'+plan3.id+'/items','POST',{version:plan3.version,scope_id:tenScope,quantity:'2'},201);
  assert.equal(plan3.items[0].planned_quantity_scaled,20000,'unfinished 2 sets become available after closing plan M01');



  await request('/demands/'+d.id+'/verify','POST',{status:'active',version:d.version,reason:'重复确认'},409);
  const renamed=await request('/logical-towers/'+lt1.id,'PATCH',{version:1,tower_no:'#1A',reason:'命名修正'});
  assert.equal(renamed.tower_no,'#1A');
  const changed=await request('/logical-towers/'+lt1.id,'PATCH',{version:2,physical_tower_id:otherPhysical.id,change_kind:'correction',reason:'单回路实体关联纠错'});
  assert.equal(changed.physical_tower_id,otherPhysical.id);
  const history=await request('/logical-towers/'+lt1.id);
  assert.equal(history.name_history.length,2);
  assert.equal(history.physical_history.length,2);
  const retained=await request('/demands/'+d.id);
  assert.equal(retained.tower_no_snapshot,'#1');assert.equal(retained.observed_physical_tower_id,physical.id);
  await request('/demands/'+d.id,'PATCH',{version:2,problem_description:'补充现场情况',reason:'需求修订'},200);
  const after=await request('/demands/'+d.id);
  assert.equal(after.status,'pending','revision requires reverification');
  assert.equal(after.revisions.length,2);
  const multiSources=await request('/demand-batches/submit','POST',{
   ...payload,idempotency_key:'two-sources-batch',rows:[{logical_tower_id:lt2.id,quantity:'0.5'}],
   sources:[
    {type_id:src.id,proposed_by:'线路巡视组',discovered_on:'2026-10-28',description:'杆塔巡视'},
    {type_id:src.id,proposed_by:'专项督查组',discovered_on:'2026-10-29',description:'专项发现'}
   ]
  },201);
  assert.equal(multiSources.count,1);
  assert.equal(multiSources.source_ids.length,2,'source inputs create two distinct persisted records');
  const multiDetail=await request('/demands/'+multiSources.ids[0]);
  assert.deepEqual(multiDetail.sources.map(x=>x.proposed_by).sort(),['专项督查组','线路巡视组'].sort());
  assert.equal(one('SELECT COUNT(*) n FROM demand_sources WHERE demand_id=?',multiSources.ids[0]).n,2);
  const replaySources=await request('/demand-batches/submit','POST',{
   ...payload,idempotency_key:'two-sources-batch',rows:[{logical_tower_id:lt2.id,quantity:'0.5'}],
   sources:[
    {type_id:src.id,proposed_by:'线路巡视组',discovered_on:'2026-10-28',description:'杆塔巡视'},
    {type_id:src.id,proposed_by:'专项督查组',discovered_on:'2026-10-29',description:'专项发现'}
   ]
  },201);
  assert.equal(replaySources.batch_id,multiSources.batch_id);
  const possibleDuplicate={...payload,idempotency_key:'duplicate-manual-check',rows:[{logical_tower_id:lt1.id,target_object:'防鸟装置',quantity:'1'}]};
  await request('/demand-batches/submit','POST',possibleDuplicate,409);
  const suggestions=await request('/demands/duplicate-candidates','POST',possibleDuplicate);
  assert.equal(suggestions.rows[0].candidates[0].id,d.id,'previous batch is detected');
  const separate={...possibleDuplicate,rows:[{...possibleDuplicate.rows[0],
   duplicate_review:{decision:'separate',candidate_id:d.id,reason:'与上次不同的新增现场缺陷，需要另行核实'}}]};
  const reoccur=await request('/demand-batches/submit','POST',separate,201);
  assert.equal(reoccur.count,1);
  assert.equal(one("SELECT decision FROM demand_duplicate_reviews WHERE batch_id=?",reoccur.batch_id).decision,'separate');
  assert.equal((await request('/demands/'+reoccur.ids[0])).status,'pending');
  const beforeLink=one('SELECT COUNT(*) n FROM demands').n;
  const linked={...possibleDuplicate,idempotency_key:'duplicate-link-sources',
   rows:[{...possibleDuplicate.rows[0],duplicate_review:{decision:'link',candidate_id:d.id,reason:'同一问题的第二份巡视来源'}}]};
  const linkedResult=await request('/demand-batches/submit','POST',linked,201);
  assert.equal(linkedResult.count,0,'linking an existing demand must not generate a second work quantity');
  assert.deepEqual(linkedResult.linked_ids,[d.id]);
  assert.equal(one('SELECT COUNT(*) n FROM demands').n,beforeLink);
  assert.equal((await request('/demands/'+d.id)).sources.length,2);
  assert.deepEqual((await request('/demand-batches/submit','POST',linked,201)).linked_ids,[d.id],'source link remains idempotent');
  await request('/dictionary-items/'+unit.id,'PATCH',{version:1,name:'装置套',status:'inactive'},200);
  assert.equal((await request('/demands/'+result.ids[1])).unit_snapshot,'套','option rename retains original text');
  await request('/demand-batches/submit','POST',{...payload,idempotency_key:'batch-002'},422);
  const exported=await fetch(base+'/api/demands/export.xlsx?status=pending',{headers:{cookie}});
  assert.equal(exported.status,200);assert.equal(exported.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,2).toString(),'PK');
  const sharedAgain=await request('/logical-towers','POST',{logical_code:'L01-SHARED-EXTRA',line_id:line1.id,physical_tower_id:physical.id,tower_no:'#88',sort_rank:188},201);
  const effect=await request('/physical-towers/'+physical.id+'/replace');
  assert.equal(effect.affected.length,2,'all shared active circuits must be identified');
  const replacementArgs={source_version:effect.source.version,target_physical_tower_id:otherPhysical.id,
   confirmed_towers:effect.affected.map(x=>({id:x.id,version:x.version})),reason:'整基实体更换，逐回路确认'};
  await request('/physical-towers/'+physical.id+'/replace','POST',{...replacementArgs,confirmed_towers:replacementArgs.confirmed_towers.slice(0,1)},409);
  assert.equal(one('SELECT physical_tower_id FROM logical_towers WHERE id=?',lt2.id).physical_tower_id,physical.id,'partial confirmations cannot move any tower');
  await request('/logical-towers/'+lt2.id,'PATCH',{version:1,physical_tower_id:otherPhysical.id,change_kind:'replacement',reason:'单回路绕过'},409);
  const swapped=await request('/physical-towers/'+physical.id+'/replace','POST',replacementArgs);
  assert.equal(swapped.affected.length,2);
  assert.equal(one('SELECT physical_tower_id FROM logical_towers WHERE id=?',lt2.id).physical_tower_id,otherPhysical.id);
  assert.equal(one('SELECT physical_tower_id FROM logical_towers WHERE id=?',sharedAgain.id).physical_tower_id,otherPhysical.id);
  assert.equal(one('SELECT change_kind FROM logical_tower_physical_history WHERE logical_tower_id=? AND valid_to IS NULL',lt2.id).change_kind,'replacement');
  await request('/physical-towers/'+physical.id+'/replace','POST',replacementArgs,409);
  assert.equal((await request('/demands/'+result.ids[1])).observed_physical_tower_id,physical.id,'historic demand location must not drift');
  const projectBeforeDictionaryDelete=await request('/projects/'+project.id);
  const operationBeforeDelete=one('SELECT * FROM dictionary_items WHERE id=?',op.id);
  const deletionPreview=await request('/dictionary-deletion/operation/'+op.id);
  assert.equal(deletionPreview.deletion_kind,'logical');assert.ok(deletionPreview.references.some(x=>x.domain==='专业需求'));
  await request('/dictionary-deletion/operation/'+op.id,'DELETE',{version:operationBeforeDelete.version});
  assert.deepEqual(await request('/projects/'+project.id),projectBeforeDictionaryDelete,'dictionary deletion must not change approved budgets, scope or frozen demand facts');
  assert.equal((await request('/demands/'+d.id)).operation_snapshot,op.name);
  assert.ok(!(await request('/dictionary-items')).some(x=>x.id===op.id));
  const scopeForFunding=(await request('/projects/'+project.id)).scopes[0];
  await request('/projects/'+project.id+'/settlements','POST',{scope_id:scopeForFunding.id,settlement_no:'FUNDING-LINKED-TEST',entry_kind:'payment',settlement_type:'progress',amount_yuan:'1',occurred_on:'2026-10-30',evidence:'资金维护测试真实范围结算'},201);
  const approvedBeforeFundingMaintenance=await request('/projects/'+project.id);
  const projectRowBeforeFundingMaintenance=one('SELECT * FROM projects WHERE id=?',project.id);
  const progressBeforeFundingMaintenance=await request('/projects/'+project.id+'/progress');
  const relatedAgreement=await request('/agreements/'+ag.id);
  assert.ok(relatedAgreement.settled_fen>=100);
  await request('/agreements/'+ag.id,'PATCH',{version:relatedAgreement.version,name:'协议名称维护不改批准事实',reason:'协议名称规范化'});
  await request('/agreements/'+ag.id,'DELETE',{version:relatedAgreement.version+1,reason:'协议停止新增，保留已批准项目'});
  const fundingPreservedProject=await request('/projects/'+project.id);
  assert.deepEqual(fundingPreservedProject.scopes,approvedBeforeFundingMaintenance.scopes);
  assert.equal(fundingPreservedProject.agreement_deleted,true);
  assert.deepEqual(one('SELECT * FROM projects WHERE id=?',project.id),projectRowBeforeFundingMaintenance);
  assert.deepEqual(await request('/projects/'+project.id+'/progress'),progressBeforeFundingMaintenance);
  await request('/projects/'+project.id+'/settlements','POST',{scope_id:scopeForFunding.id,settlement_no:'FUNDING-AFTER-DELETE',entry_kind:'payment',settlement_type:'progress',amount_yuan:'2',occurred_on:'2026-10-30',evidence:'原批准项目继续结算'},201);
  assert.equal((await request('/agreements/'+ag.id)).settled_fen,300,'logical deletion must retain current financial aggregation');
  assert.equal(one('PRAGMA foreign_keys').foreign_keys,1);
  assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
  assert.ok(all('SELECT * FROM audit_events').length>12);
  console.log('PASS: integrated browser APIs, sqlite history, shared tower, idempotence, export, constraints, versions');
 }finally{await new Promise(r=>app.close(r));db.close();rmSync(root,{recursive:true,force:true})}
});
