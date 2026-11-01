import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {navigate} from './browser-navigation.mjs';

const root=mkdtempSync(join(tmpdir(),'sd-ui-dialog-'));
process.env.DATA_DIR=root;process.env.SD_DISABLE_LISTEN='1';
const {db}=await import('../server/db.mjs'),{app}=await import('../server/server.mjs');
let browser;
try{
 execFileSync(process.execPath,['scripts/init-admin.mjs'],{env:{...process.env,SD_ADMIN_USER:'dialog-audit',SD_ADMIN_PASSWORD:'test'}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 const origin='http://127.0.0.1:'+app.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1500,height:920}});
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const r=await context.request.post(origin+'/api/auth/login',{data:{username:'dialog-audit',password:'test'}});assert.ok(r.ok());
 const cases=[
  ['检修参考单价','新增参考价','prices-new'],
  ['项目框架','新增项目框架','framework-new'],
  ['执行协议','新增执行协议','agreement-new'],
  ['项目中心','新增子项目储备','project-new'],
  ['线路台账','新建线路','ledger-new'],
  ['数据字典','新增词条','dictionary-new'],
  ['操作记录','新增记录','audit-new'],
  ['IP访问管理','＋ 添加允许 IP','access-new']
 ];
 mkdirSync('release/ui-dialog-audit',{recursive:true});
 const findings=[];
 for(const width of [1500,760]){
  await page.setViewportSize({width,height:920});
  for(const [route,action,key] of cases){
   try{
    await page.goto(origin);await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
    await navigate(page,route);
    const b=page.getByRole('button',{name:action,exact:true}).first();
    await b.waitFor({state:'visible'});await b.click();
    const dialog=page.getByRole('dialog').last();
    await dialog.waitFor({state:'visible',timeout:8000});
    await page.waitForTimeout(350);
    const data=await page.locator('.el-dialog:visible').last().evaluate(el=>{
     const r=el.getBoundingClientRect(),vp=innerWidth;
     const controls=[...el.querySelectorAll('button,input,textarea,.el-select,.el-form-item__label')].filter(x=>{
      const v=getComputedStyle(x),b=x.getBoundingClientRect();
      return b.width>0&&b.height>0&&v.visibility!=='hidden'&&(b.right>vp+8||b.left<-8)
     }).map(x=>({type:x.tagName,label:x.textContent?.trim().slice(0,35),right:Math.round(x.getBoundingClientRect().right)})).slice(0,12);
     const content=el.querySelector('.el-dialog__body');
     const actions=[...el.querySelectorAll('.form-actions button')].filter(x=>x.getBoundingClientRect().width>0);
     const last=actions.at(-1)?.getBoundingClientRect();
     return {dialogWidth:r.width,viewport:vp,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
      overflow:el.scrollWidth>el.clientWidth+8,scrollable:!!content&&content.scrollHeight>content.clientHeight+2,
      lastActionVisible:!!last&&last.bottom<=innerHeight+2&&last.top>=0,
      offscreen:controls,title:el.querySelector('.el-dialog__title')?.textContent?.trim()};
    });
    findings.push({key,width,...data});
    console.log('UI_DIALOG',JSON.stringify(findings.at(-1)));
    await page.screenshot({path:'release/ui-dialog-audit/'+key+'-'+width+'.png',fullPage:false});
   }catch(e){findings.push({key,width,error:String(e).slice(0,280)});console.log('UI_DIALOG_ERROR',key,width,String(e).slice(0,280))}
  }
 }
 const issues=findings.filter(x=>x.error||x.offscreen?.length||x.right>x.viewport+8||x.left<0||x.bottom>920+2||x.top<-2||(x.key==='prices-new'&&!x.lastActionVisible));
 console.log('UI_DIALOG_SUMMARY',JSON.stringify({total:findings.length,issues}));
 assert.deepEqual(issues,[],'all eight common edit dialogs must fit desktop/narrow screens and preserve actions');
 assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();await new Promise(resolve=>app.close(resolve));db.close();rmSync(root,{recursive:true,force:true})}
