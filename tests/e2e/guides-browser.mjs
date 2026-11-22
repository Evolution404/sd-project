import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";
const dir=mkdtempSync(join(tmpdir(),"sd-project-p10-guides-"));
const data=join(dir,"data");
ensureDemoDatabase(data);
const system=createSystem(data);
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
async function assertReachable(control, step) {
  await control.waitFor({state:"visible"});
  const geometry = await control.evaluate(button => {
    const box = button.getBoundingClientRect();
    const card = button.closest(".el-tour__content").getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    return {
      cardFits: card.top >= 0 && card.left >= 0 && card.bottom <= height && card.right <= width,
      buttonFits: box.top >= 0 && box.left >= 0 && box.bottom <= height && box.right <= width,
      clickable: button.contains(document.elementFromPoint(box.x + box.width/2, box.y + box.height/2)),
    };
  });
  assert.deepEqual(geometry,{cardFits:true,buttonFits:true,clickable:true},step);
}
try {
  await page.goto(base+"/#/demands");
  await page.getByLabel("用户名",{exact:true}).fill(DEMO_ACCOUNT);
  await page.getByLabel("密码",{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  let drawer=await openGuide();
  await drawer.getByRole("tab",{name:"当前页面"}).click();
  await drawer.getByText("先记录现场问题",{exact:false}).first().waitFor();
  assert.deepEqual(await drawer.getByRole("tab").allTextContents(),
    ["当前页面","操作搜索","模块导览","全流程实操","业务课程"]);
  await page.screenshot({path:join(out,"guide-current-1500.png"),fullPage:true});
  await drawer.getByRole("tab",{name:"全流程实操"}).click();
  await drawer.getByRole("heading",{name:"需求到结项",exact:true}).waitFor();
  assert.equal(await drawer.getByRole("button",{name:"前往办理",exact:true}).count(),0,
    "普通演示环境展示独立训练入口说明");
  await drawer.getByRole("tab",{name:"操作搜索"}).click();
  await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill("正式批准");
  await drawer.locator(".el-collapse-item").filter({hasText:"正式批准 · 子项目管理"})
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
  await page.getByRole("status").filter({hasText:/^共 24 条$/}).waitFor();
  assert.equal(await page.locator("main .panel").first().evaluate(panel => panel.clientHeight > innerHeight),true,
    "Use a populated list long enough to reproduce the original out-of-viewport tour");
  const steps=["本页面用于什么","业务功能区域","从主要操作开始","查询、筛选与查看","正式历史与风险"];
  for (const width of [1512, 760]) {
    await page.setViewportSize({width,height:866});
    drawer=await openGuide();
    await drawer.getByRole("tab",{name:"当前页面"}).click();
    await drawer.getByRole("button",{name:"开始当前页面导览"}).click();
    await drawer.waitFor({state:"hidden"});
    const tour=page.locator(".el-tour__content:visible");
    for (const [index,title] of steps.entries()) {
      await tour.getByText(title,{exact:true}).waitFor();
      const label=index === steps.length-1 ? "结束导览" : "下一步";
      const next=tour.getByRole("button",{name:label,exact:true});
      const close=tour.getByRole("button",{name:"关闭此对话框",exact:true});
      await assertReachable(close,width+" "+title+" 退出");
      await assertReachable(next,width+" "+title+" "+label);
      if(index===3) await page.screenshot({path:join(out,"guide-long-list-"+width+".png")});
      if(index===1){
        const previous=tour.getByRole("button",{name:"上一步",exact:true});
        await assertReachable(previous,width+" "+title+" 上一步");
        await previous.click();
        await tour.getByText(steps[0],{exact:true}).waitFor();
        await assertReachable(next,width+" 返回首步");
        await next.click();
        await tour.getByText(title,{exact:true}).waitFor();
      }
      await next.click();
    }
    await tour.waitFor({state:"hidden"});
    // Closing the tour must release the overlay for the original table.
    await page.getByRole("tab",{name:"待承接",exact:true}).click();
    await page.getByRole("tab",{name:"全部需求",exact:true}).click();
    await page.getByRole("status").filter({hasText:/^共 24 条$/}).waitFor();
  }

  await page.setViewportSize({width:1512,height:866});
  await page.getByRole("button",{name:/青峰线15.*导线局部损伤/}).click();
  const detail=page.getByRole("dialog",{name:"需求详情",exact:true});
  await detail.getByRole("button",{name:"使用指引",exact:true}).click();
  drawer=page.getByRole("dialog",{name:"使用指引",exact:true});
  await drawer.getByRole("button",{name:"开始当前页面导览",exact:true}).click();
  await drawer.waitFor({state:"hidden"});
  const detailTour=page.locator(".el-tour__content:visible");
  for (const title of steps) {
    await detailTour.getByText(title,{exact:true}).waitFor();
    const label=title===steps.at(-1)?"结束导览":"下一步";
    const next=detailTour.getByRole("button",{name:label,exact:true});
    await assertReachable(next,"需求详情 "+title);
    await next.click();
  }
  await detailTour.waitFor({state:"hidden"});
  await detail.getByRole("button",{name:"关闭详情",exact:true}).click();
  await detail.waitFor({state:"hidden"});

  drawer=await openGuide();
  await drawer.getByRole("tab",{name:"业务课程"}).click();
  await drawer.getByRole("button",{name:"阅读",exact:true}).first().click();
  await drawer.getByRole("button",{name:"前往基础数据",exact:true}).click();
  await page.getByRole("heading",{name:"基础数据",exact:true}).waitFor();
  await drawer.waitFor({state:"hidden"});
  drawer=await openGuide();
  await drawer.getByRole("heading",{name:"L01 基础配置"}).waitFor();
  assert.ok(await drawer.getByRole("button",{name:"上一步",exact:true}).isEnabled());
  await drawer.getByRole("button",{name:"下一步",exact:true}).click();
  await drawer.getByRole("button",{name:"下一步",exact:true}).click();
  await drawer.getByRole("button",{name:"标记已阅读",exact:true}).click();
  await drawer.getByText("已阅读",{exact:true}).waitFor();
  await drawer.getByRole("button",{name:"返回全部课程",exact:true}).click();
  await drawer.getByRole("button",{name:"重学",exact:true}).click();
  assert.ok(await drawer.getByRole("button",{name:"上一步",exact:true}).isDisabled());
  await drawer.getByRole("button",{name:"返回全部课程",exact:true}).click();
  await drawer.getByRole("tab",{name:"模块导览"}).click();
  await drawer.getByRole("button",{name:"前往专业需求",exact:true}).click();
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  await drawer.waitFor({state:"hidden"});
  assert.deepEqual(writes,[],"opening/searching/touring/reading cannot write formal business data");
  assert.deepEqual(errors,[],"guide interactions must not emit runtime errors");
  assert.equal(system.demands.list().length,before.demands);
  assert.equal(system.projects.list().length,before.projects);
  assert.equal(system.catalog.list("frameworks").length,before.frameworks);
  console.log("P10_GUIDES_BROWSER_OK four help tabs, search, 12 modules+Excel, L01–L12, progress, guarded module links, five reachable tour steps on a populated long list at full and compact desktop widths, zero business writes");
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
