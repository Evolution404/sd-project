import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
const root=mkdtempSync(join(tmpdir(),'sd-audit-regressions-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db,one}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let base,cookie,seq=0;
before(async()=>{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'audit',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');base='http://127.0.0.1:'+app.address().port;
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'audit',password:'test'})});
 assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await new Promise(r=>app.close(r));db.close();rmSync(root,{recursive:true,force:true})});
async function api(path,method='GET',body,status=200){
 const r=await fetch(base+'/api'+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,status,path+': '+JSON.stringify(data));return data;
}
async function fixture(fields=[]){
 const n=++seq;
 const voltage=await api('/voltage-levels','POST',{code:'V'+n,name:'110kV'},201);
 const line=await api('/lines','POST',{line_code:'L'+n,name:'线路'+n,voltage_level_id:voltage.id},201);
 const physical=await api('/physical-towers','POST',{tower_code:'T'+n},201);
 const tower=await api('/logical-towers','POST',{logical_code:'LT'+n,line_id:line.id,physical_tower_id:physical.id,tower_no:'#1',sort_rank:1},201);
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'U'+n,name:'套'},201);
 const op=await api('/dictionary-items','POST',{type_id:'operation',code:'O'+n,name:'安装防鸟装置',work_target_type:'line',fields},201);
 const source=await api('/dictionary-items','POST',{type_id:'source',code:'S'+n,name:'巡视'},201);
 const body={idempotency_key:'B'+n,work_target_type:'line',operation_id:op.id,unit_id:unit.id,target_object:'横担',quantity:'2',completion_standard:'按图安装验收',problem_description:'鸟害风险',source:{type_id:source.id,proposed_by:'班组',discovered_on:'2026-10-29'},rows:[{logical_tower_id:tower.id}]};
 return {n,voltage,line,physical,tower,unit,op,source,body};
}
async function demand(f){const b=await api('/demand-batches/submit','POST',f.body,201);return api('/demands/'+b.ids[0])}
async function approve(f,d){
 d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'现场核实'});
 const frame=await api('/frameworks','POST',{code:'F'+f.n,name:'框架',limit_yuan:'10000'},201);
 const ag=await api('/agreements','POST',{code:'A'+f.n,name:'协议',framework_id:frame.id,limit_yuan:'10000'},201);
 const cat=await api('/dictionary-items','POST',{type_id:'project_category',code:'CAT'+f.n,name:'修理类'},201);
 let p=await api('/projects','POST',{code:'P'+f.n,name:'项目',agreement_id:ag.id},201);
 p=await api('/projects/'+p.id+'/scopes','POST',{version:p.version,demand_id:d.id,quantity:'2'},201);
 p=await api('/projects/'+p.id+'/scopes/'+p.scopes[0].id,'PATCH',{version:p.version,unit_price_yuan:'100.01',price_source:'定额',price_date:'2026-10-29',tax_mode:'inclusive'});
 p=await api('/projects/'+p.id+'/preliminary-estimate','POST',{version:p.version,category_id:cat.id,amount_yuan:'200.02',basis:'修理项目初步估算资料'});
 p=await api('/projects/'+p.id+'/stock','POST',{version:p.version,reason:'储备入库'});
 p=await api('/projects/'+p.id+'/approve','POST',{version:p.version,reason:'批准'});
 return {p,d};
}
test('F03: attachment uploads retain bytes, metadata and hash; failed uploads leave no files',async()=>{
 const f=await fixture(),d=await demand(f),bytes=Buffer.from('附件验收记录\n');
 const headers={cookie,'x-owner-type':'demand','x-owner-id':d.id,'x-filename':encodeURIComponent('验收.txt'),'content-type':'text/plain'};
 const r=await fetch(base+'/api/attachments',{method:'POST',headers,body:bytes});
 assert.equal(r.status,201,await r.clone().text());const a=await r.json();
 const stored=one('SELECT * FROM attachments WHERE id=?',a.id);
 assert.equal(stored.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(stored.bytes,bytes.length);
 const downloaded=await fetch(base+'/api/attachments/'+a.id,{headers:{cookie}});
 assert.equal((await fetch(base+'/api/attachments/'+a.id)).status,401);
 assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
 const count=readdirSync(join(root,'attachments')).length;
 const failed=await fetch(base+'/api/attachments',{method:'POST',headers,body:Buffer.alloc(0)});
 assert.equal(failed.status,422);assert.equal(readdirSync(join(root,'attachments')).length,count);
 // A database failure after writing the file must clean it up as well.
 db.exec("CREATE TRIGGER reject_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'test failure'); END");
 try{const bad=await fetch(base+'/api/attachments',{method:'POST',headers,body:bytes});assert.equal(bad.status,409);assert.equal(readdirSync(join(root,'attachments')).length,count)}finally{db.exec('DROP TRIGGER reject_attachment')}
});
test('F02: stocked/approved scope facts and execution location stay immutable; meaningful changes are guarded',async()=>{
 const f=await fixture(),result=await approve(f,await demand(f));let {p,d}=result;
 let e=await api('/projects/'+p.id+'/executions','POST',{number:'EX',plan_type:'outage'},201);
 e=await api('/executions/'+e.id+'/items','POST',{version:e.version,scope_id:p.scopes[0].id,quantity:'1'},201);
 await api('/demands/'+d.id,'PATCH',{version:d.version,reason:'改成其他工作',target_object:'绝缘子',quantity:'1'},409);
 await api('/demands/'+d.id,'PATCH',{version:d.version,reason:'缩小需求数量',quantity:'1'},409);
 await api('/demands/'+d.id,'PATCH',{version:d.version,reason:'改变验收范围',completion_standard:'更换绝缘子验收'},409);
 await api('/demands/'+d.id+'/verify','POST',{version:d.version,reason:'撤销已有批准范围',status:'cancelled'},409);
 const moved=await api('/physical-towers','POST',{tower_code:'MOVED'+f.n},201);
 await api('/logical-towers/'+f.tower.id,'PATCH',{version:1,physical_tower_id:moved.id,change_kind:'correction',reason:'实体关联纠错'});
 await api('/demands/'+d.id+'/revalidate-location','POST',{version:d.version,reason:'批准后重新定位'},409);
 let second=await api('/projects/'+p.id+'/executions','POST',{number:'EX2',plan_type:'non_outage'},201);
 second=await api('/executions/'+second.id+'/items','POST',{version:second.version,scope_id:p.scopes[0].id,quantity:'1'},201);
 assert.equal(second.items[0].actual_physical_tower_id,f.physical.id,'new execution still uses approved physical identity');
 d=await api('/demands/'+d.id,'PATCH',{version:d.version,reason:'补充风险说明',problem_description:'补充现场风险记录'});
 const pd=await api('/projects/'+p.id),ex=await api('/executions/'+e.id);
 assert.equal(pd.scopes[0].demand_snapshot.problem_description,'鸟害风险');
 assert.equal(ex.items[0].target_object,'横担');assert.equal(ex.items[0].unit_snapshot,'套');
 assert.equal(ex.items[0].actual_physical_tower_id,f.physical.id);
 const snapshot=JSON.parse(pd.events.find(x=>x.stage==='approved').snapshot_json);
 assert.equal(snapshot.scopes[0].demand_snapshot.target_object,'横担');
});
test('F04: explicit location revalidation repairs pending demand and preserves old location history',async()=>{
 const f=await fixture();let d=await demand(f);
 const p2=await api('/physical-towers','POST',{tower_code:'NEW'+f.n},201);
 await api('/logical-towers/'+f.tower.id,'PATCH',{version:1,physical_tower_id:p2.id,change_kind:'correction',reason:'实体纠错'});
 await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'核实'},409);
 await api('/demands/'+d.id+'/revalidate-location','POST',{version:d.version,reason:' '},422);
 d=await api('/demands/'+d.id+'/revalidate-location','POST',{version:d.version,reason:'现场确认新实体'});
 assert.equal(d.observed_physical_tower_id,p2.id);assert.equal(d.status,'pending');
 assert.equal(JSON.parse(d.revisions[0].snapshot_json).observed_physical_tower_id,f.physical.id);
 d=await api('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'重新核实'});assert.equal(d.status,'active');
});
test('F05: drafts list, reload, update with conflicts and submit using same batch identity',async()=>{
 const f=await fixture();let draft=await api('/demand-batches/drafts','POST',f.body,201);
 assert.ok((await api('/demand-batches?status=draft')).some(x=>x.id===draft.id));
 const loaded=await api('/demand-batches/'+draft.id);assert.equal(JSON.parse(loaded.draft_json).rows[0].logical_tower_id,f.tower.id);
 draft=await api('/demand-batches/'+draft.id,'PATCH',{version:draft.version,draft:{...f.body,quantity:'3'}});
 await api('/demand-batches/'+draft.id,'PATCH',{version:1,draft:f.body},409);
 const payload={...JSON.parse(draft.draft_json),draft_id:draft.id,draft_version:draft.version};
 const submitted=await api('/demand-batches/submit','POST',payload,201);assert.equal(submitted.batch_id,draft.id);
 assert.equal((await api('/demand-batches/submit','POST',payload,201)).batch_id,draft.id);
 assert.equal((await api('/demand-batches?status=draft')).some(x=>x.id===draft.id),false);
 assert.equal(one('SELECT COUNT(*) n FROM demands WHERE batch_id=?',draft.id).n,1);
});
test('F06: custom field definitions validate types, persist per-row values and retain historical templates',async()=>{
 const fields=[{key:'phase',label:'相位',type:'select',required:true,options:['A','B','C']},{key:'height',label:'高度',type:'number',required:false}];
 const f=await fixture(fields);
 await api('/demand-batches/submit','POST',f.body,422);
 await api('/demand-batches/submit','POST',{...f.body,custom_fields:{phase:'D'}},422);
 f.body.custom_fields={phase:'A',height:12.5};f.body.rows[0].custom_fields={phase:'B'};
 let d=await demand(f);assert.deepEqual(d.custom_fields,{phase:'B',height:12.5});
 assert.deepEqual(d.field_definitions,fields);
 await api('/dictionary-items/'+f.op.id,'PATCH',{version:1,fields:[{key:'phase',label:'相别新版',type:'text',required:true}]});
 d=await api('/demands/'+d.id);assert.equal(d.field_definitions[0].label,'相位');
 await api('/demands/'+d.id,'PATCH',{version:d.version,custom_fields:{phase:'D'},reason:'错误数据'},422);
 await api('/dictionary-items','POST',{type_id:'operation',code:'BAD'+f.n,name:'无效模板',fields:[{key:'x',label:'重复',type:'text'},{key:'x',label:'重复2',type:'text'}]},422);
});
test('F07: four-decimal quantities survive demands, defaults, estimates, execution completion and export',async()=>{
 const f=await fixture();f.body.quantity='0.0001';let d=await demand(f);assert.equal(d.quantity_scaled,1);
 const op=await api('/dictionary-items/'+f.op.id,'PATCH',{version:1,default_quantity:'0.0001'});assert.equal(op.default_quantity_scaled,1);
 const exported=await fetch(base+'/api/demands/export.xlsx',{headers:{cookie}});
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await exported.arrayBuffer()));
 const row=book.worksheets[0].getRows(2,book.worksheets[0].rowCount-1).find(row=>row.getCell(1).value===d.demand_no);assert.equal(row.getCell(7).value,0.0001);
 const {lineEstimate}=await import('../server/projects.mjs');assert.equal(lineEstimate({quantity_scaled:1,unit_price_fen:15000}),2);assert.equal(lineEstimate({quantity_scaled:1,unit_price_fen:4999}),0);
 const g=await fixture(),r=await approve(g,await demand(g));
 let e=await api('/projects/'+r.p.id+'/executions','POST',{number:'FINE',plan_type:'outage'},201);
 e=await api('/executions/'+e.id+'/items','POST',{version:e.version,scope_id:r.p.scopes[0].id,quantity:'0.0001'},201);
 e=await api('/executions/'+e.id+'/start','POST',{version:e.version,reason:'执行'});
 e=await api('/executions/'+e.id+'/items/'+e.items[0].id+'/complete','POST',{quantity:'0.0001',occurred_on:'2026-10-29',evidence:'验收',idempotency_key:'fine'},201);
 assert.equal(e.items[0].completed_quantity_scaled,1);
 await api('/demand-batches/submit','POST',{...f.body,idempotency_key:'too-fine',quantity:'0.00001'},422);
});
test('draft writes and batch replays enforce ownership; viewers cannot access draft content',async()=>{
 const f=await fixture(),draft=await api('/demand-batches/drafts','POST',f.body,201);
 const admin=one('SELECT * FROM users WHERE username=?','audit');
 async function loginRole(role){
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('draft-'+role,'draft-'+role,admin.password_hash,role,'active',new Date().toISOString());
  const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'draft-'+role,password:'test'})});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];
 }
 const editor=await loginRole('editor'),viewer=await loginRole('viewer');
 for(const [who,path,method,body,expected] of [
  [editor,'/demand-batches/'+draft.id,'GET',undefined,403],
  [editor,'/demand-batches/'+draft.id,'PATCH',{version:1,draft:f.body},403],
  [editor,'/demand-batches/submit','POST',{...f.body,draft_id:draft.id,draft_version:1},403],
  [viewer,'/demand-batches?status=draft','GET',undefined,403]
 ]){const res=await fetch(base+'/api'+path,{method,headers:{cookie:who,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(res.status,expected);await res.text()}
 const payload={...f.body,draft_id:draft.id,draft_version:1};await api('/demand-batches/submit','POST',payload,201);
 const replay=await fetch(base+'/api/demand-batches/submit',{method:'POST',headers:{cookie:editor,'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(replay.status,403);await replay.text();
});
