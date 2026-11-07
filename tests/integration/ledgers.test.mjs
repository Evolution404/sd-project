import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
const root=mkdtempSync(join(tmpdir(),'sd-ledgers-'));process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one,all}=await import('../../server/database/index.mjs');const {app}=await import('../../server/main.mjs');let origin,cookie,serial=0;
before(async()=>{execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'ledger',SD_ADMIN_PASSWORD:'test'}});app.listen(0,'127.0.0.1');await once(app,'listening');origin='http://127.0.0.1:'+app.address().port;const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'ledger',password:'test'})});cookie=r.headers.get('set-cookie').split(';')[0]});
after(async()=>{await new Promise(r=>app.close(r));db.close();rmSync(root,{recursive:true,force:true})});
async function api(path,method='GET',body,expected=200){const r=await fetch(origin+'/api'+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(data));return data}
async function fixture(numbers=['001','002','003']){const n=++serial,v=await api('/voltage-levels','POST',{code:'V'+n,name:'110kV'},201),l=await api('/ledger/lines','POST',{name:'主线'+n,voltage_level_id:v.id},201);let w=await api('/ledger/lines/'+l.id);if(numbers.length){await api('/ledger/lines/'+l.id+'/towers','POST',{version:w.line.version,topology_token:w.topology_token,rows:numbers.map(tower_no=>({tower_no})),idempotency_key:'towers'+n},201);w=await api('/ledger/lines/'+l.id)}return {n,v,l,w}}
test('line workspace creates main/branch, draft junction, inherited voltage and auto IDs',async()=>{
 const {v,l,w}=await fixture();assert.match(l.line_code,/XL-/);assert.equal(l.line_kind,'main');assert.equal(w.towers.length,3);assert.ok(w.towers.every(t=>t.physical_tower_id));
 await api('/ledger/lines','POST',{name:'错误支线',line_kind:'branch',parent_line_id:l.id},422);
 let b=await api('/ledger/lines','POST',{name:'草稿支线',line_kind:'branch',parent_line_id:l.id,draft:true},201);assert.equal(b.setup_status,'draft');assert.equal(b.voltage_level_id,v.id);
 await api('/ledger/lines/'+b.id+'/towers','POST',{version:b.version,rows:[{tower_no:'001'}]},409);
 b=await api('/ledger/lines/'+b.id,'PATCH',{version:b.version,junction_tower_id:w.towers[0].id,setup_status:'ready',reason:'确认接入点'});let bw=await api('/ledger/lines/'+b.id);assert.equal(bw.junction.id,w.towers[0].id);assert.equal(bw.towers.length,0,'junction is a reference, not a duplicated physical/logical tower');
 await api('/ledger/lines','POST',{name:'孙支线',line_kind:'branch',parent_line_id:b.id,junction_tower_id:w.towers[0].id},422);
 await api('/ledger/lines/'+b.id+'/towers','POST',{version:bw.line.version,rows:[{tower_no:'001'}]},201);bw=await api('/ledger/lines/'+b.id);const preview=await api('/ledger/lines/'+b.id+'/spans/preview','POST',{version:bw.line.version,topology_token:bw.topology_token});assert.equal(preview.candidates[0].start_tower_id,w.towers[0].id);
 await api('/ledger/lines/'+l.id,'PATCH',{version:w.line.version,status:'inactive',reason:'停用'},409);
});
test('batch preflight is read-only, all-or-nothing, preserves order/padding, supports insertion, retries and stale previews',async()=>{
 const {l,w}=await fixture(['001','003']);const bad={version:w.line.version,rows:[{tower_no:'002'},{tower_no:'001'}]};const count=one('SELECT COUNT(*) n FROM physical_towers').n;await api('/ledger/lines/'+l.id+'/towers','POST',bad,422);assert.equal(one('SELECT COUNT(*) n FROM physical_towers').n,count);
 const body={version:w.line.version,topology_token:w.topology_token,after_tower_id:w.towers[0].id,rows:[{tower_no:'001A'}],idempotency_key:'insert-key'};
 await api('/ledger/lines/'+l.id+'/towers/preview','POST',body);assert.equal(one('SELECT COUNT(*) n FROM physical_towers').n,count);
 const created=await api('/ledger/lines/'+l.id+'/towers','POST',body,201);assert.deepEqual(await api('/ledger/lines/'+l.id+'/towers','POST',body,201),created);
 const current=await api('/ledger/lines/'+l.id);assert.deepEqual(current.towers.map(t=>t.tower_no),['001','001A','003']);await api('/ledger/lines/'+l.id+'/spans/preview','POST',{version:w.line.version,topology_token:w.topology_token},409);
});
test('shared tower bindings and shared property edits retain ownership, require confirmation and audit history',async()=>{
 const a=await fixture(['015']),b=await fixture(['028']);const x=a.w.towers[0],y=b.w.towers[0],pairs=[{source_id:y.id,target_id:x.id,source_version:y.version,target_version:x.version}];
 const preview=await api('/ledger/shared/preview','POST',{pairs});assert.equal(preview.pairs.length,1);assert.notEqual(one('SELECT physical_tower_id FROM logical_towers WHERE id=?',y.id).physical_tower_id,x.physical_tower_id);
 await api('/ledger/shared/bind','POST',{pairs,reason:'核实同塔',change_kind:'correction'});let detail=await api('/ledger/towers/'+y.id);assert.equal(detail.physical.id,x.physical_tower_id);assert.equal(detail.shared_with.length,2);assert.equal(detail.bindings.length,2);
 const edit={version:detail.version,physical_version:detail.physical.version,physical:{model:'新型号'},reason:'公共型号核对'};await api('/ledger/towers/'+y.id,'PATCH',edit,422);await api('/ledger/towers/'+y.id,'PATCH',{...edit,confirm_shared:true});assert.equal((await api('/ledger/towers/'+x.id)).physical.model,'新型号');
 detail=await api('/ledger/towers/'+y.id);await api('/ledger/towers/'+y.id,'PATCH',{version:detail.version,tower_no:'028A',reason:'本线编号修订'});assert.equal((await api('/ledger/towers/'+x.id)).tower_no,'015');
 detail=await api('/ledger/towers/'+y.id);
 await api('/ledger/towers/'+y.id,'PATCH',{version:detail.version,replace_physical:true,physical:{model:'实际新塔'},reason:'不允许仅移动共塔单回路'},409);
 const target=await api('/physical-towers','POST',{tower_code:'PH-WHOLE-'+a.n},201);
 const impact=await api('/physical-towers/'+x.physical_tower_id+'/replace');
 assert.equal(impact.affected.length,2);
 await api('/physical-towers/'+x.physical_tower_id+'/replace','POST',{source_version:impact.source.version,target_physical_tower_id:target.id,confirmed_towers:impact.affected.map(t=>({id:t.id,version:t.version})),reason:'两回路全部复核，整塔更新'});
 detail=await api('/ledger/towers/'+y.id);assert.equal(detail.physical.id,target.id);
 assert.equal(detail.bindings[0].change_kind,'replacement');assert.equal((await api('/ledger/towers/'+x.id)).physical.id,target.id);
});
test('shared-tower detachment preserves original physical tower, history and audit, with idempotent safe correction',async()=>{
 const a=await fixture(['101']),b=await fixture(['202']);
 const x=a.w.towers[0],y=b.w.towers[0];
 await api('/ledger/shared/bind','POST',{pairs:[{source_id:y.id,target_id:x.id,source_version:y.version,target_version:x.version}],change_kind:'correction',reason:'复核发现是共塔'});
 const original=await api('/ledger/towers/'+y.id);
 assert.equal(original.physical.id,x.physical_tower_id);
 const before=one('SELECT COUNT(*) n FROM physical_towers').n;
 const preview=await api('/ledger/towers/'+y.id+'/detach');
 assert.equal(preview.can_detach,true);
 assert.equal(preview.shared_towers.length,2);
 assert.equal(preview.affected_demand_count,0);
 assert.equal(one('SELECT COUNT(*) n FROM physical_towers').n,before,'preview cannot mutate');
 await api('/ledger/towers/'+y.id+'/detach','POST',{version:original.version,physical_version:original.physical.version+1,reason:'错误版本'},409);
 assert.equal(one('SELECT COUNT(*) n FROM physical_towers').n,before);
 const body={version:original.version,physical_version:original.physical.version,reason:'查明两基塔只是编号相同，并非共塔',idempotency_key:'detachment-'+b.n};
 const result=await api('/ledger/towers/'+y.id+'/detach','POST',body);
 assert.deepEqual(await api('/ledger/towers/'+y.id+'/detach','POST',body),result,'same request is idempotent');
 const detached=await api('/ledger/towers/'+y.id),untouched=await api('/ledger/towers/'+x.id);
 assert.notEqual(detached.physical.id,untouched.physical.id);
 assert.equal(untouched.physical.id,x.physical_tower_id);
 assert.equal(detached.physical.model,original.physical.model);
 assert.equal(detached.tower_no,'202');
 assert.equal(detached.bindings.length,3);
 assert.equal(detached.bindings[0].change_kind,'correction');
 assert.equal(detached.bindings[0].reason,body.reason);
 assert.equal(detached.bindings[1].valid_to,detached.bindings[0].valid_from);
 assert.equal(one('SELECT COUNT(*) n FROM physical_towers').n,before+1);
 assert.equal(one("SELECT COUNT(*) n FROM audit_events WHERE entity='ledger_lines' AND action='detach_shared' AND entity_id=?",b.l.id).n,1);
 assert.equal((await api('/ledger/towers/'+y.id+'/detach')).can_detach,false);
 await api('/ledger/towers/'+y.id+'/detach','POST',{version:detached.version,physical_version:detached.physical.version,reason:'重复解除'},409);
 assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
});
test('detachment refuses tower demand references without moving demand locations or creating a new entity',async()=>{
 const a=await fixture(['311']),b=await fixture(['322']);
 const x=a.w.towers[0],y=b.w.towers[0];
 await api('/ledger/shared/bind','POST',{pairs:[{source_id:y.id,target_id:x.id,source_version:y.version,target_version:x.version}],change_kind:'correction',reason:'曾错误认为同塔'});
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'DET-U'+a.n,name:'套'},201);
 const op=await api('/dictionary-items','POST',{type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},default_unit_id:unit.id,code:'DET-OP'+a.n,name:'设施检查',work_target_type:'line'},201);
 const src=await api('/dictionary-items','POST',{type_id:'source',code:'DET-S'+a.n,name:'巡视'},201);
 const batch=await api('/demand-batches/submit','POST',{idempotency_key:'detach-demand-'+a.n,work_target_type:'line',operation_id:op.id,unit_id:unit.id,target_object:'塔材',quantity:'1',completion_standard:'复核完毕',problem_description:'塔上装置',source:{type_id:src.id,proposed_by:'巡检组',discovered_on:'2026-10-30'},rows:[{logical_tower_id:y.id}]},201);
 const demand=await api('/demands/'+batch.ids[0]);
 const original=await api('/ledger/towers/'+y.id);
 const before=one('SELECT COUNT(*) n FROM physical_towers').n;
 const preview=await api('/ledger/towers/'+y.id+'/detach');
 assert.equal(preview.can_detach,false);
 assert.ok(preview.affected_demand_count>0);
 assert.match(preview.block_reason,/需求引用/);
 await api('/ledger/towers/'+y.id+'/detach','POST',{version:original.version,physical_version:original.physical.version,reason:'不应允许移动有引用的位置'},409);
 assert.equal(one('SELECT COUNT(*) n FROM physical_towers').n,before);
 assert.equal((await api('/demands/'+demand.id)).logical_tower_id,y.id);
 assert.equal((await api('/ledger/towers/'+y.id)).physical.id,x.physical_tower_id);
});
test('spans store only endpoint links; length entries are ignored and topology is preserved',async()=>{
 const {l,w}=await fixture();let preview=await api('/ledger/lines/'+l.id+'/spans/preview','POST',{version:w.line.version});assert.equal(preview.candidates.length,2);let result=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:preview.candidates.map((s,i)=>({...s,length:i?'':'123.4567'}))},201);let ws=await api('/ledger/lines/'+l.id);assert.equal(ws.spans[0].length_scaled,null);assert.equal(ws.spans[1].length_scaled,null);assert.equal(ws.spans[1].status,'active');assert.equal(one("SELECT COUNT(*) n FROM pragma_table_info('line_spans') WHERE name='length_scaled'").n,0);
 await api('/ledger/lines/'+l.id+'/spans','POST',{version:ws.line.version,rows:[{...preview.candidates[0],length:'1'}]},422);
 await api('/ledger/lines/'+l.id+'/spans','POST',{version:ws.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[0].id,length:'1'}]},422);
 const foreign=await fixture(['999']);await api('/ledger/lines/'+l.id+'/spans','POST',{version:ws.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:foreign.w.towers[0].id,length:'1'}]},422);
 const ends=ws.spans.map(s=>[s.id,s.start_tower_id,s.end_tower_id]);await api('/ledger/lines/'+l.id+'/reorder','POST',{version:ws.line.version,ordered_ids:[...ws.towers].reverse().map(t=>t.id),reason:'调整显示顺序'});ws=await api('/ledger/lines/'+l.id);assert.deepEqual(ws.spans.map(s=>[s.id,s.start_tower_id,s.end_tower_id]).sort(),ends.sort());
 assert.ok(!all("SELECT name FROM pragma_table_info('line_spans')").some(c=>/conductor|reference|model/.test(c.name)));
 await api('/ledger/towers/'+w.towers[0].id,'DELETE',{version:ws.towers.find(t=>t.id===w.towers[0].id).version,reason:'错误删除'},409);
});
test('span demand and topology replacement preserve the adopted span version and prevent historical scope changes',async()=>{
 const {n,l,w}=await fixture(['001','003']);let made=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[1].id,length:'200'}]},201);let ws=await api('/ledger/lines/'+l.id);const old=ws.spans[0];
 const u=await api('/dictionary-items','POST',{type_id:'unit',code:'U'+n,name:'米'},201),op=await api('/dictionary-items','POST',{type_id:'operation',operation_profile:{location_kinds:['tower','span'],default_location_kind:'tower',default_target_object:'',entry_hint:''},default_unit_id:u.id,code:'OP'+n,name:'清理通道',work_target_type:'line'},201),src=await api('/dictionary-items','POST',{type_id:'source',code:'SRC'+n,name:'现场'},201);
 const payload={idempotency_key:'span-demand-'+n,work_target_type:'line',operation_id:op.id,unit_id:u.id,target_object:'通道',quantity:'50',completion_standard:'验收',problem_description:'树障',source:{type_id:src.id,proposed_by:'班组',discovered_on:'2026-10-29'},rows:[{span_id:old.id,span_version:old.version}]};let demand=await api('/demand-batches/submit','POST',payload,201);let d=await api('/demands/'+demand.ids[0]);assert.equal(d.location_kind,'span');assert.equal(d.logical_tower_id,null,'档距不再存储起点杆塔锚点');assert.equal(d.physical_tower_id,null);assert.equal(d.observed_physical_tower_id,null);assert.equal(d.quantity_scaled,500000,'span length is not automatically the execution quantity');assert.equal('length_scaled' in d.span_snapshot,false);
 await api('/ledger/spans/'+old.id,'DELETE',{version:old.version,reason:'已有引用'},409);
 await api('/ledger/lines/'+l.id+'/towers','POST',{version:ws.line.version,after_tower_id:w.towers[0].id,rows:[{tower_no:'002'}]},201);ws=await api('/ledger/lines/'+l.id);const middle=ws.towers.find(t=>t.tower_no==='002');
 await api('/ledger/lines/'+l.id+'/replace-spans','POST',{version:ws.line.version,topology_token:ws.topology_token,old_ids:[old.id],rows:[{start_tower_id:old.start_tower_id,end_tower_id:middle.id,length:'90'},{start_tower_id:middle.id,end_tower_id:old.end_tower_id,length:'110'}],reason:'插塔拆档'});assert.equal(one('SELECT status FROM line_spans WHERE id=?',old.id).status,'retired');
 d=await api('/demands/'+d.id);assert.equal('length_scaled' in d.span_snapshot,false);assert.equal(d.span_id,old.id);assert.equal(d.span_version,1);
 await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'不应直接确认旧范围'},422);
 const rows=await api('/demands?line_id='+l.id);assert.equal(rows.length,1);assert.equal(one('PRAGMA foreign_keys').foreign_keys,1);assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
});
test('span version changes require revalidation, without persisting a length',async()=>{
 const {n,l,w}=await fixture(['001','002']);const created=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[1].id,length:'10'}]},201);const id=created.ids[0];
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'VU'+n,name:'米'},201),op=await api('/dictionary-items','POST',{type_id:'operation',operation_profile:{location_kinds:['tower','span'],default_location_kind:'tower',default_target_object:'',entry_hint:''},default_unit_id:unit.id,code:'VO'+n,name:'通道作业',work_target_type:'line'},201),src=await api('/dictionary-items','POST',{type_id:'source',code:'VS'+n,name:'现场核实'},201);
 const batch=await api('/demand-batches/submit','POST',{idempotency_key:'verify-span-'+n,work_target_type:'line',operation_id:op.id,unit_id:unit.id,target_object:'通道',quantity:'5',completion_standard:'验收',problem_description:'树障',source:{type_id:src.id,proposed_by:'班组',discovered_on:'2026-10-29'},rows:[{span_id:id,span_version:1}]},201);let d=await api('/demands/'+batch.ids[0]);d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'核实通过'});
 const framework=await api('/frameworks','POST',{code:'SPAN-FW'+n,name:'档距检修年度框架',fiscal_year:2026,limit_yuan:'10000'},201);
 const project=await api('/projects','POST',{code:'SPAN-P'+n,name:'档距作业储备',framework_id:framework.id},201);await api('/ledger/spans/'+id,'PATCH',{version:1,reason:'复核档距端点'});await api('/projects/'+project.id+'/scopes','POST',{version:1,demand_id:d.id,quantity:'5'},409);
 d=await api('/demands/'+d.id+'/revalidate-location','POST',{version:d.version,reason:'按新档距重新核实'});assert.equal('length_scaled' in d.span_snapshot,false);d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'复核通过'});await api('/projects/'+project.id+'/scopes','POST',{version:1,demand_id:d.id,quantity:'5'},201);
});


test('logical towers carry separate management departments and span distance follows endpoint coordinates',async()=>{
 const n=++serial,v=await api('/voltage-levels','POST',{code:'GV'+n,name:'110kV'},201);
 const l=await api('/ledger/lines','POST',{name:'分属管辖测试'+n,voltage_level_id:v.id},201);
 await api('/ledger/lines/'+l.id+'/towers','POST',{version:l.version,rows:[
  {tower_no:'001',management_department:'输电运检二班',longitude:118.8,latitude:32},
  {tower_no:'002',management_department:'输电运检三班',longitude:118.8,latitude:32.001}
 ]},201);
 let w=await api('/ledger/lines/'+l.id);
 assert.deepEqual(w.towers.map(t=>t.management_department),['输电运检二班','输电运检三班']);
 const result=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:[{
  start_tower_id:w.towers[0].id,end_tower_id:w.towers[1].id,length:'99999'
 }]},201);
 assert.equal(result.ids.length,1);
 w=await api('/ledger/lines/'+l.id);
 assert.ok(Math.abs(w.spans[0].length_scaled/10000-111.195)<0.5);
 assert.equal(one("SELECT COUNT(*) n FROM pragma_table_info('line_spans') WHERE name='length_scaled'").n,0);
 const tower=w.towers[1];
 await api('/ledger/towers/'+tower.id,'PATCH',{version:tower.version,physical_version:tower.physical_version,
  tower_no:tower.tower_no,physical:{longitude:118.8,latitude:32.002},reason:'修正坐标'});
 w=await api('/ledger/lines/'+l.id);
 assert.ok(Math.abs(w.spans[0].length_scaled/10000-222.39)<0.5);
 assert.equal(w.spans[0].version,1);
 assert.deepEqual(w.towers.map(t=>t.management_department),['输电运检二班','输电运检三班']);
});


test('cross-line tower/span queries are server-paged and preserve counts and search filters',async()=>{
 // Search matches BOTH tower numbers and randomly generated physical IDs.
 // A bare numeric token such as '104' can randomly match another tower's UUID.
 // Use a non-UUID sentinel to make the single-result assertion deterministic.
 const marker='104-QUERY-UNIQUE';
 const {l,w}=await fixture(['101','102','103',marker,'105']);
 const first=await api('/ledger/towers?page=1&page_size=2&line_id='+l.id);
 assert.equal(first.total,5);assert.equal(first.rows.length,2);assert.equal(first.page,1);
 const second=await api('/ledger/towers?page=2&page_size=2&line_id='+l.id);
 assert.deepEqual(second.rows.map(r=>r.tower_no),['103',marker]);
 const last=await api('/ledger/towers?page=3&page_size=2&line_id='+l.id);
 assert.deepEqual(last.rows.map(r=>r.tower_no),['105']);
 const search=await api('/ledger/towers?page=1&page_size=30&search=QUERY-UNIQUE&line_id='+l.id);
 assert.equal(search.total,1);assert.equal(search.rows[0].tower_no,marker);
 await api('/ledger/towers?page=0', 'GET',undefined,422);
 await api('/ledger/towers?page=1&page_size=201', 'GET',undefined,422);
 await api('/ledger/lines/'+l.id+'/spans','POST',{
  version:w.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[1].id},
  {start_tower_id:w.towers[1].id,end_tower_id:w.towers[2].id}]
 },201);
 const spans=await api('/ledger/spans?page=1&page_size=1&line_id='+l.id);
 assert.equal(spans.total,2);assert.equal(spans.rows.length,1);assert.equal(spans.rows[0].distance_method,'coordinate-derived');
 assert.equal('length_scaled' in all("SELECT name FROM pragma_table_info('line_spans')").map(x=>x.name),false);
});


test('topology editor draft preview is rollback-only and a mixed node/edge commit is atomic and idempotent',async()=>{
 const {l,w}=await fixture(['001','003']);
 const existing=w.towers;
 const body={version:w.line.version,topology_token:w.topology_token,
  towers:[{client_id:'draft-insert-001a',after_id:existing[0].id,data:{tower_no:'001A',management_department:'输电四班',longitude:'118.5',latitude:'32.1'}}],
  spans:[{start_id:existing[0].id,end_id:'draft-insert-001a'},{start_id:'draft-insert-001a',end_id:existing[1].id}]};
 const before={towers:one('SELECT COUNT(*) n FROM logical_towers WHERE line_id=?',l.id).n,
  spans:one('SELECT COUNT(*) n FROM line_spans WHERE line_id=?',l.id).n,
  audits:one("SELECT COUNT(*) n FROM audit_events WHERE entity='ledger_lines' AND entity_id=?",l.id).n};
 const preview=await api('/ledger/lines/'+l.id+'/topology/preview','POST',body);
 assert.equal(preview.preview,true);assert.equal(preview.tower_count,1);assert.equal(preview.span_count,2);
 assert.equal(one('SELECT COUNT(*) n FROM logical_towers WHERE line_id=?',l.id).n,before.towers);
 assert.equal(one('SELECT COUNT(*) n FROM line_spans WHERE line_id=?',l.id).n,before.spans);
 assert.equal(one("SELECT COUNT(*) n FROM audit_events WHERE entity='ledger_lines' AND entity_id=?",l.id).n,before.audits);
 const invalid={...body,spans:[...body.spans,{start_id:existing[0].id,end_id:'missing-id'}]};
 await api('/ledger/lines/'+l.id+'/topology','POST',invalid,422);
 assert.equal(one('SELECT COUNT(*) n FROM logical_towers WHERE line_id=?',l.id).n,before.towers,'invalid mixed batch rolled back tower inserts');
 assert.equal(one('SELECT COUNT(*) n FROM line_spans WHERE line_id=?',l.id).n,before.spans,'invalid mixed batch rolled back span inserts');
 const result=await api('/ledger/lines/'+l.id+'/topology','POST',{...body,idempotency_key:'topology-mixed-'+l.id},201);
 assert.equal(result.tower_count,1);assert.equal(result.span_count,2);
 assert.deepEqual(await api('/ledger/lines/'+l.id+'/topology','POST',{...body,idempotency_key:'topology-mixed-'+l.id},201),result);
 const after=await api('/ledger/lines/'+l.id);
 assert.deepEqual(after.towers.map(t=>t.tower_no),['001','001A','003']);
 assert.equal(after.spans.filter(x=>x.status==='active').length,2);
 assert.equal(after.towers[1].management_department,'输电四班');
 assert.equal(after.towers[1].longitude,118.5);
 assert.equal(one("SELECT COUNT(*) n FROM audit_events WHERE entity='ledger_lines' AND entity_id=? AND action='topology_batch'",l.id).n,1);
 await api('/ledger/lines/'+l.id+'/topology','POST',body,409);
 const fresh=await api('/ledger/lines/'+l.id);
 await api('/ledger/lines/'+l.id+'/topology','POST',{
  version:fresh.line.version,topology_token:fresh.topology_token,
  towers:[{client_id:'draft-append',after_id:null,data:{tower_no:'004'}}],spans:[]},201);
 const appended=await api('/ledger/lines/'+l.id);
 assert.deepEqual(appended.towers.map(t=>t.tower_no),['001','001A','003','004'],'no anchor means append at end of line');

});


test('non-admin users cannot access the base ledger, including topology preview and commit',async()=>{
 const {l,w}=await fixture([]);
 for(const role of ['editor','viewer','verifier']){
  const id='ledger-role-'+role,token='session-ledger-'+role;
  db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00.000Z',new Date().toISOString());
  const headers={cookie:'sd_session='+token,'content-type':'application/json'};
  const query=await fetch(origin+'/api/ledger/lines',{headers});
  assert.equal(query.status,403,role+' cannot list base ledger');
  const detachPreview=await fetch(origin+'/api/ledger/towers/does-not-exist/detach',{headers});
  assert.equal(detachPreview.status,403,role+' cannot preview detach');
  const detachCommit=await fetch(origin+'/api/ledger/towers/does-not-exist/detach',{method:'POST',headers,body:JSON.stringify({version:1,physical_version:1,reason:'unauthorized'})});
  assert.equal(detachCommit.status,403,role+' cannot detach');
  const body={version:w.line.version,topology_token:w.topology_token,towers:[{client_id:'draft-permission',after_id:null,data:{tower_no:'NO'}}],spans:[]};
  for(const action of ['preview','']){
   const response=await fetch(origin+'/api/ledger/lines/'+l.id+'/topology'+(action?'/'+action:''),{method:'POST',headers,body:JSON.stringify(body)});
   assert.equal(response.status,403,role+' cannot '+(action||'commit')+' topology');
  }
 }
});
