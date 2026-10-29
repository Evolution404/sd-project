import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
const root=mkdtempSync(join(tmpdir(),'sd-ledgers-'));process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one,all}=await import('../server/db.mjs');const {app}=await import('../server/server.mjs');let origin,cookie,serial=0;
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
test('spans only store length; correct endpoints, unknown length, duplicate guards and reorder do not alter confirmed connections',async()=>{
 const {l,w}=await fixture();let preview=await api('/ledger/lines/'+l.id+'/spans/preview','POST',{version:w.line.version});assert.equal(preview.candidates.length,2);let result=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:preview.candidates.map((s,i)=>({...s,length:i?'':'123.4567'}))},201);let ws=await api('/ledger/lines/'+l.id);assert.equal(ws.spans[0].length_scaled,1234567);assert.equal(ws.spans[1].length_scaled,null);assert.equal(ws.spans[1].status,'draft');
 await api('/ledger/lines/'+l.id+'/spans','POST',{version:ws.line.version,rows:[{...preview.candidates[0],length:'1'}]},422);
 await api('/ledger/lines/'+l.id+'/spans','POST',{version:ws.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[0].id,length:'1'}]},422);
 const foreign=await fixture(['999']);await api('/ledger/lines/'+l.id+'/spans','POST',{version:ws.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:foreign.w.towers[0].id,length:'1'}]},422);
 const ends=ws.spans.map(s=>[s.id,s.start_tower_id,s.end_tower_id]);await api('/ledger/lines/'+l.id+'/reorder','POST',{version:ws.line.version,ordered_ids:[...ws.towers].reverse().map(t=>t.id),reason:'调整显示顺序'});ws=await api('/ledger/lines/'+l.id);assert.deepEqual(ws.spans.map(s=>[s.id,s.start_tower_id,s.end_tower_id]).sort(),ends.sort());
 assert.ok(!all("SELECT name FROM pragma_table_info('line_spans')").some(c=>/conductor|reference|model/.test(c.name)));
 await api('/ledger/towers/'+w.towers[0].id,'DELETE',{version:ws.towers.find(t=>t.id===w.towers[0].id).version,reason:'错误删除'},409);
});
test('span demand and topology replacement preserve the adopted span version and prevent historical scope changes',async()=>{
 const {n,l,w}=await fixture(['001','003']);let made=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[1].id,length:'200'}]},201);let ws=await api('/ledger/lines/'+l.id);const old=ws.spans[0];
 const u=await api('/dictionary-items','POST',{type_id:'unit',code:'U'+n,name:'米'},201),op=await api('/dictionary-items','POST',{type_id:'operation',code:'OP'+n,name:'清理通道',work_target_type:'line'},201),src=await api('/dictionary-items','POST',{type_id:'source',code:'SRC'+n,name:'现场'},201);
 const payload={idempotency_key:'span-demand-'+n,work_target_type:'line',operation_id:op.id,unit_id:u.id,target_object:'通道',quantity:'50',completion_standard:'验收',problem_description:'树障',source:{type_id:src.id,proposed_by:'班组',discovered_on:'2026-10-29'},rows:[{span_id:old.id,span_version:old.version}]};let demand=await api('/demand-batches/submit','POST',payload,201);let d=await api('/demands/'+demand.ids[0]);assert.equal(d.location_kind,'span');assert.equal(d.quantity_scaled,500000,'span length is not automatically the execution quantity');assert.equal(d.span_snapshot.length_scaled,2000000);
 await api('/ledger/spans/'+old.id,'DELETE',{version:old.version,reason:'已有引用'},409);
 await api('/ledger/lines/'+l.id+'/towers','POST',{version:ws.line.version,after_tower_id:w.towers[0].id,rows:[{tower_no:'002'}]},201);ws=await api('/ledger/lines/'+l.id);const middle=ws.towers.find(t=>t.tower_no==='002');
 await api('/ledger/lines/'+l.id+'/replace-spans','POST',{version:ws.line.version,topology_token:ws.topology_token,old_ids:[old.id],rows:[{start_tower_id:old.start_tower_id,end_tower_id:middle.id,length:'90'},{start_tower_id:middle.id,end_tower_id:old.end_tower_id,length:'110'}],reason:'插塔拆档'});assert.equal(one('SELECT status FROM line_spans WHERE id=?',old.id).status,'retired');
 d=await api('/demands/'+d.id);assert.equal(d.span_snapshot.length_scaled,2000000);assert.equal(d.span_id,old.id);assert.equal(d.span_version,1);
 await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'不应直接确认旧范围'},422);
 const rows=await api('/demands?line_id='+l.id);assert.equal(rows.length,1);assert.equal(one('PRAGMA foreign_keys').foreign_keys,1);assert.equal(one('PRAGMA integrity_check').integrity_check,'ok');
});
test('changed span length must be reverified before a new project can adopt the demand',async()=>{
 const {n,l,w}=await fixture(['001','002']);const created=await api('/ledger/lines/'+l.id+'/spans','POST',{version:w.line.version,rows:[{start_tower_id:w.towers[0].id,end_tower_id:w.towers[1].id,length:'10'}]},201);const id=created.ids[0];
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'VU'+n,name:'米'},201),op=await api('/dictionary-items','POST',{type_id:'operation',code:'VO'+n,name:'通道作业',work_target_type:'line'},201),src=await api('/dictionary-items','POST',{type_id:'source',code:'VS'+n,name:'现场核实'},201);
 const batch=await api('/demand-batches/submit','POST',{idempotency_key:'verify-span-'+n,work_target_type:'line',operation_id:op.id,unit_id:unit.id,target_object:'通道',quantity:'5',completion_standard:'验收',problem_description:'树障',source:{type_id:src.id,proposed_by:'班组',discovered_on:'2026-10-29'},rows:[{span_id:id,span_version:1}]},201);let d=await api('/demands/'+batch.ids[0]);d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'核实通过'});
 const project=await api('/projects','POST',{code:'SPAN-P'+n,name:'档距作业储备'},201);await api('/ledger/spans/'+id,'PATCH',{version:1,length:'11',reason:'实测修正'});await api('/projects/'+project.id+'/scopes','POST',{version:1,demand_id:d.id,quantity:'5'},409);
 d=await api('/demands/'+d.id+'/revalidate-location','POST',{version:d.version,reason:'按新档距重新核实'});assert.equal(d.span_snapshot.length_scaled,110000);d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'复核通过'});await api('/projects/'+project.id+'/scopes','POST',{version:1,demand_id:d.id,quantity:'5'},201);
});
