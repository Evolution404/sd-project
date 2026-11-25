import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { worksheetCanvas, selectWorksheetCell } from "./youlai-business-worksheet-helpers.mjs";
import { pasteSettlementCells, copySettlementSelection } from "./youlai-settlement-grid-helpers.mjs";

const cleanup=[];
const {s,save,user,demandInput}=fixture({after:fn=>cleanup.push(fn)});
const towers=Array.from({length:20},(_,i)=>save("physical",{asset_no:"MODE-WHEEL-"+String(i+1).padStart(2,"0")}));
const demand=s.demands.save(user,{...demandInput,problem_description:"作业方式和滚轮边界验证",work_locations:towers.map((tower,i)=>({
  location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000,work_mode:i===0?"outage":"unspecified",
}))});
const server=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const origin="http://127.0.0.1:"+server.address().port;
const out=resolve("test-results/youlai-demand-workmode-wheel");mkdirSync(out,{recursive:true});
let browser,page;
try{
  browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
  for(const theme of ["light","dark"]){
    const context=await browser.newContext({viewport:{width:1920,height:1080},colorScheme:theme});
    await context.grantPermissions(["clipboard-read","clipboard-write"],{origin});
    page=await context.newPage();
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(origin+"/#/login");
    await page.getByPlaceholder("用户名").fill("admin");
    await page.getByPlaceholder("密码").fill("Schema113-test-password");
    await page.getByRole("button",{name:"登录",exact:true}).click();
    await page.waitForURL(/#\/dashboard/);
    await page.goto(origin+"/#/business/demands/edit/"+demand.id);
    await page.getByRole("tab",{name:"作业位置（20）",exact:true}).click();
    const work=page.locator('[data-grid-key="demands:positions"]');
    const canvas=await worksheetCanvas(work);
    const widths=[180,145,125,170,125,150];
    const scroll=page.locator(".demand-scroll");
    const box=await canvas.boundingBox();assert.ok(box);
    const last=36+widths.reduce((a,b)=>a+b,0);
    assert.ok(box.width>last+70,JSON.stringify(box));
    const x=box.x+last+40,y=box.y+90;
    const before=await scroll.evaluate(el=>el.scrollTop);
    await page.mouse.move(x,y);
    await page.mouse.wheel(0,220);
    await page.waitForFunction(v=>document.querySelector(".demand-scroll").scrollTop>v,before);
    const after=await scroll.evaluate(el=>el.scrollTop);
    console.log("BLANK_WHEEL_OK",theme,after-before);
    await scroll.evaluate((el,v)=>el.scrollTop=v,before);
    await page.waitForFunction(v=>Math.abs(document.querySelector(".demand-scroll").scrollTop-v)<2,before);
    await page.mouse.move(box.x+200,y);
    await page.mouse.wheel(0,180);
    await page.waitForTimeout(200);
    assert.ok(Math.abs((await scroll.evaluate(el=>el.scrollTop))-before)<2,"wheel over actual cells must stay local");
    await page.mouse.wheel(0,-3000);await page.waitForTimeout(200);
    const copy=async row=>{await selectWorksheetCell(canvas,row,4,widths);return (await copySettlementSelection(page)).trim();};
    assert.equal(await copy(1),"停电");
    await selectWorksheetCell(canvas,2,4,widths);
    await pasteSettlementCells(page,"不停电\n停电");
    assert.equal(await copy(2),"不停电");
    assert.equal(await copy(3),"停电");
    await work.getByRole("button",{name:"撤销",exact:true}).click();
    assert.equal(await copy(2),"未明确");
    await work.getByRole("button",{name:"重做",exact:true}).click();
    assert.equal(await copy(2),"不停电");
    console.log("WORKMODE_CLIPBOARD_HISTORY_OK",theme);
    await selectWorksheetCell(canvas,4,4,widths);
    await pasteSettlementCells(page,"错误作业方式");
    assert.equal(await copy(4),"错误作业方式");
    await page.getByRole("button",{name:"保存专业需求",exact:true}).click();
    await work.locator(".worksheet-validation").getByText(/作业方式须选择未明确、停电或不停电/).waitFor({timeout:5000});
    await selectWorksheetCell(canvas,4,4,widths);
    await pasteSettlementCells(page,"停电");
    await page.screenshot({path:join(out,theme+".png"),animations:"disabled"});
    if(theme==="dark"){
      await page.getByRole("button",{name:"保存专业需求",exact:true}).click();
      await page.waitForURL(/#\/business\/demands(?:\?|$)/);
      const saved=s.demands.get(demand.id);
      const byTower=new Map(saved.work_locations.map(row=>[row.physical_tower_id,row.work_mode]));
      assert.deepEqual(towers.slice(0,5).map(t=>byTower.get(t.id)),["outage","non_outage","outage","outage","unspecified"]);
    }
    assert.deepEqual(errors,[]);
    console.log("DEMAND_WORKMODE_WHEEL_OK",theme,JSON.stringify({outerScrollDelta:after-before}));
    await context.close();
  }
}catch(error){await page?.screenshot({path:join(out,"failure.png"),animations:"disabled"}).catch(()=>{});console.log("FAILURE_TEXT",(await page?.locator(".demand-scroll").innerText().catch(()=>""))?.slice(0,2500));throw error;}finally{await browser?.close();await new Promise(ok=>server.shutdown(ok));for(const fn of cleanup.reverse())await fn();}
