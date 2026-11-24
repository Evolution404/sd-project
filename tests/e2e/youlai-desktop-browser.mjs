import assert from "node:assert/strict";
import { existsSync,mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const f=approvedFixture({after:fn=>cleanup.push(fn)});
const server=httpServer(f.s);
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch(existsSync(chromium.executablePath())?
  {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const out=join(process.cwd(),"test-results/schema113/youlai-desktop");
mkdirSync(out,{recursive:true});
const runtimeErrors=[];
page.on("pageerror",error=>runtimeErrors.push(error.message));
const routes=[
 ["dashboard","/dashboard"],["demands","/demands"],["projects","/projects"],
 ["frameworks","/frameworks"],["agreements","/agreements"],["finance","/finance"],
 ["ledger","/ledger"],["materials","/materials"],["standards","/standards"],
 ["pricing","/pricing"],["dictionaries","/dictionaries"],["system","/system"]
];
async function route(path){
  await page.goto(base+"/#"+path);
  await page.locator(".layout-navbar").waitFor({timeout:15000});
  assert.equal(await page.locator(".layout-root.layout--left").count(),1);
  assert.equal(await page.locator(".layout-main .layout-content").count(),1);
}
async function theme(dark){
  const actual=await page.locator("html").evaluate(node=>node.classList.contains("dark"));
  if(actual!==dark)await page.getByRole("button",{name:dark?"切换为深色":"切换为浅色",exact:true}).click();
  assert.equal(await page.locator("html").evaluate(node=>node.classList.contains("dark")),dark);
}
try {
  await page.goto(base+"/#/dashboard");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.locator(".layout-root").waitFor();
  for (const [key,path] of routes) {
    await route(path);
    await page.locator(".layout-content").waitFor();
    assert.ok(!page.url().includes("/login"),"deep link "+key+" must retain session");
    if (key==="materials") {
      await page.locator(".youlai-crud-surface").waitFor();
      assert.equal(await page.locator(".pagination-container .el-pagination").count(),1);
    }
  }
  for(const width of [1440,1280,960,760]){
    await page.setViewportSize({width,height:900});
    for(const dark of [false,true]) {
      await route("/dashboard");
      await theme(dark);
      // Wait until the 160ms native card background theme transition completes.
      await page.waitForTimeout(260);
      const metricContrast=await page.locator('.dashboard-metrics .metric-action').first().evaluate(node=>{
        const style=getComputedStyle(node);
        const rgb=style.backgroundColor.match(/\d+(?:\.\d+)?/g)?.slice(0,3).map(Number)??[];
        return {color:style.color,background:style.backgroundColor,brightness:rgb.reduce((a,b)=>a+b,0)/3, rootSurface:getComputedStyle(document.documentElement).getPropertyValue("--surface"),nodeSurface:style.getPropertyValue("--surface"),nodeInline:node.getAttribute("style"),nodeClass:node.className};
      });
      assert.ok(dark ? metricContrast.brightness<120 : metricContrast.brightness>170,
        "dashboard metric must use actual dark/light theme at "+width+": "+JSON.stringify(metricContrast));
      await page.mouse.move(645,145);
      const viewport=await page.evaluate(()=>({
        root:document.documentElement.scrollWidth,body:document.body.scrollWidth,
        viewport:window.innerWidth,nav:!!document.querySelector('.layout-navbar'),
      }));
      assert.ok(viewport.root<=viewport.viewport+1,
        "dashboard viewport-wide overflow at "+width+" "+(dark?"dark":"light")+": "+JSON.stringify(viewport));
      await page.screenshot({path:join(out,`dashboard-${width}-${dark?"dark":"light"}.png`),fullPage:true});
      await route("/materials");
      await page.locator(".youlai-crud-surface").waitFor();
      await page.mouse.move(645,145);
      await page.screenshot({path:join(out,`materials-${width}-${dark?"dark":"light"}.png`),fullPage:true});
      await route("/demands?demand="+f.demand.id);
      await page.locator(".business-detail-dialog:visible").waitFor({timeout:10000});
      await page.screenshot({path:join(out,`demand-detail-${width}-${dark?"dark":"light"}.png`),fullPage:true});
      await page.locator(".business-detail-dialog:visible").getByRole("button",{name:"关闭详情",exact:true}).click();
      await page.locator(".business-detail-dialog:visible").waitFor({state:"hidden"});
      if(width===760) {
        await page.getByRole("button",{name:"打开导航",exact:true}).click();
        await page.getByRole("dialog",{name:"业务导航",exact:true}).waitFor();
        await page.keyboard.press("Escape");
      }
    }
  }
  assert.deepEqual(runtimeErrors,[],"all 12 entries and 8 viewport-theme permutations must not throw");
  console.log("YOULAI_DESKTOP_BROWSER_OK 12 modules, 1440/1280/960/760 widths, light/dark, responsive navigation, source-powered Pagination");
} catch(error){
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
} finally{
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const fn of cleanup.reverse())await fn();
}
