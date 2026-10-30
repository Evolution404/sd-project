import {navigate} from './browser-navigation.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
// A non-localhost HTTP origin exercises the same browser restrictions as LAN
// HTTP, while all requests and data remain in this isolated local test server.
const root=mkdtempSync(join(tmpdir(),'sd-insecure-browser-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'lan-test',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run','--no-default-browser-check','--no-proxy-server','--host-resolver-rules=MAP sd-audit.test 127.0.0.1']});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://sd-audit.test:'+app.address().port);
 await page.getByLabel('用户名').waitFor();
 const features=await page.evaluate(()=>({secure:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues}));
 assert.equal(features.secure,false);assert.equal(features.randomUUID,'undefined');
 await page.getByLabel('用户名').fill('lan-test');await page.getByLabel('密码').fill('test');await page.getByRole('button',{name:'登录系统'}).click();
 await page.getByRole('heading',{name:'工作台'}).waitFor();
 await page.locator('.sidebar .el-sub-menu > .el-sub-menu__title').filter({hasText:'需求中心'}).click();
 await page.locator('.sidebar').getByRole('menuitem',{name:'新建需求',exact:true}).click();
 await page.getByRole('button',{name:'清空重填'}).click();
 await page.getByRole('button',{name:'保存草稿'}).click();
 await page.getByRole('status').filter({hasText:'草稿已保存'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('LAN_HTTP_BROWSER_OK',features,'login, batch reset and draft creation verified with an isolated database');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>app.close(resolve));db.close();rmSync(root,{recursive:true,force:true});
}
