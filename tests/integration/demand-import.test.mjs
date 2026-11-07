import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import ExcelJS from 'exceljs';

const root=mkdtempSync(join(tmpdir(),'sd-demand-import-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'import-admin',SD_ADMIN_PASSWORD:'test'}});
const {db,one,all,transaction}=await import('../../server/database/index.mjs');
const {saveOperation}=await import('../../server/database/repositories/operation-profiles.mjs');
const {app}=await import('../../server/main.mjs');
const {demandTemplate,parseDemandWorkbook,demandProblemWorkbook}=await import('../../server/infrastructure/excel/demand-workbook.mjs');
app.listen(0,'127.0.0.1');await once(app,'listening');const origin='http://127.0.0.1:'+app.address().port;
let cookie='';
async function request(path,body,expected=200,method='POST'){
 const r=await fetch(origin+'/api'+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();
 assert.equal(r.status,expected,path+': '+JSON.stringify(data).slice(0,1200));if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return data;
}
const time=new Date().toISOString(),admin=one("SELECT * FROM users WHERE role='admin'"),unit='IMPORT-UNIT',op='IMPORT-OP',op2='IMPORT-OP2',source='IMPORT-SOURCE';
transaction(()=>{
 db.prepare('INSERT INTO voltage_levels(id,code,name) VALUES(?,?,?)').run('import-v','import-v','110kV');
 db.prepare('INSERT INTO transmission_lines(id,line_code,voltage_level_id,name) VALUES(?,?,?,?)').run('import-line','import-line','import-v','导入合成线');
 db.prepare('INSERT INTO physical_towers(id,tower_code) VALUES(?,?)').run('import-physical','合成实体');
 const tower=db.prepare("INSERT INTO logical_towers(id,logical_code,line_id,physical_tower_id,tower_no,sort_rank,status) VALUES(?,?,'import-line','import-physical',?,?,'active')");
 for(let i=1;i<=5000;i++)tower.run('import-t'+i,'import-code'+i,'#'+String(i).padStart(4,'0'),i);
 const item=db.prepare(`INSERT INTO dictionary_items
 (id,type_id,code,name,status,sort_order,version,fields_json,updated_at)
 VALUES(?,?,?,?,'active',1,1,'[]',?)`);
 item.run(unit,'unit',unit,'导入测试套',time);
 item.run(source,'source',source,'导入测试巡视',time);
 for(const [id,name,fields,locs] of [
  [op,'导入安装','[{"key":"phase","label":"相位","type":"select","required":true,"options":["A","B"]}]',['tower']],
  [op2,'导入修复','[]',['tower','span']]
 ]){
  const snapshot={id,type_id:'operation',code:id,name,status:'active',sort_order:1,
   version:1,work_target_type:'line',default_unit_id:unit,default_quantity_scaled:null,
   completion_standard:id===op?'安装并验收':'修复并验收',fields_json:fields,updated_at:time,
   operation_profile:{location_kinds:locs,default_location_kind:'tower',
    default_target_object:'',entry_hint:''}};
  saveOperation(snapshot);
  db.prepare('INSERT INTO operation_versions VALUES(?,?,?,?,?,?)').run(
   randomUUID(),id,1,JSON.stringify(snapshot),admin.id,time);
 }
 db.prepare("INSERT INTO line_spans VALUES(?,?,'import-t1','import-t2','active',1,?,?,?)").run('import-span','import-line',admin.id,time,time);
});
const common={work_target_type:'line',operation_id:op2,unit_id:unit,quantity:'2',target_object:'横担',completion_standard:'验收',problem_description:'合成测试问题',sources:[{source_key:'LY001',type_id:source,proposed_by:'测试班组',discovered_on:'2026-11-01'}]};
const row=(n,extra={})=>({row_key:'MX'+n,logical_tower_id:'import-t'+n,...extra});

test('5000-row workbook and transactional import, validation, drafts, roles, retries and restart',async()=>{
 try{
  await request('/auth/login',{username:'import-admin',password:'test'});
  const otherUnit=await request('/dictionary-items',{type_id:'unit',name:'操作定义测试处'},201);
  await request('/dictionary-items',{type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},name:'缺单位',work_target_type:'line'},422);
  await request('/dictionary-items',{type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},name:'缺对象',default_unit_id:unit},422);
  await request('/dictionary-items',{type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},name:'不允许两者适用',work_target_type:'both',default_unit_id:unit},422);
  await request('/dictionary-items',{type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},name:'误用来源作为单位',work_target_type:'line',default_unit_id:source},422);
  const physicalOperation=await request('/dictionary-items',{type_id:'operation',operation_profile:{location_kinds:['tower'],default_location_kind:'tower',default_target_object:'',entry_hint:''},name:'定义测试基础加固',work_target_type:'physical',default_unit_id:otherUnit.id},201);
  const spanOp=await request('/dictionary-items',{type_id:'operation',name:'档距范围定义测试',work_target_type:'line',default_unit_id:unit,operation_profile:{location_kinds:['span'],default_location_kind:'span',default_target_object:'导线',entry_hint:'核对两端编号'}},201);
  const spanPreview=await request('/demand-batches/preview',{...common,operation_id:spanOp.id,rows:[{row_key:'span-derived',span_id:'import-span'}]});
  assert.equal(spanPreview.issues.length,0);assert.equal(spanPreview.rows[0].location_kind,'span');
  const wrongLocation=await request('/demand-batches/preview',{...common,operation_id:spanOp.id,rows:[row(21,{location_kind:'tower'})]});
  assert.ok(wrongLocation.issues.some(i=>i.field==='作业位置'));
  await request('/demand-batches/submit',{...common,operation_id:spanOp.id,idempotency_key:'wrong-operation-position',rows:[row(21,{location_kind:'tower'})]},422);
  await assert.rejects(()=>demandTemplate({operation_ids:[spanOp.id],location_kind:'tower'}),{status:422});
  await assert.rejects(()=>demandTemplate({operation_ids:[spanOp.id,op],include_positions:true,line_ids:['import-line'],location_kind:'tower'}),{status:422});
  const originalProfile=JSON.parse(one('SELECT snapshot_json FROM operation_versions WHERE operation_id=? AND version=1',spanOp.id).snapshot_json).operation_profile;
  await request('/dictionary-status/operation',{rows:[{id:spanOp.id,version:1}],status:'inactive'},200);
  const spanInactive=(await request('/dictionary-items',undefined,200,'GET')).find(i=>i.id===spanOp.id);assert.deepEqual(spanInactive.operation_profile,originalProfile);
  await request('/dictionary-status/operation',{rows:[{id:spanOp.id,version:2}],status:'active'},200);
  assert.deepEqual(JSON.parse(one('SELECT snapshot_json FROM operation_versions WHERE operation_id=? AND version=1',spanOp.id).snapshot_json).operation_profile,originalProfile);
  const derived=await request('/demand-batches/preview',{...common,unit_id:undefined,work_target_type:undefined,rows:[row(21)]});
  assert.equal(derived.issues.length,0);assert.equal(derived.rows[0].unit_id,unit);assert.equal(derived.rows[0].work_target_type,'line');
  const mismatch=await request('/demand-batches/preview',{...common,unit_id:otherUnit.id,work_target_type:'physical',rows:[row(21)]});
  assert.ok(mismatch.issues.some(x=>x.field==='单位'));assert.ok(mismatch.issues.some(x=>x.field==='作业对象'));
  await request('/demand-batches/submit',{...common,unit_id:otherUnit.id,idempotency_key:'wrong-operation-unit',rows:[row(21)]},422);
  const physical=await request('/demand-batches/preview',{...common,operation_id:physicalOperation.id,unit_id:undefined,work_target_type:undefined,rows:[row(22)]});
  assert.equal(physical.issues.length,0);assert.equal(physical.rows[0].unit_id,otherUnit.id);assert.equal(physical.rows[0].work_target_type,'physical');
  const template=await demandTemplate({line_ids:['import-line'],operation_ids:[op],include_positions:true,quantity:'2',target_object:'横担',problem_description:'专项发现',sources:common.sources});
  const w=new ExcelJS.Workbook();await w.xlsx.load(template);
  assert.equal(w.getWorksheet('需求明细').actualRowCount,5001);assert.equal(w.getWorksheet('需求明细').getCell('E2').value,'#0001');
  assert.ok(w.getWorksheet('需求明细').getCell('H2').dataValidation.formulae.length);
  assert.match(w.getWorksheet('需求明细').getCell('D2').dataValidation.formulae[0],/DemandOperationProfiles/);assert.equal(w.getWorksheet('需求明细').getCell('K2').dataValidation.type,'custom');
  assert.ok(w.getWorksheet('操作定义'));assert.ok(w.getWorksheet('操作定义').getRow(2).values.includes('杆塔'));
  assert.ok(w.definedNames.getRanges('DemandOperations').ranges.length);
  assert.equal(one('SELECT COUNT(*) n FROM demands').n,0,'template has no business writes');
  const sheet=w.getWorksheet('需求明细');
  for(let n=2;n<=5001;n++)sheet.getCell('Q'+n).value='A';
  const completedWorkbook=Buffer.from(await w.xlsx.writeBuffer());
  const parsed=await parseDemandWorkbook(completedWorkbook);
  assert.equal(parsed.rows.length,5000);assert.equal(parsed.summary.invalid,0,JSON.stringify(parsed.issues.slice(0,5)));assert.equal(parsed.sources.length,1);
  assert.equal(one('SELECT COUNT(*) n FROM demands').n,0,'parse and preview must not create demands');
  const upload=new FormData();upload.set('file',new Blob([completedWorkbook]),'5000条需求.xlsx');upload.set('options',JSON.stringify({common:{completion_standard:'长共同说明'.repeat(3000)}}));
  const httpParse=await fetch(origin+'/api/demand-import/parse',{method:'POST',headers:{cookie},body:upload});assert.equal(httpParse.status,200);const httpResult=await httpParse.json();assert.equal(httpResult.rows.length,5000);assert.equal(httpResult.summary.invalid,0,'large options use form body rather than HTTP headers');
  const failed={...common,idempotency_key:'rollback-last-row',rows:Array.from({length:5000},(_,i)=>row(i+1))};failed.rows[4999].quantity='0';
  const invalid=await request('/demand-batches/preview',failed);assert.equal(invalid.summary.invalid,1);assert.equal(invalid.issues[0].row,5000);
  await request('/demand-batches/submit',failed,422);assert.equal(one('SELECT COUNT(*) n FROM source_records').n,0);assert.equal(one('SELECT COUNT(*) n FROM demand_batches').n,0);
  await request('/demand-batches/preview',{...common,rows:Array.from({length:5001},(_,i)=>row(i+1))},422);
  const multi={...common,sources:[...common.sources,{source_key:'LY002',type_id:source,proposed_by:'另一班组',discovered_on:'2026-11-02'}],rows:[row(1,{operation_id:op,custom_fields:{phase:'A'},source_keys:['LY001']}),row(2,{source_keys:['LY002']}),row(1,{row_key:'MX-OTHER',target_object:'另一部位',source_keys:['LY001','LY002']})]};
  const checked=await request('/demand-batches/preview',multi);assert.equal(checked.issues.length,0);
  const mixed=await request('/demand-batches/submit',{...multi,idempotency_key:'mixed-ops'},201);
  assert.equal(mixed.count,3);assert.equal(one('SELECT COUNT(*) n FROM source_records').n,2);assert.equal(one('SELECT COUNT(*) n FROM demand_sources').n,4);
  assert.deepEqual(all('SELECT DISTINCT operation_id FROM demands ORDER BY operation_id').map(x=>x.operation_id),[op,op2].sort());
  const adopted=await request('/demands/'+mixed.ids[0],undefined,200,'GET');
  await request('/demands/'+adopted.id,{version:adopted.version,work_target_type:'physical'},422,'PATCH');
  await request('/demands/'+adopted.id,{version:adopted.version,operation_id:spanOp.id},422,'PATCH');
  assert.equal((await request('/demands/'+adopted.id,undefined,200,'GET')).operation_version,adopted.operation_version);
  const changedOperation=await request('/dictionary-items/'+op,{version:1,work_target_type:'physical',default_unit_id:otherUnit.id},200,'PATCH');
  const oldTemplate=await parseDemandWorkbook(completedWorkbook);
  assert.ok(oldTemplate.rows[0].issues.some(i=>i.field==='操作模板'),'old Excel templates must reveal changed operation definitions before adopting a new unit');
  const unchanged=await request('/demands/'+mixed.ids[0],undefined,200,'GET');
  for(const key of ['unit_id','unit_version','unit_snapshot','work_target_type','operation_version','quantity_scaled'])assert.equal(unchanged[key],adopted[key],'changing operation definitions must preserve historical '+key);
  await request('/dictionary-items/'+op,{version:changedOperation.version,work_target_type:'line',default_unit_id:unit},200,'PATCH');
  const stale=await request('/demand-batches/preview',{...common,rows:[row(4)]});
  db.prepare('UPDATE logical_towers SET version=version+1 WHERE id=?').run('import-t4');
  await request('/demand-batches/submit',{...common,rows:stale.rows,idempotency_key:'stale-location'},422);
  const config=await request('/demand-batches/preview',{...common,rows:[row(5)]});await request('/dictionary-items/'+op2,{version:1,name:'导入修复更新'},200,'PATCH');
  await request('/demand-batches/submit',{...common,rows:config.rows,idempotency_key:'stale-config'},422);
  const broken={...common,rows:[row(6,{operation_id:op,custom_fields:{phase:'INVALID'},quantity:'2套'}),row(7,{span_id:'import-span',span_version:1,location_kind:'span'})]};
  const bad=await request('/demand-batches/preview',broken);assert.equal(bad.rows[0].custom_fields.phase,'INVALID','invalid input is retained');assert.ok(bad.rows[0].issues.length>=2);
  const problem=await demandProblemWorkbook(broken),roundTrip=await parseDemandWorkbook(problem);assert.equal(roundTrip.rows[0].quantity,'2套');assert.equal(roundTrip.rows[0].custom_fields.phase,'INVALID');assert.equal(roundTrip.rows[1].span_id,'import-span');
  const date=await request('/demand-batches/preview',{...common,sources:[{...common.sources[0],discovered_on:'2026-02-30'}],rows:[row(8)]});assert.ok(date.issues.some(x=>x.field==='发现／提出日期'));
  const duplicate=await request('/demand-batches/preview',{...common,rows:[row(9),row(9,{row_key:'MX9-again'})]});assert.equal(duplicate.summary.invalid,2);
  const incomplete={rows:[row(10)],sources:[]};const draft=await request('/demand-batches/drafts',incomplete,201);
  await request('/demand-batches/'+draft.id,{version:1,draft:{...common,rows:[row(10)]}},200,'PATCH');
  await request('/demand-batches/'+draft.id,{version:1,draft:incomplete},409,'PATCH');
  await request('/demand-batches/'+draft.id,{version:1,reason:'旧版本删除'},409,'DELETE');await request('/demand-batches/'+draft.id,{version:2,reason:'测试误建草稿'},200,'DELETE');
  const history=await request('/demand-batches?status=deleted',undefined,200,'GET');assert.equal(history.length,1);assert.equal(JSON.parse(history[0].before.draft_json).rows[0].logical_tower_id,'import-t10');
  const mapped=new ExcelJS.Workbook(),external=mapped.addWorksheet('班组报表');external.addRow(['班组汇总说明']);external.addRow(['自定义线名','自定义塔号','自定义数量']);external.addRow(['导入合成线','#0014','1.2345']);
  const mappedResult=await parseDemandWorkbook(Buffer.from(await mapped.xlsx.writeBuffer()),{sheet:'班组报表',header_row:2,mapping:{1:'line_name',2:'tower_no',3:'quantity'},sources:common.sources,common:{location_kind:'tower',work_target_type:'line',operation_id:op2,unit_id:unit,target_object:'映射部位',problem_description:'映射问题',completion_standard:'验收',source_refs:'LY001'}});
  assert.equal(mappedResult.issues.length,0);assert.equal(mappedResult.rows[0].quantity,'1.2345');assert.equal(mappedResult.rows[0].sheet_row,3);
  external.getCell('D2').value='操作类型';external.getCell('D3').value='导入安装';
  const keepExplicit=await parseDemandWorkbook(Buffer.from(await mapped.xlsx.writeBuffer()),{sheet:'班组报表',header_row:2,mapping:{1:'line_name',2:'tower_no',3:'quantity'},sources:common.sources,common:{location_kind:'tower',work_target_type:'line',operation_id:op2,unit_id:unit,target_object:'映射部位',problem_description:'映射问题',completion_standard:'验收',source_refs:'LY001'}});
  assert.equal(keepExplicit.rows[0].operation_id,op,'fill-empty common defaults never overwrite an explicitly filled operation name');
  external.getCell('C3').value={formula:'1+1',result:2};const formula=await parseDemandWorkbook(Buffer.from(await mapped.xlsx.writeBuffer()),{sheet:'班组报表',header_row:2,mapping:{1:'line_name',2:'tower_no',3:'quantity'},sources:common.sources});assert.ok(formula.rows[0].issues.some(i=>i.message.includes('公式')));
  const adminCookie=cookie;
  for(const role of ['viewer','editor','verifier']){
   const id='import-'+role,token=id+'-token';db.prepare('INSERT INTO users(id,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',time);
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00.000Z',time);cookie='sd_session='+token;
   await request('/demand-batches/preview',{...common,rows:[row(11)]},role==='editor'?200:403);
   const spanList=await request('/demand-entry/spans?line_id=import-line&search=0002',undefined,role==='editor'?200:403,'GET');if(role==='editor'){assert.equal(spanList.total,1);assert.equal(spanList.rows[0].id,'import-span')}
   await request('/ledger/lines',undefined,403,'GET');
   const r=await fetch(origin+'/api/demand-import/template',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,role==='editor'?200:403);
  }
  cookie=adminCookie;
  // Force a late write failure after several inserts: every demand/source/audit must roll back.
  const counts=()=>['demands','source_records','audit_events','demand_batches'].map(t=>one('SELECT COUNT(*) n FROM '+t).n);
  const before=counts();db.exec("CREATE TRIGGER demand_import_failure BEFORE INSERT ON demands WHEN NEW.target_object='late-write-failure' BEGIN SELECT RAISE(ABORT,'test late failure'); END");
  await request('/demand-batches/submit',{...common,idempotency_key:'late-failure',rows:[row(12),row(13,{target_object:'late-write-failure'})]},409);db.exec('DROP TRIGGER demand_import_failure');assert.deepEqual(counts(),before);
  const large={...common,idempotency_key:'full-5000',rows:Array.from({length:5000},(_,i)=>row(i+1,{target_object:'5000验收部位'}))};
  const start=performance.now(),result=await request('/demand-batches/submit',large,201);const elapsed=performance.now()-start;
  assert.equal(result.count,5000);assert.equal(result.row_results.length,5000);assert.equal(new Set(result.ids).size,5000);
  const replay=await request('/demand-batches/submit',large,201);assert.equal(replay.batch_id,result.batch_id);assert.deepEqual(replay.row_results,result.row_results);assert.equal(one('SELECT COUNT(*) n FROM demands').n,5003);
  const resultFile=await fetch(origin+'/api/demand-batches/'+result.batch_id+'/result.xlsx',{headers:{cookie}});assert.equal(resultFile.status,200);const resultBook=new ExcelJS.Workbook();await resultBook.xlsx.load(Buffer.from(await resultFile.arrayBuffer()));assert.equal(resultBook.getWorksheet('提交结果').actualRowCount,5001);
  const simultaneous={...common,idempotency_key:'concurrent-retry',rows:[row(20,{target_object:'并发测试独立部位'})]};const [first,second]=await Promise.all([request('/demand-batches/submit',simultaneous,201),request('/demand-batches/submit',simultaneous,201)]);assert.equal(first.batch_id,second.batch_id);assert.equal(one('SELECT COUNT(*) n FROM demands').n,5004);
  await request('/demand-batches/submit',{...large,problem_description:'不同内容'},409);
  const profileTemplate=await demandTemplate({operation_ids:[spanOp.id],line_ids:['import-line'],include_positions:true,quantity:'1',completion_standard:'核对验收',problem_description:'模板版本核对',sources:common.sources});
  await request('/dictionary-items/'+spanOp.id,{version:3,operation_profile:{...originalProfile,location_kinds:['tower','span'],default_location_kind:'tower'}},200,'PATCH');
  const oldProfileTemplate=await parseDemandWorkbook(profileTemplate);assert.ok(oldProfileTemplate.issues.some(i=>i.field==='操作模板'),'profile-only changes invalidate old template adoption');
  const operationItems=(await request('/dictionary-items',undefined,200,'GET')).filter(i=>i.type_id==='operation');
  await request('/dictionary-order/operation',{rows:operationItems.reverse().map(i=>({id:i.id,version:i.version}))});
  const orderedItems=await request('/dictionary-items',undefined,200,'GET');for(const original of operationItems)assert.deepEqual(orderedItems.find(i=>i.id===original.id).operation_profile,original.operation_profile,'reordering must preserve operation profiles');
  const persisted=execFileSync(process.execPath,['--input-type=module','-e',"const {one,db}=await import('./server/database/index.mjs');process.stdout.write(JSON.stringify(one('SELECT COUNT(*) n FROM demands')));db.close()"],{env:{...process.env},encoding:'utf8'});assert.equal(JSON.parse(persisted).n,5004);
  console.log('DEMAND_IMPORT_5000_OK atomic submit '+Math.round(elapsed)+'ms; template, field rules, history, role checks, retry and reopen verified');
 }finally{await new Promise(resolve=>app.close(resolve));db.close();rmSync(root,{recursive:true,force:true})}
});
