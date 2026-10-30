import {financeFixture} from './helpers/finance-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright';

const root=mkdtempSync(join(tmpdir(),'sd-budget-ui-'));
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
 const f=await financeFixture(fetchApi,'BROWSER-BUDGET');
 await page.goto(uiUrl+'/');
 await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();
 await page.getByRole('row').filter({hasText:'同一需求分两个检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();
 const openPlan=async(id)=>{
  const number=id===f.a.id?f.a.number:f.b.number;
  await page.locator('.project-overlay .scope-item').filter({hasText:number+' · '}).getByRole('button',{name:'进入执行'}).click();
  await page.locator('.execution-overlay [aria-label="检修计划预算"]').getByRole('heading',{name:'检修计划预算',exact:true}).waitFor();
 };
 await openPlan(f.a.id);
 const workspace=page.locator('.execution-overlay [aria-label="检修计划预算"]');
 const budget=workspace.getByTestId('plan-confirmed-budget');
 await budget.getByText('未核定',{exact:true}).waitFor();
 await workspace.getByRole('button',{name:'编制预算',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'编制计划预算',exact:true});
 await dialog.getByRole('button',{name:'保存草稿'}).click();
 await dialog.getByText('请填写预算金额',{exact:true}).waitFor();
 await dialog.getByText('请填写预算编制依据',{exact:true}).waitFor();
 assert.equal(await dialog.locator('input:invalid').count(),0);
 assert.equal(await dialog.locator('.el-form-item.is-required').count(),2);
 await dialog.getByRole('textbox',{name:'预算金额（元）',exact:true}).fill('600');
 await dialog.getByRole('textbox',{name:'预算编制依据',exact:true}).fill('A计划核定600元');
 await dialog.getByRole('button',{name:'保存草稿'}).click();await dialog.waitFor({state:'hidden'});
 await workspace.getByRole('row').filter({hasText:'A计划核定600元'}).waitFor();
 assert.equal((await fetchApi('/projects/'+f.project.id+'/plan-budgets')).allocated_budget_fen,0);
 async function confirmRow(basis){
  await workspace.getByRole('row').filter({hasText:basis}).getByRole('button',{name:'核定',exact:true}).click();
  return page.getByRole('dialog',{name:'确认计划预算',exact:true});
 }
 dialog=await confirmRow('A计划核定600元');await dialog.getByRole('button',{name:'确认核定'}).click();await dialog.waitFor({state:'hidden'});
 await budget.getByText('600.00',{exact:true}).waitFor();
 await page.locator('.execution-overlay').getByRole('button',{name:'返回项目'}).click();
 await page.getByTestId('plan-budget-allocation-summary').getByText(/已核定计划预算 600\.00 元/).waitFor();
 await openPlan(f.b.id);
 await workspace.getByRole('button',{name:'编制预算',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'编制计划预算',exact:true});
 await dialog.getByRole('textbox',{name:'预算金额（元）',exact:true}).fill('500');
 await dialog.getByRole('textbox',{name:'预算编制依据',exact:true}).fill('B计划初拟500元');
 await dialog.getByRole('button',{name:'保存草稿'}).click();await dialog.waitFor({state:'hidden'});
 dialog=await confirmRow('B计划初拟500元');await dialog.getByRole('button',{name:'确认核定'}).click();
 await dialog.getByText('计划核定预算合计超过子项目当前批准预算，请先调整分配金额',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await workspace.getByRole('row').filter({hasText:'B计划初拟500元'}).getByRole('button',{name:'编辑',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'编辑预算草稿',exact:true});
 await dialog.getByRole('textbox',{name:'预算金额（元）',exact:true}).fill('300');
 await dialog.getByRole('textbox',{name:'预算编制依据',exact:true}).fill('B计划核定300元');
 await dialog.getByRole('button',{name:'保存草稿'}).click();await dialog.waitFor({state:'hidden'});
 dialog=await confirmRow('B计划核定300元');await dialog.getByRole('button',{name:'确认核定'}).click();await dialog.waitFor({state:'hidden'});
 await budget.getByText('300.00',{exact:true}).waitFor();
 // Cancellation retains the 300 allocation. Explicit release is a separate confirmation.
 await page.locator('.execution-overlay').getByRole('button',{name:'取消未开工批次',exact:true}).click();
 const cancel=page.getByRole('dialog',{name:'取消未开工批次',exact:true});
 await cancel.getByRole('textbox',{name:'操作依据 / 说明'}).fill('取消计划仍保留预算');
 await cancel.getByRole('button',{name:'确认',exact:true}).click();await cancel.waitFor({state:'hidden'});
 await budget.getByText('300.00',{exact:true}).waitFor();
 assert.equal((await fetchApi('/projects/'+f.project.id+'/plan-budgets')).allocated_budget_fen,90000);
 await workspace.getByRole('button',{name:'删除当前预算',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'删除当前计划预算',exact:true});
 await dialog.getByRole('textbox',{name:'撤销依据',exact:true}).fill('明确撤销B计划核定预算');
 await dialog.getByRole('button',{name:'保存草稿'}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await fetchApi('/projects/'+f.project.id+'/plan-budgets')).allocated_budget_fen,90000);
 dialog=await confirmRow('明确撤销B计划核定预算');await dialog.getByRole('button',{name:'确认核定'}).click();await dialog.waitFor({state:'hidden'});
 await budget.getByText('已撤销（0.00）',{exact:true}).waitFor();
 await workspace.getByRole('button',{name:'预算历史',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'计划预算历史',exact:true});
 await dialog.getByText('B计划核定300元',{exact:true}).waitFor();await dialog.getByText('明确撤销B计划核定预算',{exact:true}).waitFor();
 await page.waitForTimeout(300);mkdirSync('release',{recursive:true});await page.screenshot({path:'release/plan-budget-history.png'});
 await dialog.locator('.el-dialog__headerbtn').click();
 // Draft deletion has a separate history filter and does not change confirmed allocation.
 await workspace.getByRole('button',{name:'编制预算',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'编制计划预算',exact:true});
 await dialog.getByRole('textbox',{name:'预算金额（元）',exact:true}).fill('100');
 await dialog.getByRole('textbox',{name:'预算编制依据',exact:true}).fill('待删除的预算草稿');
 await dialog.getByRole('button',{name:'保存草稿'}).click();await dialog.waitFor({state:'hidden'});
 await workspace.getByRole('row').filter({hasText:'待删除的预算草稿'}).getByRole('button',{name:'删除',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'删除预算草稿',exact:true});
 await dialog.getByRole('textbox',{name:'删除依据',exact:true}).fill('不再采用的编制方案');
 await dialog.getByRole('button',{name:'确认删除草稿'}).click();await dialog.waitFor({state:'hidden'});
 await workspace.getByRole('combobox',{name:'预算草稿状态',exact:true}).press('Enter');
 await page.getByRole('option',{name:'已删除草稿',exact:true}).click();
 await workspace.getByRole('row').filter({hasText:'待删除的预算草稿'}).getByRole('button',{name:'详情 / 历史',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'预算草稿详情与历史',exact:true});
 await dialog.getByText('不再采用的编制方案',{exact:true}).waitFor();await dialog.locator('.el-dialog__headerbtn').click();
 await page.locator('.execution-overlay').getByRole('button',{name:'返回项目'}).click();
 await page.getByTestId('plan-budget-allocation-summary').getByText(/已核定计划预算 600\.00 元/).waitFor();
 await page.reload();await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();
 await page.getByRole('row').filter({hasText:'同一需求分两个检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();
 await page.getByTestId('plan-budget-allocation-summary').getByText(/已核定计划预算 600\.00 元/).waitFor();
 assert.equal((await fetchApi('/frameworks/'+f.fw.id+'/settlement-summary')).allocated_plan_budget_fen,60000);
 assert.equal((await fetchApi('/projects/'+f.project.id+'/settlement-summary')).settled_fen,0);
 assert.deepEqual(errors,[]);assert.equal(backendErrors,'');assert.equal(viteErrors,'');
 console.log('PLAN_BUDGET_BROWSER_OK draft CRUD, inline validation, cap rejection, manual admin confirmation, retained allocation on cancel, explicit release/history and parent refresh');
 await context.close();
} finally {
 if(browser)await browser.close();
 for(const process of [viteServer,apiServer])if(process){process.kill('SIGTERM')}
 await wait(250);
 rmSync(root,{recursive:true,force:true});
}
