import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  assert.equal(one('PRAGMA user_version').user_version,5);
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
  const v220=await request('/voltage-levels','POST',{code:'220',name:'220kV'},201);
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
  const unit=await request('/dictionary-items','POST',{type_id:'unit',code:'SET',name:'套',sort_order:1},201);
  const op=await request('/dictionary-items','POST',{type_id:'operation',code:'INSTALL',name:'安装防鸟装置',work_target_type:'line',default_unit_id:unit.id,default_quantity:'2',completion_standard:'验收合格'},201);
  const src=await request('/dictionary-items','POST',{type_id:'source',code:'PATROL',name:'巡视发现'},201);
  assert.equal(op.default_quantity_milli,2000);
  const payload={idempotency_key:'batch-001',work_target_type:'line',operation_id:op.id,unit_id:unit.id,target_object:'防鸟装置',quantity:'2',completion_standard:'验收合格',problem_description:'合成巡视测试',source:{type_id:src.id,proposed_by:'测试班组',discovered_on:'2026-10-29',description:'一次巡视'},rows:[{logical_tower_id:lt1.id,quantity:'2'},{logical_tower_id:lt2.id,target_object:'横担部位',quantity:'3'},{logical_tower_id:lt3.id,quantity:'2'}]};
  const result=await request('/demand-batches/submit','POST',payload,201);
  assert.equal(result.count,3);assert.equal(result.ids.length,3);
  assert.equal(await request('/demand-batches/submit','POST',payload,201).then(x=>x.batch_id),result.batch_id);
  assert.equal(one('SELECT COUNT(*) n FROM source_records').n,1,'shared source');
  assert.equal(one('SELECT COUNT(*) n FROM demands').n,3);
  assert.equal(one('SELECT SUM(quantity_milli) n FROM demands').n,7000,'individual overrides');
  assert.equal(one('SELECT COUNT(*) n FROM demand_sources').n,3,'shared source linkage');
  await request('/demand-batches/submit','POST',{...payload,quantity:'4'},409);
  const d=await request('/demands/'+result.ids[0]);
  assert.equal(d.status,'pending');assert.equal(d.physical_code_snapshot,'PH-001');
  await request('/demands/'+d.id+'/verify','POST',{status:'active',version:d.version,reason:'现场核实完成'});
  const fw=await request('/frameworks','POST',{code:'FW-TEST',name:'试验资金框架',limit_yuan:'100000.00'},201);
  const ag=await request('/agreements','POST',{code:'AG-TEST',name:'测试执行协议',framework_id:fw.id,limit_yuan:'30000'},201);
  await request('/agreements','POST',{code:'AG-TOO-LARGE',name:'超额协议',framework_id:fw.id,limit_yuan:'80000'},422);
  const project=await request('/projects','POST',{code:'P-TEST',name:'防鸟装置施工项目'},201);
  assert.equal(project.agreement_id,null,'reserve may have unbound agreement');
  let detail=await request('/projects/'+project.id);
  detail=await request('/projects/'+project.id+'/scopes','POST',{version:detail.version,demand_id:d.id,quantity:'1'},201);
  assert.equal(detail.estimate.missing_price_count,1);
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'不能越级'},409);
  detail=await request('/projects/'+project.id+'/stock','POST',{version:detail.version,reason:'纳入正式储备库，价格待核'},200);
  assert.equal(detail.status,'stocked');
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'缺协议'},422);
  detail=await request('/projects/'+project.id+'/agreement','POST',{version:detail.version,agreement_id:ag.id,reason:'落实执行协议'},200);
  await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'缺价格'},422);
  detail=await request('/projects/'+project.id+'/scopes/'+detail.scopes[0].id,'PATCH',{
   version:detail.version,unit_price_yuan:'150.25',price_source:'合成定额资料',price_date:'2026-10-29',tax_mode:'inclusive',reason:'确定估价'
  },200);
  detail=await request('/projects/'+project.id+'/approve','POST',{version:detail.version,reason:'预算资料核实并批准'},200);
  assert.equal(detail.status,'approved');assert.equal(detail.approved_budget_fen,15025);
  assert.equal(detail.events.length,2,'stock and approval snapshots each retained');
  const ex1=await request('/projects/'+project.id+'/executions','POST',{number:'EX1',description:'第一次作业',planned_on:'2026-10-30'},201);
  assert.equal(ex1.status,'planned');
  const ex2=await request('/projects/'+project.id+'/executions','POST',{number:'EX2',description:'第二次作业'},201);
  const firstItem=await request('/executions/'+ex1.id+'/items','POST',{version:ex1.version,scope_id:detail.scopes[0].id,quantity:'0.5'},201);
  assert.equal(firstItem.items.length,1);
  const secondItem=await request('/executions/'+ex2.id+'/items','POST',{version:ex2.version,scope_id:detail.scopes[0].id,quantity:'0.5'},201);
  assert.equal(secondItem.items.length,1);
  await request('/projects/'+project.id+'/executions','POST',{number:'EX2'},409);
  const third=await request('/projects/'+project.id+'/executions','POST',{number:'EX3'},201);
  await request('/executions/'+third.id+'/items','POST',{version:third.version,scope_id:detail.scopes[0].id,quantity:'0.1'},409);
  let running=await request('/executions/'+ex1.id+'/start','POST',{version:firstItem.version,reason:'实际开工'},200);
  await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.6',occurred_on:'2026-10-29',evidence:'验收记录A',idempotency_key:'completion-too-large'},409);
  running=await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.5',occurred_on:'2026-10-29',evidence:'验收记录A',idempotency_key:'completion-001'},201);
  assert.equal(running.items[0].completed_quantity_milli,500);
  const replay=await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.5',occurred_on:'2026-10-29',evidence:'验收记录A',idempotency_key:'completion-001'},201);
  assert.equal(replay.items[0].completed_quantity_milli,500,'replay must not duplicate');
  await request('/executions/'+ex1.id+'/items/'+running.items[0].id+'/complete','POST',{quantity:'0.1',occurred_on:'2026-10-29',evidence:'另一次实施',idempotency_key:'completion-001'},409);
  running=await request('/executions/'+ex1.id+'/finish','POST',{version:running.version,reason:'本批完成并归档'},200);
  assert.equal(running.status,'finished');
  assert.equal((await request('/projects/'+project.id+'/executions')).length,3);

  assert.equal((await request('/frameworks')).find(x=>x.id===fw.id).approved_project_budget_fen,15025,'real-time rollup from distinct projects');
  await request('/projects/'+project.id+'/agreement','POST',{version:detail.version,agreement_id:ag.id},409);
  const parallel=await request('/projects','POST',{code:'P-SECOND',name:'重复范围候选'},201);
  let p2=await request('/projects/'+parallel.id+'/scopes','POST',{version:1,demand_id:d.id,quantity:'2'},201);
  p2=await request('/projects/'+parallel.id+'/stock','POST',{version:p2.version,reason:'候选项目入库'},200);
  p2=await request('/projects/'+parallel.id+'/agreement','POST',{version:p2.version,agreement_id:ag.id},200);
  p2=await request('/projects/'+parallel.id+'/scopes/'+p2.scopes[0].id,'PATCH',{
   version:p2.version,unit_price_yuan:'200',price_source:'合成价目表',price_date:'2026-10-29',tax_mode:'inclusive'
  },200);
  await request('/projects/'+parallel.id+'/approve','POST',{version:p2.version,reason:'重复范围不应获批'},409);

  await request('/demands/'+d.id+'/verify','POST',{status:'active',version:d.version,reason:'重复确认'},409);
  const renamed=await request('/logical-towers/'+lt1.id,'PATCH',{version:1,tower_no:'#1A',reason:'命名修正'});
  assert.equal(renamed.tower_no,'#1A');
  const changed=await request('/logical-towers/'+lt1.id,'PATCH',{version:2,physical_tower_id:otherPhysical.id,change_kind:'replacement',reason:'换塔'});
  assert.equal(changed.physical_tower_id,otherPhysical.id);
  const history=await request('/logical-towers/'+lt1.id);
  assert.equal(history.name_history.length,2);
  assert.equal(history.physical_history.length,2);
  const retained=await request('/demands/'+d.id);
  assert.equal(retained.tower_no_snapshot,'#1');assert.equal(retained.observed_physical_tower_id,physical.id);
  await request('/demands/'+d.id,'PATCH',{version:2,target_object:'新修订部位',reason:'需求修订'},200);
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
  await request('/dictionary-items/'+unit.id,'PATCH',{version:1,name:'装置套',status:'inactive'},200);
  assert.equal((await request('/demands/'+result.ids[1])).unit_snapshot,'套','option rename retains original text');
  await request('/demand-batches/submit','POST',{...payload,idempotency_key:'batch-002'},422);
  const exported=await fetch(base+'/api/demands/export.xlsx?status=pending',{headers:{cookie}});
  assert.equal(exported.status,200);assert.equal(exported.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,2).toString(),'PK');
  assert.equal(one('PRAGMA foreign_keys').foreign_keys,1);
  assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
  assert.ok(all('SELECT * FROM audit_events').length>12);
  console.log('PASS: integrated browser APIs, sqlite history, shared tower, idempotence, export, constraints, versions');
 }finally{await new Promise(r=>app.close(r));db.close();rmSync(root,{recursive:true,force:true})}
});
