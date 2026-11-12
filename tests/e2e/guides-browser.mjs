import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
const dir=mkdtempSync(join(tmpdir(),"sd-project-p10-guides-"));
const system=createSystem(join(dir,"data"));
system.auth.initialize("admin","P10-Guides-Test-Password");
const before={
  demands:system.demands.list().length,projects:system.projects.list().length,
  frameworks:system.catalog.list("frameworks").length,
};
const server=httpServer(system);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())?
  {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1500,height:1050}});
const errors=[],writes=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("request",request=>{
  if(["POST","PUT","PATCH","DELETE"].includes(request.method())&&
      request.url().includes("/api/")&&!request.url().endsWith("/api/login"))
    writes.push(request.method()+" "+request.url());
});
const out=join(process.cwd(),"test-results/p10/guides");
mkdirSync(out,{recursive:true});
const base="http://127.0.0.1:"+server.address().port;
async function openGuide(){
  await page.getByRole("button",{name:"使用指引",exact:true}).click();
  await page.getByRole("dialog",{name:"使用指引"}).waitFor();
  return page.getByRole("dialog",{name:"使用指引"});
}
try {
  await page.goto(base+"/#/demands");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("P10-Guides-Test-Password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  let drawer=await openGuide();
  await drawer.getByRole("tab",{name:"当前页面"}).click();
  await drawer.getByText("先记录现场问题",{exact:false}).first().waitFor();
  assert.equal(await drawer.getByRole("tab").count(),4);
  await page.screenshot({path:join(out,"guide-current-1500.png"),fullPage:true});
  await drawer.getByRole("tab",{name:"操作搜索"}).click();
  await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill("正式批准");
  await drawer.locator(".el-collapse-item").filter({hasText:"正式批准 · projects"})
    .locator(".el-collapse-item__header").click();
  await drawer.getByText("预算、数量与范围变化",{exact:false}).waitFor();
  assert.ok(await drawer.getByText("审核人员",{exact:false}).count()>0);
  await drawer.getByRole("tab",{name:"模块导览"}).click();
  assert.equal(await drawer.locator(".guide-module-item").count(),13);
  await drawer.getByRole("tab",{name:"业务课程"}).click();
  await drawer.getByText("L01 基础配置").waitFor();
  await drawer.getByText("L12 权限与正式审计").waitFor();
  await drawer.getByRole("button",{name:"阅读",exact:true}).first().click();
  await drawer.getByRole("button",{name:"下一步"}).click();
  await drawer.getByRole("button",{name:"返回全部课程"}).click();
  const localProgress=await page.evaluate(()=>Object.entries(localStorage)
    .filter(([key])=>key.startsWith("sd-project-guides-v1:")));
  assert.equal(localProgress.length,1);
  assert.ok(localProgress[0][1].includes('"state":"reading"'));
  assert.ok(!localProgress[0][1].includes("Password"));
  for(const width of [1500,1280,960,760]){
    await page.setViewportSize({width,height:1050});
    assert.ok(await drawer.isVisible());
    assert.ok(await drawer.boundingBox().then(rect=>rect&&rect.width<=width+1));
    await page.screenshot({path:join(out,"guide-course-"+width+".png"),fullPage:true});
  }
  await drawer.locator(".el-drawer__close-btn").click();
  await drawer.waitFor({state:"hidden"});
  drawer=await openGuide();
  await drawer.getByRole("tab",{name:"当前页面"}).click();
  await drawer.getByRole("button",{name:"开始当前页面导览"}).click();
  await page.getByText("本页面用于什么",{exact:true}).waitFor();
  await page.getByText("了解每项业务操作",{exact:false}).waitFor({state:"hidden"});
  await page.keyboard.press("Escape");
  await page.getByText("本页面用于什么",{exact:true}).waitFor({state:"hidden"});
  assert.deepEqual(writes,[],"opening/searching/touring/reading cannot write formal business data");
  assert.deepEqual(errors,[],"guide interactions must not emit runtime errors");
  assert.equal(system.demands.list().length,before.demands);
  assert.equal(system.projects.list().length,before.projects);
  assert.equal(system.catalog.list("frameworks").length,before.frameworks);
  console.log("P10_GUIDES_BROWSER_OK four help tabs, search, 12 modules+Excel, L01–L12, progress, ElTour, 4 widths, zero business writes");
} catch(error){
  console.error("P10_GUIDES_BROWSER_FAILURE",error.message,errors,writes);
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  system.close();
  rmSync(dir,{force:true,recursive:true});
}
