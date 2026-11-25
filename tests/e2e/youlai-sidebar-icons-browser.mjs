import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const artifacts=resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web");
assert.ok(existsSync(join(artifacts,"index.html")));
const cleanup=[];
const {s}=fixture({after:fn=>cleanup.push(fn)});
const backend=httpServer(s,{staticDirectory:artifacts});
await new Promise(done=>backend.listen(0,"127.0.0.1",done));
const origin="http://127.0.0.1:"+backend.address().port;
const out=resolve("test-results/youlai-sidebar-icons");
mkdirSync(out,{recursive:true});
const expected=["业务办理","专业需求","子项目管理","资金与结算","年度框架","执行协议","费用与结算","设备与物资","输电设备台账","物资管理","标准与计价","作业标准","参考价格","基础配置与系统","基础数据","系统管理","用户管理","审计记录","访问控制"];
const results=[];
let browser;
try{
 browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
 for(const colorScheme of ["light","dark"]){
  const context=await browser.newContext({colorScheme,viewport:{width:1920,height:1080}});
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+"/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(/#\/dashboard/);
  const sidebar=page.locator(".layout-sidebar");
  await sidebar.locator(".el-sub-menu__title").first().waitFor();
  for(const group of await sidebar.locator(".el-sub-menu__title").all()){
   if(!await group.evaluate(el=>el.parentElement.classList.contains("is-opened")))await group.click();
  }
  await page.waitForFunction(()=>document.querySelectorAll(".layout-sidebar .layout-menu-icon").length===20);
  await sidebar.locator(".el-menu-item:visible").last().waitFor();
  await page.waitForFunction(()=>document.querySelector(".layout-sidebar").getAnimations({subtree:true}).every(a=>a.playState!=="running"));
  const audit=await sidebar.evaluate(el=>[...el.querySelectorAll(".el-menu-item, .el-sub-menu__title")].map(row=>{
   const icon=row.querySelector(":scope > .layout-menu-icon");
   const label=row.querySelector(":scope > span[title]");
   const svg=icon?.querySelector("svg");
   const r=icon?.getBoundingClientRect(),t=label?.getBoundingClientRect(),s=svg?.getBoundingClientRect();
   return {label:label?.textContent?.trim(),native:icon?.classList.contains("layout-menu-icon--element"),shape:svg?.querySelector("path")?.getAttribute("d"),viewBox:svg?.getAttribute("viewBox"),width:r?.width,height:r?.height,svgWidth:s?.width,svgHeight:s?.height,centerError:r&&t?Math.abs((r.y+r.height/2)-(t.y+t.height/2)):null,color:icon&&getComputedStyle(icon).color,visible:!!(r&&r.height&&r.width)};
  }));
  assert.equal(audit.length,20,colorScheme+" all groups and entries");
  for(const label of expected)assert.ok(audit.some(row=>row.label===label),label);
  for(const row of audit){
   assert.ok(row.native&&row.shape&&row.visible,JSON.stringify(row));
   assert.equal(row.width,20,row.label);
   assert.equal(row.height,20,row.label);
   assert.equal(row.svgWidth,20,row.label);
   assert.equal(row.svgHeight,20,row.label);
   assert.ok(row.centerError<=1,JSON.stringify(row));
  }
  assert.equal(new Set(audit.map(row=>row.shape)).size,20,"distinct semantic glyphs");
  results.push({colorScheme,rows:audit});
  await sidebar.screenshot({path:join(out,"sidebar-"+colorScheme+".png"),animations:"disabled"});
  await sidebar.getByText("子项目管理",{exact:true}).click();
  await page.waitForURL(/#\/business\/projects/);
  const active=sidebar.locator(".el-menu-item.is-active .layout-menu-icon");
  await active.waitFor();
  assert.equal(await active.locator("svg").count(),1);
  await page.mouse.move(800,100);
  await page.waitForFunction(()=>{
    const row=document.querySelector(".layout-sidebar .el-menu-item.is-active");
    return row && row.getAnimations({subtree:true}).every(a=>a.playState!=="running");
  });
  assert.equal(await active.evaluate(el=>getComputedStyle(el).color),await page.locator(".layout-sidebar .el-menu-item.is-active").evaluate(el=>getComputedStyle(el).color));
  assert.deepEqual(errors,[]);
  await context.close();
 }
 writeFileSync(join(out,"audit.json"),JSON.stringify(results,null,2)+"\n");
 console.log("SIDEBAR_ICONS_OK",results.length,"themes",results.reduce((n,r)=>n+r.rows.length,0),"native 20px icon rows; centered and distinct; active navigation checked");
}finally{
 await browser?.close();
 await new Promise(done=>backend.close(done));
 for(const action of cleanup.reverse())await action();
}
