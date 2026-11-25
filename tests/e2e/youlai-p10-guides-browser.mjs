import assert from "node:assert/strict";
import {existsSync,mkdirSync,mkdtempSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {chromium} from "playwright";
import {ensureDemoDatabase,DEMO_ACCOUNT,DEMO_PASSWORD} from "../../scripts/demo/seed-demo.mjs";
import {createSystem} from "../../dist/server/bootstrap.js";
import {httpServer} from "../../dist/server/platform/http/server.js";
const dir=mkdtempSync(join(tmpdir(),"sd-p10-native-guides-"));
ensureDemoDatabase(dir);
const system=createSystem(dir);
const staticDirectory=resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web");
const server=httpServer(system,{staticDirectory});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
const out=resolve("test-results/youlai-p10-guides");mkdirSync(out,{recursive:true});
const modules=[
 ["dashboard","/dashboard","工作台","实际费用趋势"],
 ["demands","/business/demands","专业需求","新增专业需求"],
 ["projects","/business/projects","子项目管理","新增子项目"],
 ["frameworks","/funding/frameworks","年度框架","新增年度框架"],
 ["agreements","/funding/agreements","执行协议","新增执行协议"],
 ["finance","/funding/finance","费用与结算","新增结算草稿"],
 ["ledger","/assets/ledger","输电设备台账","新增输电线路"],
 ["materials","/assets/materials","物资管理","新增物资"],
 ["standards","/standards/operations","作业标准","新增作业对象"],
 ["pricing","/standards/pricing","参考价格","新增参考价格"],
 ["dictionaries","/configuration/dictionaries","基础数据","新增计量单位"],
 ["system","/configuration/system","系统管理","功能权限"],
];
const steps=["本页面用于什么","业务功能区域","从主要操作开始","查询、筛选与查看","正式历史与风险"];
let browser,page;
try{
 browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
 page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
 const errors=[],writes=[];
 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",r=>{if(r.url().startsWith(base+"/api/")&&!["GET","HEAD"].includes(r.method())&&!r.url().endsWith("/api/login"))writes.push(r.url())});
 await page.goto(base+"/#/login");
 await page.getByPlaceholder("用户名").fill(DEMO_ACCOUNT);
 await page.getByPlaceholder("密码").fill(DEMO_PASSWORD);
 await page.getByRole("button",{name:"登录",exact:true}).click();
 await page.waitForURL(/#\/dashboard/);
 const drawer=page.getByRole("dialog",{name:"使用指引",exact:true});
 const tour=page.locator(".el-tour__content:visible");
 async function help(){
   await page.getByRole("button",{name:"使用指引",exact:true}).click();
   await drawer.waitFor();
 }
 async function closeHelp(){await drawer.locator(".el-drawer__close-btn").click();await drawer.waitFor({state:"hidden"})}
 async function visit(path,marker){
   await page.goto(base+"/#"+path);
   await page.locator(".layout-content").getByText(marker,{exact:true}).first().waitFor();
   await page.waitForFunction(()=>!document.querySelector(".layout-content .el-loading-mask"));
 }
 const width=1920;
 for(const [id,path,title,marker] of modules){
  await visit(path,marker);
  await help();await drawer.getByRole("tab",{name:"当前页面",exact:true}).click();
  await drawer.locator(".guide-section-title").getByText(title,{exact:true}).waitFor();
  await drawer.getByRole("button",{name:"开始当前页面导览",exact:true}).click();
  await drawer.waitFor({state:"hidden"});
  for(let i=0;i<steps.length;i++){
   await tour.getByText(steps[i],{exact:true}).waitFor();
   const label=i===steps.length-1?"结束导览":"下一步";
   const control=tour.getByRole("button",{name:label,exact:true});
   const b=await control.boundingBox();
   assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=page.viewportSize().height+1,id+" "+width+" "+label+" outside viewport");
   if(i===2)await page.screenshot({path:join(out,id+"-"+width+".png"),animations:"disabled"});
   await control.click();
  }
  await tour.waitFor({state:"hidden"});
 }
 await visit("/assets/materials","新增物资");
 await help();await drawer.getByRole("tab",{name:"操作搜索",exact:true}).click();
 await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill("materials.create");
 await drawer.getByRole("button",{name:"新增物资 物资管理",exact:true}).click();
 await drawer.getByRole("button",{name:"定位当前按钮",exact:true}).click();
 await drawer.waitFor({state:"hidden"});
 await tour.getByText("新增物资",{exact:true}).waitFor();
 await tour.getByRole("button",{name:"结束导览",exact:true}).click();
 await tour.waitFor({state:"hidden"});
 // Original legacy actions with no production control are explicitly disclosed, never rendered as locatable.
 await help();
 await drawer.getByRole("tab",{name:"操作搜索",exact:true}).click();
 await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill("demands.delete");
 await drawer.getByRole("button",{name:"删除需求 专业需求",exact:true}).click();
 await drawer.getByRole("region",{name:"删除需求 专业需求"}).getByText(/新版未提供独立入口/).waitFor();
 assert.equal(await drawer.getByRole("button",{name:"定位当前按钮",exact:true}).count(),0);
 await closeHelp();
 // F1 works while the native CRUD form is active, without closing the unsaved form.
 await page.locator(".layout-content").getByRole("button",{name:"新增物资",exact:true}).click();
 const form=page.getByRole("dialog",{name:"新增物资",exact:true});
 await form.getByRole("textbox",{name:"物资名称"}).fill("只读指引不得保存");
 await page.keyboard.press("F1");
 await drawer.waitFor();
 await drawer.getByRole("tab",{name:"操作搜索",exact:true}).click();
 await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill("materials.save");
 await drawer.getByRole("button",{name:"保存 物资管理",exact:true}).click();
 await drawer.getByRole("button",{name:"定位当前按钮",exact:true}).click();
 await drawer.waitFor({state:"hidden"});
 await tour.getByText("保存",{exact:true}).waitFor();
 await tour.getByRole("button",{name:"结束导览",exact:true}).click();
 await tour.waitFor({state:"hidden"});
 assert.equal(await form.getByRole("textbox",{name:"物资名称"}).inputValue(),"只读指引不得保存");
 await form.locator(".el-dialog__headerbtn").click();
 await page.getByRole("dialog",{name:"放弃表单修改"}).getByRole("button",{name:"放弃修改",exact:true}).click();
 await form.waitFor({state:"hidden"});

 await visit("/business/demands", "新增专业需求");
 await page.locator('[data-guide-action="excel.import"]:visible').click();
 const exchange = page.getByRole("dialog", { name: "导入 Excel", exact: true });
 await exchange.getByRole("button", { name: "下载模板", exact: true }).waitFor();
 const financeLocation = page.url();
 const downloads = [];
 page.on("download", download => downloads.push(download.suggestedFilename()));
 await page.keyboard.press("F1");
 await drawer.waitFor();
 await drawer.getByRole("tab", { name: "操作搜索", exact: true }).click();
 const searchHelp = drawer.getByRole("textbox", { name: "搜索业务操作说明" });
 await searchHelp.fill("pricing.create");
 await drawer.getByRole("button", { name: /新增参考价格.*参考价格/ }).first().click();
 await drawer.getByRole("button", { name: "前往参考价格", exact: true }).click();
 await drawer.getByText(/请先关闭指引，保存或退出/).waitFor();
 assert.equal(page.url(), financeLocation);
 assert.equal(await exchange.isVisible(), true);
 await searchHelp.fill("excel.template");
 await drawer.getByRole("button", { name: /下载模板/ }).first().click();
 await drawer.getByRole("button", { name: "定位当前按钮", exact: true }).click();
 await drawer.waitFor({ state: "hidden" });
 const finishExcelTour = tour.getByRole("button", { name: "结束导览", exact: true });
 await finishExcelTour.waitFor();
 assert.equal(await finishExcelTour.evaluate(control => {
   const bounds = control.getBoundingClientRect();
   return control.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
 }), true);
 await finishExcelTour.click();
 await tour.waitFor({ state: "hidden" });
 assert.deepEqual(downloads, []);
 await exchange.getByRole("button", { name: "下载模板", exact: true }).waitFor();
 await exchange.locator(".el-dialog__headerbtn").click();
 await exchange.waitFor({ state: "hidden" });

 await visit("/funding/frameworks", "新增年度框架");
 assert.ok(await page.locator('[data-guide-action="frameworks.detail"]').count() > 1);
 await help();
 await drawer.getByRole("tab", { name: "操作搜索", exact: true }).click();
 await searchHelp.fill("frameworks.detail");
 await drawer.getByRole("button", { name: "查看资金概览 年度框架", exact: true }).click();
 await drawer.getByRole("button", { name: "定位当前按钮", exact: true }).click();
 await drawer.getByText(/当前没有唯一可定位/).waitFor();
 assert.equal(await tour.count(), 0);
 await closeHelp();
 await help();
 await drawer.getByRole("tab", { name: "操作搜索", exact: true }).click();
 await searchHelp.fill("pricing.create");
 const pricingHelp = drawer.getByRole("button", { name: /新增参考价格.*参考价格/ }).first();
 await pricingHelp.waitFor();
 if (await pricingHelp.getAttribute("aria-expanded") !== "true") await pricingHelp.click();
 await drawer.getByRole("button", { name: "前往参考价格", exact: true }).click();
 await drawer.waitFor({ state: "hidden" });
 await page.waitForURL(/#\/standards\/pricing/);
 await visit("/configuration/dictionaries", "新增计量单位");
 await page.getByRole("tab", { name: "杆塔材质", exact: true }).click();
 await page.getByRole("button", { name: "新增杆塔材质", exact: true }).waitFor();
 assert.equal(await page.locator('[data-guide-action="dictionaries.tower-material"]').count(), 1);
 await help();
 await drawer.getByRole("tab", { name: "操作搜索", exact: true }).click();
 await searchHelp.fill("dictionaries.tower-material");
 await drawer.getByRole("button", { name: "杆塔材质 基础数据", exact: true }).click();
 await drawer.getByRole("button", { name: "定位当前按钮", exact: true }).click();
 await drawer.waitFor({ state: "hidden" });
 await tour.getByText("杆塔材质", { exact: true }).waitFor();
 await tour.getByRole("button", { name: "结束导览", exact: true }).click();
 await tour.waitFor({ state: "hidden" });
 await visit("/assets/materials", "新增物资");
 await help();await drawer.getByRole("tab",{name:"模块导览",exact:true}).click();
 assert.equal(await drawer.locator(".guide-module-item").count(),13);
 await drawer.getByRole("tab",{name:"业务课程",exact:true}).click();
 await drawer.getByText("L01 基础配置",{exact:true}).waitFor();
 await drawer.getByText("L12 权限与正式审计",{exact:true}).waitFor();
 await drawer.getByText("正式环境只读教学",{exact:true}).waitFor();
 assert.equal(await drawer.getByText("实操通过",{exact:true}).count(),0);
 await drawer.getByRole("button",{name:"阅读",exact:true}).first().click();
 await drawer.getByRole("button",{name:"下一步",exact:true}).click();
 const progress=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith("sd-project-guides-v1:")));
 assert.equal(progress.length,1);assert.equal(JSON.parse(progress[0][1]).L01.stepIndex,1);
 await closeHelp();await page.reload();await page.locator(".layout-content").getByText("新增物资",{exact:true}).waitFor();
 await help();await drawer.getByRole("tab",{name:"业务课程",exact:true}).click();
 await drawer.getByRole("button",{name:"阅读",exact:true}).first().click();
 assert.ok(await drawer.locator(".el-step__title.is-process").count());
 await drawer.getByRole("tab",{name:"全流程实操",exact:true}).click();
 await drawer.getByRole("heading",{name:"需求到结项",exact:true}).waitFor();
 assert.equal(await drawer.getByRole("button",{name:"前往办理",exact:true}).count(),0);
 assert.deepEqual(writes,[],"Guide navigation and explanation may never write business data");
 assert.deepEqual(errors,[]);
 console.log("YOULAI_P10_GUIDES_OK 12 native module tours at 1920×1080, native action location, unsaved form, Excel portal, duplicate-anchor safety, 12 courses, persisted learning, formal-only teaching and zero write requests");
}catch(e){await page?.screenshot({path:join(out,"failure.png"),animations:"disabled"}).catch(()=>{});throw e}
finally{await browser?.close();await new Promise(r=>server.close(r));system.close();rmSync(dir,{recursive:true,force:true})}
