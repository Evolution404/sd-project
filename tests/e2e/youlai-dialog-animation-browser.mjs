import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const cleanup=[], f=fixture({after:fn=>cleanup.push(fn)});
const server=httpServer(f.s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
const out=resolve("test-results/youlai-dialog-animation");
mkdirSync(out,{recursive:true});
let browser;
try{
  browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
  const page=await browser.newPage({viewport:{ width: 1920, height: 1080 },reducedMotion:"no-preference"});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base+"/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(/#\/dashboard/);
  async function trace(name,key){
    const button=page.getByRole("button",{name,exact:true});
    await button.waitFor();
    await page.waitForFunction(()=>!document.querySelector(".layout-content .el-loading-mask"));
    // Finish the initial page transition before testing a later user-triggered dialog.
    await page.waitForTimeout(650);
    await page.evaluate(name=>{
      const find=()=>Array.from(document.querySelectorAll('[role="dialog"]')).find(el=>el.getAttribute("aria-label")===name)?.closest(".el-overlay");
      const start=performance.now(), frames=[],events=[];
      const listener=e=>{const el=find();if(el&&(e.target===el||el.contains(e.target)))events.push({ms:Math.round(performance.now()-start),type:e.type,name:e.animationName})};
      for(const type of ["animationstart","animationend","animationcancel"])document.addEventListener(type,listener,true);
      window.__dialogTrace=new Promise(resolve=>{
        const tick=()=>{
          const el=find();
          if(el){
            const style=getComputedStyle(el);
            if(style.display!=="none")frames.push({ms:Math.round(performance.now()-start),opacity:Number(style.opacity),animation:style.animationName,body:el.parentElement===document.body});
          }
          if(performance.now()-start<1200)requestAnimationFrame(tick);
          else {
            for(const type of ["animationstart","animationend","animationcancel"])document.removeEventListener(type,listener,true);
            resolve({frames,events});
          }
        };
        requestAnimationFrame(tick);
      });
    },name);
    await button.click();
    const dialog=page.getByRole("dialog",{name,exact:true});
    await dialog.waitFor();
    const trace=await page.evaluate(()=>window.__dialogTrace);
    writeFileSync(resolve(out,key+".json"),JSON.stringify(trace,null,2));
    assert.ok(trace.frames.length>10,name+" insufficient frames");
    assert.ok(trace.frames.every(f=>f.body),name+" native overlay must be teleported to body");
    assert.ok(trace.frames.every(f=>f.animation!=="page-rise"),name+" page animation affected modal");
    assert.ok(!trace.events.some(e=>e.name==="page-rise"),name+" page animation restarted");
    assert.equal(trace.events.filter(e=>e.type==="animationstart"&&e.name==="modal-fade-in").length,1,name+" one native modal entrance");
    assert.equal(trace.events.filter(e=>e.type==="animationstart"&&e.name==="dialog-fade-in").length,1,name+" one native dialog entrance");
    const stable=trace.frames.findIndex(f=>f.opacity>=0.99 && f.animation==="none");
    assert.ok(stable>=0,name+" never reached stable opacity");
    assert.ok(trace.frames.slice(stable).every(f=>f.opacity>=0.99),name+" opacity dropped after entrance");
    await page.screenshot({path:resolve(out,key+".png"),animations:"disabled"});
    await dialog.getByRole("button",{name:"关闭",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    console.log("DIALOG_ANIMATION_OK",key,"frames",trace.frames.length,"stable ms",trace.frames[stable].ms);
  }
  await page.goto(base+"/#/configuration/dictionaries");
  await page.getByRole("tab",{name:"组织目录",exact:true}).click();
  await trace("新增组织","organization-first");
  await trace("新增组织","organization-reopen");
  await page.goto(base+"/#/assets/materials");
  await trace("新增物资","material");
  await page.goto(base+"/#/funding/frameworks");
  await trace("新增年度框架","framework");
  assert.deepEqual(errors,[]);
  console.log("YOULAI_DIALOG_ANIMATION_OK native single entrance, stable opacity, no page-rise or remount on reopen");
}catch(e){throw e}
finally{await browser?.close();await new Promise(r=>server.close(r));for(const fn of cleanup.reverse())await fn()}
