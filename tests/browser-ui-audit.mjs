import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {navigate} from './browser-navigation.mjs';

const root=mkdtempSync(join(tmpdir(),'sd-ui-audit-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../server/db.mjs');
const {app}=await import('../server/server.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'audit-ui',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1500,height:920}});
 const page=await context.newPage();page.setDefaultTimeout(12000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function api(path,method='GET',data){const r=await context.request.fetch(origin+'/api'+path,{method,data});assert.ok(r.ok(),path+' '+r.status()+' '+await r.text());return r.json()}
 await api('/auth/login','POST',{username:'audit-ui',password:'test'});
 const volt=await api('/voltage-levels','POST',{code:'AUDIT110',name:'110kV'});
 const line=await api('/ledger/lines','POST',{name:'界面审计线路',voltage_level_id:volt.id});
 let ws=await api('/ledger/lines/'+line.id);
 await api('/ledger/lines/'+line.id+'/towers','POST',{version:ws.line.version,topology_token:ws.topology_token,rows:[{tower_no:'001'},{tower_no:'002'},{tower_no:'003'}]});
 await page.goto(origin);await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 const routes=['工作台','需求台账','新建需求','项目中心','检修参考单价','项目框架','执行协议','线路台账','杆塔查询','档距查询','数据字典','操作记录','IP访问管理'];
 const keys=['overview','demands','entry','projects','prices','frameworks','agreements','lines','towers','spans','dictionary','audit','access'];
 mkdirSync('release/ui-audit',{recursive:true});
 const findings=[];
 for(const width of [1500,960,760]){
  await page.setViewportSize({width,height:920});
  for(const name of routes){
   try{
    await navigate(page,name);
    if(name==='线路台账')await page.locator('.ledger-directory .ledger-line').filter({hasText:'界面审计线路'}).click();
    await page.waitForTimeout(130);
    const info=await page.evaluate(()=>{
     const main=document.querySelector('.application-scroll');
     const body=document.querySelector('.application-body');
     const cards=[...document.querySelectorAll('.application-scroll .panel,.application-scroll .el-card,.application-scroll .ledger-workspace,.application-scroll .dictionary-workspace')].filter(e=>e.getBoundingClientRect().height>0);
     const mainRect=main?.getBoundingClientRect();
     const wrong=[...document.querySelectorAll('.application-scroll button,.application-scroll input,.application-scroll .el-select,.application-scroll .el-dialog,.application-scroll h1,.application-scroll h2')].filter(el=>{
      const r=el.getBoundingClientRect(),st=getComputedStyle(el);
      return r.width>0&&r.height>0&&st.visibility!=='hidden'&&st.display!=='none'&&r.right>(mainRect?.right??innerWidth)+12;
     }).slice(0,10).map(e=>({tag:e.tagName,cls:String(e.className).slice(0,55),text:e.textContent?.trim().slice(0,35),right:Math.round(e.getBoundingClientRect().right)}));
     return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,mainWidth:main?.clientWidth,mainScroll:main?.scrollWidth,bodyWidth:body?.clientWidth,cards:cards.length,title:document.querySelector('.application-scroll h1')?.textContent?.trim(),wrong};
    });
    findings.push({width,name,...info});
    console.log('UI_AUDIT',JSON.stringify(findings.at(-1)));
    if(width===1500||width===760)await page.screenshot({path:'release/ui-audit/'+keys[routes.indexOf(name)]+'-'+width+'.png',fullPage:false});
   }catch(e){findings.push({width,name,error:String(e).slice(0,600)});console.log('UI_AUDIT_ERROR',width,name,String(e).slice(0,600))}
  }
 }
 assert.deepEqual(errors,[],'no runtime errors across pages');
 const issues=findings.filter(f=>f.error||f.wrong?.length||f.documentWidth>f.viewport+2||f.mainScroll>f.mainWidth+20);
 console.log('UI_AUDIT_SUMMARY',JSON.stringify({pages:routes.length,screenshots:routes.length*2,issues}));
 assert.deepEqual(issues,[],'all navigation pages must fit work area at 1500/960/760px');
 const dictionary=page.locator('.dictionary-workspace');
 await page.setViewportSize({width:760,height:920});
 await navigate(page,'数据字典');
 assert.equal(await dictionary.locator('.dictionary-categories:visible').count(),0,'no duplicate tall category sidebar on narrow screens');
 assert.ok(await dictionary.getByLabel('字典类型').isVisible(),'category selector remains accessible on narrow screens');
}finally{
 if(browser)await browser.close();await new Promise(resolve=>app.close(resolve));db.close();rmSync(root,{recursive:true,force:true});
}
