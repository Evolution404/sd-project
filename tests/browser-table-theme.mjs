import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {navigate} from './browser-navigation.mjs';

const root=mkdtempSync(join(tmpdir(),'sd-table-theme-'));
process.env.DATA_DIR=root;
process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'table-ui',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:940}});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.context().request.post(origin+'/api/auth/login',{data:{username:'table-ui',password:process.env.SD_ADMIN_PASSWORD||'test'}});
 await page.goto(origin);await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 assert.equal(await page.getByText('内网桌面系统',{exact:true}).count(),0);
 const views=['数据字典','需求中心','杆塔查询','档距查询','子项目储备','IP访问管理'];
 for(const name of views){
  await navigate(page,name);
  const table=page.locator('.el-table:visible').first();
  await table.waitFor({timeout:12000});
  const head=table.locator('thead th.el-table__cell').first();
  await head.waitFor();
  const row=table.locator('tbody td.el-table__cell').first();
  const details=await table.evaluate(el=>{
   const th=el.querySelector('thead th.el-table__cell');
   const td=el.querySelector('tbody td.el-table__cell');
   const get=target=>target?{background:getComputedStyle(target).backgroundColor,color:getComputedStyle(target).color,border:getComputedStyle(target).borderBottomColor}:null;
   return {head:get(th),body:get(td),vars:{header:getComputedStyle(el).getPropertyValue('--el-table-header-bg-color').trim(),hover:getComputedStyle(el).getPropertyValue('--el-table-row-hover-bg-color').trim()}};
  });
  assert.deepEqual(details.head,{background:'rgb(245, 248, 252)',color:'rgb(100, 115, 140)',border:'rgb(238, 242, 248)'},name+' header must use blue-gray shared theme');
  if(details.body)assert.deepEqual(details.body,{background:'rgb(255, 255, 255)',color:'rgb(96, 112, 137)',border:'rgb(238, 242, 248)'},name+' body must use shared row palette');
  console.log('TABLE_THEME',name,JSON.stringify(details));
 }
 assert.deepEqual(errors,[]);
 console.log('TABLE_THEME_OK');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>app.close(resolve));
 db.close();
 rmSync(root,{recursive:true,force:true});
}
