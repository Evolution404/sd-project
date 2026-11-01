import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright';
import {auditDetail} from './helpers/detail-ui-audit.mjs';

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
 // Integration: the same reusable component is mounted inside the actual
 // project -> maintenance plan detail, not only in the isolated component harness.
 await page.goto(uiUrl+'/');
 await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();
 const projectRow=page.getByRole('row').filter({hasText:'浏览器检修计划'});
 await projectRow.getByRole('button',{name:'需求范围与阶段'}).click();
 await page.getByTestId('settlement-allocation-summary').getByText(/已归集至检修计划 60\.00 元/).waitFor();
 await auditDetail(page,'.project-detail-page','project-funded');
 await page.setViewportSize({width:1360,height:900});
 const planRow=page.locator('.detail-panel').locator('.scope-item').filter({hasText:'W5-PLAN · 停电检修'});
 await planRow.getByRole('button',{name:'进入执行'}).click();
 const embedded=page.locator('.execution-detail-view .plan-finance');
 await embedded.getByRole('heading',{name:'检修计划结算'}).waitFor();
 await auditDetail(page,'.execution-detail-page','execution');
 const narrowBudgetCells=await page.locator('.execution-detail-view .plan-budget-workspace .el-descriptions__table tbody tr').first().locator('th,td').count();
 assert.equal(narrowBudgetCells,2,'760px budget summary must be one readable label/value pair per row');
 await page.locator('.execution-detail-view .voucher-toolbar').scrollIntoViewIfNeeded();
 await page.screenshot({path:'release/ui-deep-audit/execution-vouchers-760.png',fullPage:false});
 await page.setViewportSize({width:1360,height:900});
 assert.match(await embedded.locator('.plan-finance-metrics strong').first().innerText(),/60\.00/);
 await embedded.getByRole('button',{name:'登记结算凭证'}).click();
 const embeddedDialog=page.getByRole('dialog',{name:'登记检修计划结算'});
 await embeddedDialog.getByLabel('凭证编号').fill('W5-APP-INTEGRATED');
 await embeddedDialog.getByLabel('结算金额（元）').fill('30');
 await embeddedDialog.getByLabel('结算依据').fill('主应用检修计划详情集成验收');
 await embeddedDialog.getByRole('button',{name:'确认登记'}).click();
 await embeddedDialog.waitFor({state:'hidden'});
 await embedded.getByText('W5-APP-INTEGRATED').waitFor();
 assert.match(await embedded.locator('.plan-finance-metrics strong').first().innerText(),/90\.00/);
 assert.equal((await fetchApi('/projects/'+project.id+'/settlement-summary')).allocated_fen,9000);
 await page.locator('.execution-detail-view [aria-label="检修计划预算"]').getByText('90.00',{exact:true}).waitFor();
 // R01: real Element Plus dialogs, inline validation, immutable history and family revocation.
 let voucherRow=embedded.getByRole('row').filter({hasText:'W5-UI-001'});
 await voucherRow.getByRole('button',{name:'更正',exact:true}).click();
 const correction=page.getByRole('dialog',{name:'更正结算凭证',exact:true});
 await correction.getByRole('button',{name:'保存更正'}).click();
 await correction.getByText('请填写更正依据',{exact:true}).waitFor();
 assert.ok(await correction.locator('.el-form-item.is-required').count()>=5);
 assert.equal(await correction.locator('input:invalid').count(),0);
 await correction.getByRole('textbox',{name:'金额（元）',exact:true}).fill('9999');
 await correction.getByRole('textbox',{name:'更正依据',exact:true}).fill('测试金额上限核对');
 await correction.getByRole('button',{name:'保存更正'}).click();
 await correction.locator('.el-form-item').filter({hasText:'金额（元）'}).getByText('项目累计结算超过当前批准预算',{exact:true}).waitFor();
 await correction.getByRole('textbox',{name:'金额（元）',exact:true}).fill('140');
 await correction.getByRole('textbox',{name:'结算依据',exact:true}).fill('复核后结算140元');
 await correction.getByRole('textbox',{name:'更正依据',exact:true}).fill('原始结算表复核');
 await correction.getByRole('button',{name:'保存更正'}).click();
 await correction.waitFor({state:'hidden'});
 await embedded.locator('.plan-finance-metrics strong').first().getByText(/130\.00/).waitFor();
 voucherRow=embedded.getByRole('row').filter({hasText:'W5-UI-001'});
 await voucherRow.getByRole('button',{name:'详情 / 历史'}).click();
 const history=page.getByRole('dialog',{name:'结算凭证详情与历史',exact:true});
 await history.getByText('原始登记',{exact:true}).waitFor();
 await history.getByText('原始结算表复核',{exact:true}).waitFor();
 mkdirSync('release',{recursive:true});
 await page.waitForTimeout(300);
 await page.screenshot({path:'release/settlement-voucher-history.png'});
 await history.locator('.el-dialog__headerbtn').click();
 await voucherRow.getByRole('button',{name:'撤销',exact:true}).click();
 const revocation=page.getByRole('dialog',{name:'撤销结算凭证',exact:true});
 await revocation.getByText('W5-UI-REV',{exact:true}).waitFor();
 await revocation.getByRole('textbox',{name:'撤销依据'}).fill('正向和关联冲销凭证一并作废');
 await revocation.getByRole('button',{name:'确认撤销'}).click();
 await revocation.getByText('请确认同时撤销下列关联冲销凭证',{exact:true}).waitFor();
 await revocation.locator('.el-checkbox').click();
 await page.waitForTimeout(300);
 await page.screenshot({path:'release/settlement-voucher-void-preview.png'});
 await revocation.getByRole('button',{name:'确认撤销'}).click();
 await revocation.waitFor({state:'hidden'});
 await embedded.locator('.plan-finance-metrics strong').first().getByText(/30\.00/).waitFor();
 await page.locator('.execution-detail-view [aria-label="检修计划预算"]').getByText('30.00',{exact:true}).waitFor();
 await embedded.getByRole('combobox',{name:'凭证状态'}).press('Enter');
 await page.getByRole('option',{name:'已撤销凭证',exact:true}).click();
 await embedded.getByRole('row').filter({hasText:'W5-UI-001'}).getByText('已撤销',{exact:true}).waitFor();
 const allVouchers=await fetchApi('/projects/'+project.id+'/settlements?status=all');
 const original=allVouchers.find(v=>v.settlement_no==='W5-UI-001');
 assert.equal(original.status,'voided');
 const fullHistory=await fetchApi('/settlements/'+original.id);
 assert.equal(fullHistory.original.amount_fen,10000);
 assert.equal(fullHistory.versions.length,3);
 assert.equal((await fetchApi('/frameworks/'+fw.id+'/settlement-summary')).settled_fen,3000);
 await page.locator('.execution-detail-view').getByRole('button',{name:'返回项目'}).click();
 await page.getByTestId('settlement-allocation-summary').getByText(/已归集至检修计划 30\.00 元/).waitFor();
 await page.reload();
 await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();
 await page.getByRole('row').filter({hasText:'浏览器检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();
 await page.getByTestId('settlement-allocation-summary').getByText(/已归集至检修计划 30\.00 元/).waitFor();
 const projectVouchers=page.locator('.detail-panel [aria-label="结算凭证管理"]');
 await projectVouchers.getByRole('combobox',{name:'凭证状态'}).press('Enter');
 await page.getByRole('option',{name:'已撤销凭证',exact:true}).click();
 await projectVouchers.getByRole('row').filter({hasText:'W5-UI-001'}).getByRole('button',{name:'详情 / 历史'}).click();
 await page.getByRole('dialog',{name:'结算凭证详情与历史',exact:true}).getByText('原始结算表复核',{exact:true}).waitFor();
 console.log('R01_VOUCHER_BROWSER_OK correction, required fields, original history, explicit family void, parent refresh and reload');
 console.log('W5_MAIN_APP_INTEGRATION_BROWSER_OK project detail -> plan detail -> voucher -> parent totals');

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
