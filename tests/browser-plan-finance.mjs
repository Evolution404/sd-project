import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright';

const root=mkdtempSync(join(tmpdir(),'sd-w5-ui-'));
const chrome=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){
 return await new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value))});
 });
}
async function ready(url){
 for(let i=0;i<100;i++){
  try{const result=await fetch(url);if(result.ok)return}catch{}
  await wait(100);
 }
 throw Error('Timeout connecting to '+url);
}
let apiServer,viteServer,browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{
  env:{...process.env,DATA_DIR:root,SD_ADMIN_USER:'w5-ui',SD_ADMIN_PASSWORD:'test'}
 });
 const apiPort=await port(),vitePort=await port();
 const backendUrl='http://127.0.0.1:'+apiPort;
 const uiUrl='http://127.0.0.1:'+vitePort;
 apiServer=spawn(process.execPath,['server/server.mjs'],{
  env:{...process.env,DATA_DIR:root,HOST:'127.0.0.1',PORT:String(apiPort)},
  stdio:['ignore','ignore','pipe']
 });
 let backendErrors='';apiServer.stderr.on('data',b=>backendErrors+=b.toString());
 await ready(backendUrl+'/api/health');
 viteServer=spawn('node',['node_modules/vite/bin/vite.js','--config','tests/vite-w5.config.ts','--port',String(vitePort),'--strictPort'],{
  env:{...process.env,W5_TEST_API_URL:backendUrl},
  stdio:['ignore','ignore','pipe']
 });
 let viteErrors='';viteServer.stderr.on('data',b=>viteErrors+=b.toString());
 await ready(uiUrl+'/tests/w5-ui.html');
 browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-first-run','--no-default-browser-check']});
 const context=await browser.newContext({viewport:{width:1360,height:900}});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 const fetchApi=async(path,method='GET',body,expected=200)=>{
  const response=await context.request.fetch(uiUrl+'/api'+path,{method,
   headers:body===undefined?{}:{'content-type':'application/json'},
   data:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  assert.equal(response.status(),expected,path+' '+JSON.stringify(data));
  return data;
 };
 await fetchApi('/auth/login','POST',{username:'w5-ui',password:'test'});
 const vl=await fetchApi('/voltage-levels','POST',{code:'W5VL',name:'220kV'},201);
 const line=await fetchApi('/lines','POST',{line_code:'W5-L',name:'W5计划测试线路',voltage_level_id:vl.id},201);
 const physical=await fetchApi('/physical-towers','POST',{tower_code:'W5-PH'},201);
 const tower=await fetchApi('/logical-towers','POST',{
  logical_code:'W5-LT',line_id:line.id,physical_tower_id:physical.id,tower_no:'#1',sort_rank:1
 },201);
 const unit=await fetchApi('/dictionary-items','POST',{type_id:'unit',code:'W5-UNIT',name:'套'},201);
 const op=await fetchApi('/dictionary-items','POST',{type_id:'operation',code:'W5-OP',name:'更换部件',work_target_type:'line'},201);
 const src=await fetchApi('/dictionary-items','POST',{type_id:'source',code:'W5-SRC',name:'巡视'},201);
 const category=await fetchApi('/dictionary-items','POST',{type_id:'project_category',code:'W5-CAT',name:'检修'},201);
 const batch=await fetchApi('/demand-batches/submit','POST',{
  idempotency_key:'w5-browser-one',work_target_type:'line',operation_id:op.id,unit_id:unit.id,
  target_object:'设备',quantity:'2',completion_standard:'验收合格',problem_description:'更换两套',
  source:{type_id:src.id,proposed_by:'试验',discovered_on:'2026-10-30'},rows:[{logical_tower_id:tower.id}]
 },201);
 let d=await fetchApi('/demands/'+batch.ids[0]);
 d=await fetchApi('/demands/'+d.id+'/verify','POST',{version:d.version,status:'active',reason:'现场核实'});
 const fw=await fetchApi('/frameworks','POST',{code:'W5-FW',name:'2026框架',fiscal_year:2026,limit_yuan:'1000'},201);
 const ag=await fetchApi('/agreements','POST',{code:'W5-AG',name:'协议',framework_id:fw.id,limit_yuan:'900'},201);
 let project=await fetchApi('/projects','POST',{code:'W5-PROJECT',name:'浏览器检修计划',framework_id:fw.id},201);
 project=await fetchApi('/projects/'+project.id+'/scopes','POST',{
  version:project.version,demand_id:d.id,quantity:'2'
 },201);
 project=await fetchApi('/projects/'+project.id+'/preliminary-estimate','POST',{
  version:project.version,category_id:category.id,amount_yuan:'200',basis:'两套报价'
 });
 project=await fetchApi('/projects/'+project.id+'/stock','POST',{version:project.version,reason:'入库'});
 project=await fetchApi('/projects/'+project.id+'/agreement','POST',{version:project.version,agreement_id:ag.id});
 project=await fetchApi('/projects/'+project.id+'/scopes/'+project.scopes[0].id,'PATCH',{
  version:project.version,unit_price_yuan:'100',price_source:'核准价',
  price_date:'2026-10-30',tax_mode:'inclusive'
 });
 project=await fetchApi('/projects/'+project.id+'/approve','POST',{version:project.version,reason:'批准'});
 let plan=await fetchApi('/projects/'+project.id+'/executions','POST',{
  number:'W5-PLAN',plan_type:'outage'
 },201);
 plan=await fetchApi('/executions/'+plan.id+'/items','POST',{
  version:plan.version,scope_id:project.scopes[0].id,quantity:'2'
 },201);
 await page.goto(uiUrl+'/tests/w5-ui.html?plan='+encodeURIComponent(plan.id));
 await page.getByRole('heading',{name:'检修计划结算'}).waitFor();
 await page.getByText('W5-PLAN').count(); // Summary is loaded from the real API.
 await page.getByRole('button',{name:'登记结算凭证'}).click();
 const record=page.getByRole('dialog',{name:'登记检修计划结算'});
 await record.getByLabel('凭证编号').fill('W5-UI-001');
 await record.getByLabel('结算金额（元）').fill('100');
 await record.getByLabel('结算依据').fill('浏览器测试进度结算');
 await record.getByRole('button',{name:'确认登记'}).click();
 await record.waitFor({state:'hidden'});
 await page.getByText('W5-UI-001').waitFor();
 const net=page.locator('.plan-finance-metrics strong').first();
 assert.match(await net.innerText(),/100\.00/);
 await page.getByRole('button',{name:'冲销余额'}).click();
 const reverse=page.getByRole('dialog',{name:'冲销原始结算凭证'});
 await reverse.getByLabel('冲销凭证编号').fill('W5-UI-REV');
 await reverse.getByLabel('本次冲销金额（元）').fill('40');
 await reverse.getByLabel('冲销依据').fill('凭证金额更正');
 await reverse.getByRole('button',{name:'确认冲销'}).click();
 await reverse.waitFor({state:'hidden'});
 await page.getByText('W5-UI-REV').waitFor();
 assert.match(await net.innerText(),/60\.00/);
 const summary=await fetchApi('/projects/'+project.id+'/settlement-summary');
 assert.equal(summary.settled_fen,6000);
 assert.equal(summary.allocated_fen,6000);
 assert.equal(summary.unallocated_fen,0);
 assert.deepEqual(errors,[]);
 assert.equal(backendErrors,'');
 assert.equal(viteErrors,'');
 console.log('W5_PLAN_FINANCE_BROWSER_OK real Vue form, posting, reversal, accounting and Chrome console');
 await context.close();
} finally {
 if(browser)await browser.close();
 for(const process of [viteServer,apiServer])if(process){process.kill('SIGTERM')}
 await wait(250);
 rmSync(root,{recursive:true,force:true});
}
