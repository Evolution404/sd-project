import {selectUiOption} from '../helpers/select-ui-option.mjs';
import {financeFixture} from '../helpers/finance-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {chromium} from 'playwright';

const root=mkdtempSync(join(tmpdir(),'sd-completion-ui-'));
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
 apiServer=spawn(process.execPath,['server/main.mjs'],{
  env:{...process.env,DATA_DIR:root,HOST:'127.0.0.1',PORT:String(apiPort)},
  stdio:['ignore','ignore','pipe']
 });
 let backendErrors='';apiServer.stderr.on('data',b=>backendErrors+=b.toString());
 await ready(backendUrl+'/api/health');
 viteServer=spawn('node',['node_modules/vite/bin/vite.js','--config','tests/fixtures/vite-w5.config.ts','--port',String(vitePort),'--strictPort'],{
  env:{...process.env,W5_TEST_API_URL:backendUrl},
  stdio:['ignore','ignore','pipe']
 });
 let viteErrors='';viteServer.stderr.on('data',b=>viteErrors+=b.toString());
 await ready(uiUrl+'/tests/fixtures/w5-ui.html');
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
 const f=await financeFixture(fetchApi,'R02-BROWSER');
 await page.goto(uiUrl+'/');
 await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();
 await page.getByRole('row').filter({hasText:'同一需求分两个检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();
 const enter=async()=>{await page.locator('.project-detail-view .scope-item').filter({hasText:f.a.number+' · '}).getByRole('button',{name:'进入执行'}).click();await page.locator('.execution-detail-view [aria-label="实际完成记录"]').getByRole('heading',{name:'实际完成记录',exact:true}).waitFor()};
 await enter();
 const workspace=page.locator('.execution-detail-view [aria-label="实际完成记录"]');
 async function stage(button,title){
  await page.locator('.execution-detail-view').getByRole('button',{name:button,exact:true}).click();
  const modal=page.getByRole('dialog',{name:title,exact:true});await modal.getByRole('textbox',{name:'操作依据 / 说明'}).fill('浏览器检修确认');await modal.getByRole('button',{name:'确认',exact:true}).click();await modal.waitFor({state:'hidden'});
 }
 await stage('确认开工','确认开工');
 await page.locator('.execution-detail-view').getByRole('button',{name:'确认完成量',exact:true}).click();
 let modal=page.getByRole('dialog',{name:/确认实际完成量：/});
 await modal.getByLabel('本次确认量').fill('2');await modal.getByLabel('完成依据 / 验收说明').fill('R02原始验收两套');
 await modal.getByRole('button',{name:'确认实际完成量',exact:true}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByRole('row').filter({hasText:'R02原始验收两套'}).waitFor();
 await stage('结束本次执行','结束本次执行');
 let c=await fetchApi('/projects/'+f.project.id+'/executions','POST',{plan_type:'outage'},201);
 await fetchApi('/executions/'+c.id+'/items','POST',{version:c.version,scope_id:f.scope.id,quantity:'3'},201);
 await workspace.getByRole('row').filter({hasText:'R02原始验收两套'}).getByRole('button',{name:'更正',exact:true}).click();
 modal=page.getByRole('dialog',{name:'更正完成记录',exact:true});
 await modal.getByRole('button',{name:'保存更正'}).click();await modal.getByText('请填写更正依据',{exact:true}).waitFor();
 assert.equal(await modal.locator('.el-form-item.is-required').count(),4);assert.equal(await modal.locator('input:invalid').count(),0);
 await modal.getByRole('textbox',{name:'完成量',exact:true}).fill('3');await modal.getByRole('textbox',{name:'更正依据',exact:true}).fill('复核实际数量');
 await modal.getByRole('button',{name:'保存更正'}).click();
 await modal.locator('.el-form-item').filter({hasText:'完成量'}).getByText('释放的工作量已被其他计划安排，更正后将超出批准范围，请先调整关联计划',{exact:true}).waitFor();
 await modal.getByRole('textbox',{name:'完成量',exact:true}).fill('1');await modal.getByRole('textbox',{name:'实施 / 验收依据',exact:true}).fill('R02复核完成一套');
 await modal.getByRole('button',{name:'保存更正'}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByRole('row').filter({hasText:'R02复核完成一套'}).waitFor();
 const detail=await fetchApi('/executions/'+f.a.id);assert.equal(detail.items[0].completed_quantity_scaled,10000);
 await page.locator('.execution-detail-view .plan-finance tbody tr').first().getByText('1',{exact:true}).waitFor();
 const financial=page.locator('.execution-detail-view .plan-finance');
 await financial.getByRole('button',{name:'登记结算凭证',exact:true}).click();modal=page.getByRole('dialog',{name:'登记检修计划结算',exact:true});
 await selectUiOption(modal.getByLabel('结算性质'),'final');await modal.getByLabel('凭证编号').fill('R02-UI-FINAL');await modal.getByLabel('结算金额（元）').fill('100');await modal.getByLabel('结算依据').fill('终结结算凭证');
 await modal.getByRole('button',{name:'确认登记',exact:true}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByRole('row').filter({hasText:'R02复核完成一套'}).getByRole('button',{name:'撤销',exact:true}).click();modal=page.getByRole('dialog',{name:'撤销完成记录',exact:true});
 await modal.getByText('R02-UI-FINAL',{exact:true}).waitFor();await modal.getByRole('textbox',{name:'撤销依据',exact:true}).fill('核对错误完成记录');
 await modal.getByRole('button',{name:'确认撤销',exact:true}).click();await modal.getByText('本次处理会使有效终结结算失去完成依据，请先核对并更正或撤销关联结算凭证',{exact:true}).waitFor();
 mkdirSync('test-results',{recursive:true});await page.waitForTimeout(300);await page.screenshot({path:'test-results/completion-dependency-preview.png'});
 await modal.getByRole('button',{name:'取消',exact:true}).click();
 await financial.getByRole('row').filter({hasText:'R02-UI-FINAL'}).getByRole('button',{name:'更正',exact:true}).click();modal=page.getByRole('dialog',{name:'更正结算凭证',exact:true});
 await modal.getByRole('combobox',{name:'结算性质',exact:true}).press('Enter');await page.getByRole('option',{name:'进度结算',exact:true}).click();
 await modal.getByRole('textbox',{name:'更正依据',exact:true}).fill('按真实资料纠正终结标记');await modal.getByRole('button',{name:'保存更正',exact:true}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByRole('row').filter({hasText:'R02复核完成一套'}).getByRole('button',{name:'撤销',exact:true}).click();modal=page.getByRole('dialog',{name:'撤销完成记录',exact:true});
 await modal.getByRole('textbox',{name:'撤销依据',exact:true}).fill('错误验收记录单独撤销，保留进度结算凭证');await modal.getByRole('button',{name:'确认撤销',exact:true}).click();await modal.waitFor({state:'hidden'});
 await workspace.getByText('暂无符合条件的完成记录',{exact:true}).waitFor();
 await workspace.getByRole('combobox',{name:'完成记录状态',exact:true}).press('Enter');await page.getByRole('option',{name:'已撤销记录',exact:true}).click();
 await workspace.getByRole('row').filter({hasText:'R02复核完成一套'}).getByRole('button',{name:'详情 / 历史',exact:true}).click();modal=page.getByRole('dialog',{name:'完成记录详情与历史',exact:true});
 await modal.getByText('R02原始验收两套',{exact:true}).first().waitFor();await modal.getByText('原始确认',{exact:true}).waitFor();await page.waitForTimeout(300);await page.screenshot({path:'test-results/completion-history.png'});await modal.locator('.el-dialog__headerbtn').click();
 assert.equal((await fetchApi('/executions/'+f.a.id)).items[0].completed_quantity_scaled,0);
 assert.equal((await fetchApi('/projects/'+f.project.id+'/settlement-summary')).settled_fen,10000);
 await page.locator('.execution-detail-view').getByRole('button',{name:'返回项目',exact:true}).click();
 await page.locator('.project-detail-view').getByText(/确认实施 0 \/ 批准 10/).waitFor();
 await page.reload();await page.locator('.sidebar').getByRole('menuitem',{name:'项目中心',exact:true}).click();await page.getByRole('row').filter({hasText:'同一需求分两个检修计划'}).getByRole('button',{name:'需求范围与阶段'}).click();await enter();
 await workspace.getByRole('combobox',{name:'完成记录状态',exact:true}).press('Enter');await page.getByRole('option',{name:'已撤销记录',exact:true}).click();await workspace.getByRole('row').filter({hasText:'R02复核完成一套'}).waitFor();
 assert.deepEqual(errors,[]);assert.equal(backendErrors,'');assert.equal(viteErrors,'');
 console.log('R02_COMPLETION_BROWSER_OK actual confirmation, ended-plan correction, allocation conflict, terminal-settlement dependencies, void/history and parent refresh');await context.close();
} finally {
 if(browser)await browser.close();
 for(const process of [viteServer,apiServer])if(process){process.kill('SIGTERM')}
 await wait(250);
 rmSync(root,{recursive:true,force:true});
}
