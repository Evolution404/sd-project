import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {navigate} from './browser-navigation.mjs';
import {selectUiOption} from './helpers/select-ui-option.mjs';

const dataRoot=mkdtempSync(join(tmpdir(),'sd-topology-ui-'));
process.env.DATA_DIR=dataRoot;
process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'topology',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1500,height:940}});
 const page=await context.newPage();page.setDefaultTimeout(12000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function api(path,method='GET',data){
  const r=await context.request.fetch(origin+'/api'+path,{method,data});
  assert.ok(r.ok(),path+': '+await r.text());
  return r.json();
 }
 await api('/auth/login','POST',{username:'topology',password:'test'});
 const v=await api('/voltage-levels','POST',{code:'TOP110',name:'110kV'});
 const l=await api('/ledger/lines','POST',{name:'拓扑回归线路',voltage_level_id:v.id});
 let ws=await api('/ledger/lines/'+l.id);
 await api('/ledger/lines/'+l.id+'/towers','POST',{version:ws.line.version,topology_token:ws.topology_token,rows:[
  {tower_no:'001',longitude:118.8,latitude:32.1},{tower_no:'002',longitude:118.81,latitude:32.11}
 ]});
 ws=await api('/ledger/lines/'+l.id);
 assert.equal(ws.towers.length,2);assert.equal(ws.spans.length,0);
 await page.goto(origin);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await navigate(page,'线路台账');
 await page.locator('.ledger-directory .ledger-line').filter({hasText:'拓扑回归线路'}).click();
 const editor=page.locator('.topology-workspace');await editor.waitFor();
 assert.equal(await page.locator('.ledger-tabs button.active').innerText(),'拓扑编辑');
 assert.equal(await editor.locator('.topology-node').count(),2);
 await selectUiOption(editor.getByLabel('拓扑布局'),{label:'地理坐标'});
 await editor.getByText('地理布局按真实经纬度相对排列').waitFor();
 await selectUiOption(editor.getByLabel('拓扑布局'),{label:'逻辑拓扑'});
 await editor.locator('.topology-node[aria-label="选择杆塔 001"]').click();
 await editor.getByRole('button',{name:'在此杆塔后插入'}).click();
 let dialog=page.getByRole('dialog',{name:'暂存新增杆塔'});await dialog.waitFor();
 await dialog.getByLabel('杆塔编号').fill('001A');
 await dialog.getByLabel('管辖部门').fill('输电测试班');
 await dialog.getByRole('button',{name:'加入待提交变更'}).click();
 await dialog.waitFor({state:'hidden'});
 assert.equal(await editor.locator('.topology-node').count(),3);
 assert.equal((await api('/ledger/lines/'+l.id)).towers.length,2,'staging cannot write');
 await editor.getByRole('button',{name:'连接档距'}).click();
 await editor.locator('.topology-node[aria-label="选择杆塔 001"]').click();
 await editor.locator('.topology-node[aria-label="选择杆塔 001A"]').click();
 await editor.locator('.topology-node[aria-label="选择杆塔 001A"]').click();
 await editor.locator('.topology-node[aria-label="选择杆塔 002"]').click();
 assert.match(await editor.locator('.topology-change-head').innerText(),/1 基新增杆塔 · 2 条新增档距/);
 await editor.getByRole('button',{name:'撤销',exact:true}).click();
 assert.match(await editor.locator('.topology-change-head').innerText(),/1 基新增杆塔 · 1 条新增档距/);
 await editor.getByRole('button',{name:'重做',exact:true}).click();
 assert.match(await editor.locator('.topology-change-head').innerText(),/1 基新增杆塔 · 2 条新增档距/);
 await page.locator('.sidebar').getByRole('menuitem',{name:'工作台',exact:true}).click();
 const leaveDialog=page.getByRole('dialog',{name:'离开拓扑编辑器'});await leaveDialog.waitFor();
 await leaveDialog.getByRole('button',{name:'继续编辑'}).click();
 await leaveDialog.waitFor({state:'hidden'});
 await editor.waitFor();
 await editor.getByRole('button',{name:'预览变更'}).click();
 dialog=page.getByRole('dialog',{name:'拓扑变更预览 · 一次确认提交'});await dialog.waitFor();
 assert.match(await dialog.innerText(),/新增 1 基杆塔和 2 条档距/);
 assert.equal((await api('/ledger/lines/'+l.id)).towers.length,2,'preview cannot write');
 await dialog.getByRole('button',{name:'确认并一次提交'}).click();
 await dialog.waitFor({state:'hidden'});
 await editor.getByText('尚无待提交变更').waitFor();
 ws=await api('/ledger/lines/'+l.id);
 assert.deepEqual(ws.towers.map(x=>x.tower_no),['001','001A','002']);
 assert.equal(ws.spans.filter(x=>x.status==='active').length,2);
 assert.equal(ws.towers[1].management_department,'输电测试班');
 assert.deepEqual(errors,[]);
 for(const width of [1500,900,760]){
  await page.setViewportSize({width,height:850});
  await editor.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'topology must not overflow at '+width);
 }
 await page.setViewportSize({width:1500,height:940});
 mkdirSync('release',{recursive:true});
 await page.screenshot({path:join(process.cwd(),'release','topology-editor-1500.png'),fullPage:false});
 console.log('TOPOLOGY_EDITOR_BROWSER_OK',JSON.stringify({towers:ws.towers.length,spans:ws.spans.length,layouts:2}));
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>app.close(resolve));
 db.close();rmSync(dataRoot,{recursive:true,force:true});
}
