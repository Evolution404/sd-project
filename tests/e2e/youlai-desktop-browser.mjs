import assert from "node:assert/strict";
import { existsSync,mkdirSync } from "node:fs";
import { join,resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const f=approvedFixture({after:fn=>cleanup.push(fn)});
const staticDirectory=resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web");
assert.ok(existsSync(join(staticDirectory,"index.html")));
const server=httpServer(f.s,{staticDirectory});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch(existsSync(chromium.executablePath())?
  {headless:true}:{headless:true,channel:"chrome"});
const out=join(process.cwd(),"test-results/schema113/youlai-desktop");
mkdirSync(out,{recursive:true});
const runtimeErrors=[];
const routes=[
 ["dashboard","/dashboard","实际费用趋势"],["demands","/business/demands","新增专业需求"],
 ["projects","/business/projects","新增子项目"],["frameworks","/funding/frameworks","新增年度框架"],
 ["agreements","/funding/agreements","新增执行协议"],["finance","/funding/finance","费用与结算"],
 ["ledger","/assets/ledger","新增输电线路"],["materials","/assets/materials","新增物资"],
 ["standards","/standards/operations","新增作业对象"],["pricing","/standards/pricing","新增参考价格"],
 ["dictionaries","/configuration/dictionaries","新增计量单位"],["system","/configuration/system","功能权限"]
];
let page;
async function route(path,marker){
  await page.goto(base+"/#"+path);
  await page.waitForURL(url=>url.hash==="#"+path);
  await page.locator(".layout-navbar").waitFor({timeout:15000});
  assert.equal(await page.locator(".layout-root.layout--left").count(),1);
  assert.equal(await page.locator(".layout-main .layout-content").count(),1);
  if(marker)await page.getByText(marker,{exact:true}).first().waitFor();
}
async function assertTheme(dark){
  await page.waitForFunction(dark=>{
    const card=document.querySelector(".stat-card");
    if(!card)return false;
    const rgb=getComputedStyle(card).backgroundColor.match(/\d+(?:\.\d+)?/g)?.slice(0,3).map(Number)??[];
    if(rgb.length!==3)return false;
    const brightness=rgb.reduce((a,b)=>a+b,0)/3;
    return document.documentElement.classList.contains("dark")===dark&&(dark?brightness<120:brightness>170);
  },dark);
}
async function assertViewport(){
  const viewport=await page.evaluate(()=>({root:document.documentElement.scrollWidth,body:document.body.scrollWidth,viewport:window.innerWidth}));
  assert.ok(viewport.root<=viewport.viewport+1,"document overflow: "+JSON.stringify(viewport));
}
try{
  for(const colorScheme of ["light","dark"]){
    const context=await browser.newContext({viewport:{width:1920,height:1080},colorScheme});
    page=await context.newPage();
    page.on("pageerror",error=>runtimeErrors.push(error.message));
    await page.goto(base+"/#/login");
    await page.getByPlaceholder("用户名").fill("admin");
    await page.getByPlaceholder("密码").fill("Schema113-test-password");
    await page.getByRole("button",{name:"登录",exact:true}).click();
    await page.waitForURL(/#\/dashboard/);
    for(const [key,path,marker] of routes){
      await route(path,key==="finance"?undefined:marker);
      assert.ok(!page.url().includes("/login"),"deep link "+key+" must retain session");
      if(key==="materials"){
        await page.locator(".layout-content .el-pagination").waitFor();
        assert.equal(await page.locator(".layout-content .el-pagination").count(),1);
      }
    }
    await route("/dashboard","实际费用趋势");
    await assertTheme(colorScheme==="dark");
    assert.equal(await page.evaluate(()=>window.devicePixelRatio),1,"100% desktop scale");
    // Verify the actual settings control rather than changing an internal theme store.
    await page.locator(".layout-toolbar [class~='i-svg:setting']").click();
    const settings=page.locator(".settings-drawer:visible");
    await settings.getByText(colorScheme==="dark"?"明亮":"暗黑",{exact:true}).click();
    await assertTheme(colorScheme!=="dark");
    await settings.getByText(colorScheme==="dark"?"暗黑":"明亮",{exact:true}).click();
    await assertTheme(colorScheme==="dark");
    await settings.locator(".el-drawer__close-btn").click();
    await settings.waitFor({state:"hidden"});
    await assertViewport();
    await page.screenshot({path:join(out,"dashboard-1920-"+colorScheme+".png"),animations:"disabled"});
    await route("/assets/materials","新增物资");
    await page.screenshot({path:join(out,"materials-1920-"+colorScheme+".png"),animations:"disabled"});
    await route("/business/demands?demand="+f.demand.id);
    const drawer=page.locator(".el-drawer:visible");
    await drawer.getByText(f.demand.problem_description,{exact:true}).waitFor();
    await page.screenshot({path:join(out,"demand-detail-1920-"+colorScheme+".png"),animations:"disabled"});
    await drawer.getByRole("button",{name:"关闭",exact:true}).click();
    await drawer.waitFor({state:"hidden"});
    // Exercise the actual desktop sidebar with a keyboard in both directions.
    const sidebar=page.locator(".layout-sidebar");
    const initiallyCollapsed=await sidebar.evaluate(node=>node.classList.contains("is-collapsed"));
    const toggle=page.locator(".hamburger-wrapper");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(initiallyCollapsed=>document.querySelector(".layout-sidebar").classList.contains("is-collapsed")!==initiallyCollapsed,initiallyCollapsed);
    await page.keyboard.press("Space");
    await page.waitForFunction(initiallyCollapsed=>document.querySelector(".layout-sidebar").classList.contains("is-collapsed")===initiallyCollapsed,initiallyCollapsed);
    await assertViewport();
    await context.close();
  }
  assert.deepEqual(runtimeErrors,[],"all 12 entries and both standard desktop themes must not throw");
  console.log("YOULAI_DESKTOP_BROWSER_OK 12 modules, 1920x1080, light/dark, keyboard sidebar, native Pagination");
}catch(error){
  await page?.screenshot({path:join(out,"failure.png")}).catch(()=>undefined);
  throw error;
}finally{
  await browser.close();
  await new Promise(done=>server.shutdown(done));
  for(const fn of cleanup.reverse())await fn();
}
