import {financeFixture} from './helpers/finance-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright';

const root=mkdtempSync(join(tmpdir(),'sd-costs-ui-'));
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
 const f=await financeFixture(fetchApi,'COST-BROWSER',{twoScopes:true});
 const b=await fetchApi('/executions/'+f.a.id+'/budget');const draft=await fetchApi('/executions/'+f.a.id+'/budget-drafts','POST',{base_budget_version:0,project_approval_version_id:b.project_approval_version_id,amount_yuan:'100',basis:'核定计划100元'},201);await fetchApi('/plan-budget-drafts/'+draft.id+'/confirm','POST',{version:draft.version,request_key:draft.id});
 const settlement=await fetchApi('/executions/'+f.a.id+'/settlements','POST',{execution_item_id:f.ai,settlement_no:'COST-UI-SETTLED',entry_kind:'payment',settlement_type:'progress',amount_yuan:'250',occurred_on:'2026-10-30',evidence:'确认材料费250元'},201);
 await page.goto(uiUrl+'/');await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();await page.getByRole('row').filter({hasText:'同一需求分两个检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();
 await page.locator('.project-overlay .scope-item').filter({hasText:f.a.number+' · '}).getByRole('button',{name:'进入执行'}).click();
 const costs=page.locator('.execution-overlay [aria-label="实际费用管理"]'),matches=page.locator('.execution-overlay [aria-label="费用结算核对"]');
 await costs.getByRole('heading',{name:'实际费用',exact:true}).waitFor();await costs.getByRole('button',{name:'编制费用',exact:true}).click();
 let modal=page.getByRole('dialog',{name:'编制实际费用',exact:true});
 await modal.getByRole('button',{name:'保存费用草稿',exact:true}).click();await modal.getByText('请填写费用名称',{exact:true}).waitFor();assert.equal(await modal.locator('input:invalid').count(),0);
 await modal.getByRole('textbox',{name:'费用名称',exact:true}).fill('材料现场费用');await modal.getByRole('textbox',{name:'费用金额（元）',exact:true}).fill('300');await modal.getByRole('textbox',{name:'费用凭据 / 依据',exact:true}).fill('真实材料领用凭据');
 await modal.getByRole('combobox',{name:'费用类别',exact:true}).press('Enter');await page.getByRole('option',{name:'材料费',exact:true}).click();
 await modal.getByRole('button',{name:'保存费用草稿',exact:true}).click();await modal.waitFor({state:'hidden'});
 await costs.getByTestId('actual-cost-total').getByText('0.00',{exact:true}).waitFor();
 async function confirmDraft(name){await costs.getByRole('row').filter({hasText:name}).getByRole('button',{name:'确认费用',exact:true}).click();return page.getByRole('dialog',{name:'确认实际费用',exact:true})}
 modal=await confirmDraft('材料现场费用');await modal.getByRole('button',{name:'确认入账',exact:true}).click();await modal.waitFor({state:'hidden'});await costs.getByTestId('actual-cost-total').getByText('300.00',{exact:true}).waitFor();await costs.getByText(/实际费用超过计划预算 200\.00 元/).waitFor();
 await costs.getByRole('button',{name:'编制费用',exact:true}).click();modal=page.getByRole('dialog',{name:'编制实际费用',exact:true});
 await modal.getByRole('textbox',{name:'费用名称',exact:true}).fill('共同机械费用');await modal.getByRole('textbox',{name:'费用金额（元）',exact:true}).fill('90');await modal.getByRole('textbox',{name:'费用凭据 / 依据',exact:true}).fill('机械费用人工核定分摊');await modal.getByRole('button',{name:'添加分摊工作项',exact:true}).click();
 const allocations=modal.locator('.cost-allocation');
 await allocations.nth(0).getByRole('textbox',{name:'分摊金额（元）',exact:true}).fill('30');
 await allocations.nth(1).getByRole('combobox',{name:'受益工作项',exact:true}).press('Enter');await page.getByRole('option',{name:f.project.scopes.find(s=>s.id!==f.scope.id).demand_no,exact:true}).click();await allocations.nth(1).getByRole('textbox',{name:'分摊金额（元）',exact:true}).fill('50');
 await modal.getByRole('button',{name:'保存费用草稿',exact:true}).click();await modal.getByText('分摊金额合计必须等于费用金额，不能重复计入整笔费用',{exact:true}).waitFor();
 await allocations.nth(1).getByRole('textbox',{name:'分摊金额（元）',exact:true}).fill('60');await modal.getByRole('button',{name:'保存费用草稿',exact:true}).click();await modal.waitFor({state:'hidden'});
 modal=await confirmDraft('共同机械费用');await modal.getByRole('button',{name:'确认入账',exact:true}).click();await modal.waitFor({state:'hidden'});await costs.getByTestId('actual-cost-total').getByText('390.00',{exact:true}).waitFor();
 await matches.getByRole('button',{name:'登记核对',exact:true}).click();modal=page.getByRole('dialog',{name:'登记费用结算核对',exact:true});
 await modal.getByRole('combobox',{name:'实际费用',exact:true}).press('Enter');await page.getByRole('option',{name:'材料现场费用 · 300.00 元',exact:true}).click();
 await modal.getByRole('combobox',{name:'结算凭证',exact:true}).press('Enter');await page.getByRole('option',{name:'COST-UI-SETTLED · 250.00 元',exact:true}).click();
 await modal.getByRole('textbox',{name:'对应费用份额（元）',exact:true}).fill('300');await modal.getByRole('textbox',{name:'核定结算额（元）',exact:true}).fill('250');await modal.locator('.el-checkbox').click();await modal.getByRole('textbox',{name:'核对 / 差异依据',exact:true}).fill('材料核减50元，原300元费用已最终核对');
 await modal.getByRole('button',{name:'保存核对',exact:true}).click();await modal.waitFor({state:'hidden'});await costs.getByTestId('pending-final-cost').getByText('90.00',{exact:true}).waitFor();
 await matches.getByRole('row').filter({hasText:'材料现场费用'}).getByText('50.00',{exact:true}).waitFor();
 await costs.getByRole('row').filter({hasText:'材料现场费用'}).getByRole('button',{name:'撤销',exact:true}).click();modal=page.getByRole('dialog',{name:'撤销已确认费用',exact:true});await modal.getByRole('textbox',{name:'撤销依据',exact:true}).fill('待核对关系先处理后撤销费用');await modal.getByRole('button',{name:'保存费用草稿',exact:true}).click();await modal.waitFor({state:'hidden'});
 modal=await confirmDraft('材料现场费用');await modal.getByRole('button',{name:'确认入账',exact:true}).click();await modal.getByText('存在有效费用结算核对，请先更正或撤销核对记录，不能使其费用或结算依据失效',{exact:true}).waitFor();await modal.getByRole('button',{name:'取消',exact:true}).click();
 await matches.getByRole('row').filter({hasText:'材料现场费用'}).getByRole('button',{name:'撤销',exact:true}).click();modal=page.getByRole('dialog',{name:'撤销费用结算核对',exact:true});await modal.getByRole('textbox',{name:'撤销依据',exact:true}).fill('先撤销材料核对关系');await modal.getByRole('button',{name:'确认撤销核对',exact:true}).click();await modal.waitFor({state:'hidden'});await costs.getByTestId('pending-final-cost').getByText('390.00',{exact:true}).waitFor();
 modal=await confirmDraft('材料现场费用');await modal.getByRole('button',{name:'确认入账',exact:true}).click();await modal.waitFor({state:'hidden'});await costs.getByTestId('actual-cost-total').getByText('90.00',{exact:true}).waitFor();
 await costs.getByRole('combobox',{name:'费用状态',exact:true}).press('Enter');await page.getByRole('option',{name:'已撤销费用',exact:true}).click();await costs.getByRole('row').filter({hasText:'材料现场费用'}).getByRole('button',{name:'详情 / 历史',exact:true}).click();modal=page.getByRole('dialog',{name:'费用详情与历史',exact:true});await modal.getByText('待核对关系先处理后撤销费用',{exact:true}).waitFor();mkdirSync('release',{recursive:true});await page.waitForTimeout(300);await page.screenshot({path:'release/actual-cost-history.png'});await modal.locator('.el-dialog__headerbtn').click();
 await matches.getByRole('combobox',{name:'核对记录状态',exact:true}).press('Enter');await page.getByRole('option',{name:'已撤销核对',exact:true}).click();await matches.getByRole('row').filter({hasText:'材料现场费用'}).getByRole('button',{name:'详情 / 历史',exact:true}).click();modal=page.getByRole('dialog',{name:'费用结算核对历史',exact:true});await modal.getByText('材料核减50元，原300元费用已最终核对',{exact:true}).waitFor();await modal.getByText('先撤销材料核对关系',{exact:true}).waitFor();await page.waitForTimeout(300);await page.screenshot({path:'release/cost-reconciliation-history.png'});await modal.locator('.el-dialog__headerbtn').click();
 assert.equal((await fetchApi('/projects/'+f.project.id+'/settlement-summary')).actual_cost_fen,9000);assert.equal((await fetchApi('/settlements/'+settlement.id)).entry.amount_fen,25000);
 await page.locator('.execution-overlay').getByRole('button',{name:'返回项目',exact:true}).click();await page.getByTestId('actual-cost-summary').getByText(/已确认实际费用 90\.00 元/).waitFor();
 await page.reload();await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();await page.getByRole('row').filter({hasText:'同一需求分两个检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();await page.getByTestId('actual-cost-summary').getByText(/已确认实际费用 90\.00 元/).waitFor();
 assert.deepEqual(errors,[]);assert.equal(backendErrors,'');assert.equal(viteErrors,'');console.log('ACTUAL_COST_BROWSER_OK direct/common cost drafts, manual allocation, confirmation, over-budget truth, final cost shares, dependent void and histories');await context.close();
} finally {
 if(browser)await browser.close();
 for(const process of [viteServer,apiServer])if(process){process.kill('SIGTERM')}
 await wait(250);
 rmSync(root,{recursive:true,force:true});
}
