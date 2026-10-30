import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';

const data=mkdtempSync(join(tmpdir(),'sd-reference-prices-'));
process.env.DATA_DIR=data;
process.env.SD_DISABLE_LISTEN='1';
const {db,one}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let base,cookie;
before(async()=>{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'price-admin',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 base='http://127.0.0.1:'+app.address().port;
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({username:'price-admin',password:'test'})});
 assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await new Promise(r=>app.close(r));db.close();rmSync(data,{recursive:true,force:true})});
async function api(path,method='GET',body,expected=200,token=cookie){
 const r=await fetch(base+'/api'+path,{method,headers:{cookie:token,'content-type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body)});
 const result=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(result));return result;
}
test('W4 reference catalog: compatible selection, immutable price revision, explicit snapshot, approval freeze',async()=>{
 assert.equal(one('PRAGMA user_version').user_version,109);
 const voltage=await api('/voltage-levels','POST',{code:'PRICE110',name:'110kV'},201);
 const v220=await api('/voltage-levels','POST',{code:'PRICE220',name:'220kV'},201);
 const line=await api('/lines','POST',{line_code:'PRICE-LINE',name:'单价试验线',voltage_level_id:voltage.id},201);
 const tower=await api('/physical-towers','POST',{tower_code:'PRICE-TOWER'},201);
 const logic=await api('/logical-towers','POST',{
  logical_code:'PRICE-LOGIC',line_id:line.id,physical_tower_id:tower.id,tower_no:'#1',sort_rank:1
 },201);
 const op=await api('/dictionary-items','POST',{type_id:'operation',code:'PRICE-OP',name:'更换绝缘子',work_target_type:'line'},201);
 const otherOp=await api('/dictionary-items','POST',{type_id:'operation',code:'PRICE-OTHER-OP',name:'防腐'},201);
 const unit=await api('/dictionary-items','POST',{type_id:'unit',code:'PRICE-UNIT',name:'套'},201);
 const source=await api('/dictionary-items','POST',{type_id:'source',code:'PRICE-SOURCE',name:'巡视'},201);
 const category=await api('/dictionary-items','POST',{type_id:'project_category',code:'PRICE-CAT',name:'检修项目'},201);
 const batch=await api('/demand-batches/submit','POST',{
  idempotency_key:'price-demand-10',work_target_type:'line',operation_id:op.id,unit_id:unit.id,
  target_object:'绝缘子',quantity:'10',completion_standard:'验收',problem_description:'按计划更换',
  source:{type_id:source.id,proposed_by:'班组',discovered_on:'2026-10-29'},rows:[{logical_tower_id:logic.id}]
 },201);
 let demand=await api('/demands/'+batch.ids[0]);
 demand=await api('/demands/'+demand.id+'/verify','POST',{version:demand.version,status:'active',reason:'现场核实10套'});
 const fw=await api('/frameworks','POST',{code:'PRICE-FW',name:'单价引用年度框架',fiscal_year:2026,limit_yuan:'20000'},201);
 const ag=await api('/agreements','POST',{code:'PRICE-AG',name:'协议',framework_id:fw.id,limit_yuan:'15000'},201);
 let project=await api('/projects','POST',{code:'PRICE-PROJ',name:'绝缘子储备',framework_id:fw.id},201);
 project=await api('/projects/'+project.id+'/scopes','POST',{version:project.version,demand_id:demand.id,quantity:'10'},201);
 const scope=project.scopes[0];
 const payload={code:'PRICE-INS-110',title:'110kV绝缘子更换',operation_id:op.id,unit_id:unit.id,
  voltage_level_id:voltage.id,plan_type:'outage',specification:'常规更换',
  unit_price_yuan:'100.00',price_source:'历史工程测算',price_date:'2026-10-29',
  tax_mode:'inclusive',effective_on:'2026-10-29',basis:'十套模拟测算'};
 await api('/reference-prices','POST',{...payload,unit_price_yuan:'0'},422);
 const reference=await api('/reference-prices','POST',payload,201);
 assert.equal(reference.version,1);
 assert.equal(reference.unit_price_fen,10000);
 assert.equal(reference.operation_name,'更换绝缘子');
 assert.equal((await api('/reference-prices?status=active')).length,1);
 const wrongOperation=await api('/reference-prices','POST',{
  ...payload,code:'PRICE-WRONG-OP',operation_id:otherOp.id
 },201);
 const wrongVoltage=await api('/reference-prices','POST',{
  ...payload,code:'PRICE-WRONG-220',voltage_level_id:v220.id
 },201);
 const options=await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price-options');
 assert.deepEqual(options.map(x=>x.id),[reference.id],'only same operation, unit and voltage can be suggested');
 await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price','POST',{
  version:project.version,catalog_id:wrongOperation.id,reference_price_version_id:wrongOperation.reference_price_version_id
 },422);
 await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price','POST',{
  version:project.version,catalog_id:wrongVoltage.id,reference_price_version_id:wrongVoltage.reference_price_version_id
 },422);
 project=await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price','POST',{
  version:project.version,catalog_id:reference.id,reference_price_version_id:reference.reference_price_version_id
 });
 assert.equal(project.scopes[0].unit_price_fen,10000);
 assert.equal(project.scopes[0].reference_price_version_id,reference.reference_price_version_id);
 assert.equal(project.estimate.known_total_fen,100000,'10 sets times 100 yuan');
 const v2=await api('/reference-prices/'+reference.id,'PATCH',{
  version:1,unit_price_yuan:'125',price_source:'最新报价',price_date:'2026-10-30',
  tax_mode:'inclusive',effective_on:'2026-10-30',basis:'最新估算依据',reason:'参考价格更新'
 });
 assert.equal(v2.version_no,2);
 assert.equal(project.scopes[0].unit_price_fen,10000,'catalog changes do not rewrite project estimate');
 await api('/reference-prices/'+reference.id,'PATCH',{
  version:1,unit_price_yuan:'130',price_source:'旧请求',price_date:'2026-10-30',
  tax_mode:'inclusive',effective_on:'2026-10-30',basis:'过时版本',reason:'过时版本'
 },409);
 await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price','POST',{
  version:project.version,catalog_id:reference.id,reference_price_version_id:reference.reference_price_version_id
 },409);
 project=await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price','POST',{
  version:project.version,catalog_id:reference.id,reference_price_version_id:v2.reference_price_version_id
 });
 assert.equal(project.estimate.known_total_fen,125000);
 assert.equal(project.scopes[0].reference_price_version_id,v2.reference_price_version_id);
 const versions=await api('/reference-prices/'+reference.id+'/versions');
 assert.equal(versions.length,2);
 assert.equal(versions[1].unit_price_fen,10000);
 assert.throws(()=>db.prepare('UPDATE reference_price_versions SET unit_price_fen=1 WHERE id=?').run(reference.reference_price_version_id),/历史参考单价版本不可修改/);
 assert.throws(()=>db.prepare('DELETE FROM reference_price_versions WHERE id=?').run(reference.reference_price_version_id),/历史参考单价版本不可删除/);
 project=await api('/projects/'+project.id+'/preliminary-estimate','POST',{
  version:project.version,category_id:category.id,amount_yuan:'1250',basis:'参考价格目录第2版及10套专业需求'
 });
 project=await api('/projects/'+project.id+'/stock','POST',{version:project.version,reason:'纳入正式储备'});
 project=await api('/projects/'+project.id+'/agreement','POST',{version:project.version,agreement_id:ag.id});
 project=await api('/projects/'+project.id+'/approve','POST',{version:project.version,reason:'核定正式预算'});
 const frozen=JSON.parse((await api('/projects/'+project.id+'/approval-versions'))[0].snapshot_json);
 assert.equal(frozen.scopes[0].reference_price_version_id,v2.reference_price_version_id);
 await api('/projects/'+project.id+'/scopes/'+scope.id+'/reference-price','POST',{
  version:project.version,catalog_id:reference.id,reference_price_version_id:v2.reference_price_version_id
 },409);
 await api('/reference-prices/'+reference.id+'/status','POST',{version:2,status:'inactive',reason:'新版本校核中'});
 const listed=await api('/reference-prices?status=inactive');
 assert.ok(listed.some(x=>x.id===reference.id));
 assert.equal((await api('/projects/'+project.id)).scopes[0].reference_price_version_id,v2.reference_price_version_id);
 const admin=one("SELECT * FROM users WHERE username='price-admin'");
 const token='readonly-price-test',t=new Date().toISOString();
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('reference-viewer','reference-viewer',admin.password_hash,'viewer','active',t);
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'reference-viewer','2099-01-01T00:00:00.000Z',t);
 await api('/reference-prices','POST',{...payload,code:'NOT-ALLOWED'},403,'sd_session='+token);
 assert.ok((await api('/reference-prices','GET',undefined,200,'sd_session='+token)).length>=1);
});
