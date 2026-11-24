import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const callbacks=[];
const f=fixture({after: action => callbacks.push(action)});
f.s.demands.save(f.user,f.demandInput);
const server=httpServer(f.s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const port=server.address().port;
const cwd=process.cwd();
let browser;
const out=join(cwd,"test-results","youlai-y1");
mkdirSync(out,{recursive:true});
try {
  browser=await chromium.launch(existsSync(chromium.executablePath())
    ? {headless:true}:{headless:true,channel:"chrome"});
  const ctx=await browser.newContext({viewport:{ width: 1920, height: 1080 }});
  const page=await ctx.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  let loginRequests=0;
  page.on("request", request => {
    if (request.method()==="POST" && new URL(request.url()).pathname==="/api/login") loginRequests++;
  });
  const base=`http://127.0.0.1:${port}/`;
  await page.goto(base+"#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByPlaceholder("密码").press("Enter");
  await page.waitForURL(/#\/dashboard/, {timeout:20000});
  await page.locator(".dash-header__greeting").waitFor();
  assert.equal(loginRequests,1,"Enter submits a single login request");
  assert.ok(await page.getByText("专业需求",{exact:true}).count());
  assert.ok(await page.getByText("子项目管理",{exact:true}).count());
  assert.ok(await page.getByText("系统管理",{exact:true}).count());
  const session=await page.evaluate(async () =>(await fetch("/api/session")).json());
  assert.equal(session.username,"admin");
  const metrics=await page.locator(".stat-card__num").allInnerTexts();
  assert.ok(metrics.includes("1"),"dashboard should reflect actual saved demand");
  assert.equal(await page.locator(".dash-header__card").count(),1,
    "the production dashboard must run the original upstream layout");
  assert.equal(await page.locator(".stat-card").count(),4,
    "all four original cards must use real data");
  assert.ok(await page.getByText("实际费用趋势",{exact:true}).isVisible());
  assert.equal(await page.getByText("今日访客",{exact:true}).count(),0,
    "never display the upstream demo's fabricated visitor data");
  const width=1920;
  await page.screenshot({path:join(out,`admin-dashboard-${width}.png`),fullPage:false});
  assert.equal(await page.locator(".el-message--error").count(),0,
    "unimplemented upstream APIs must not show request-failure messages");
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<=1,`upstream dashboard viewport overflow at ${width}: ${overflow}px`);
  await page.reload();
  await page.waitForURL(/#\/dashboard/,{timeout:12000});
  await page.getByText("实际费用趋势",{exact:true}).waitFor();
  await page.goto(base+"#/business/demands");
  await page.waitForURL(url => url.hash === "#/business/demands");
  await page.locator(".layout-content").getByRole("button",{ name:"新增专业需求",exact:true }).waitFor();
  await page.screenshot({path:join(out,"admin-demands-1920.png"),fullPage:true});
  // A separate read-only account must not receive administrator navigation or API access.
  const viewer=f.s.auth.saveUser(f.user,{
    username:"y1-viewer",password:"y1-viewer-test-password",role:"viewer"
  });
  const reader=await browser.newContext({viewport:{ width: 1920, height: 1080 }});
  const readerPage=await reader.newPage();
  readerPage.on("pageerror",e=>errors.push(e.message));
  await readerPage.goto(base+"#/login");
  await readerPage.getByPlaceholder("用户名").fill("y1-viewer");
  await readerPage.getByPlaceholder("密码").fill("y1-viewer-test-password");
  await readerPage.getByRole("button",{name:"登录",exact:true}).click();
  await readerPage.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:15000});
  assert.equal(await readerPage.getByText("系统管理",{exact:true}).count(),0);
  const denied=await readerPage.evaluate(async()=> (await fetch("/api/users")).status);
  assert.equal(denied,403,"server must enforce permissions independently");
  await readerPage.screenshot({path:join(out,"viewer-dashboard-1920.png"),fullPage:true});
  f.s.auth.saveUser(f.user,{username:"y1-viewer",role:"viewer",status:"disabled"},viewer.id);
  await readerPage.reload();
  await readerPage.waitForURL(url=>url.hash.startsWith("#/login"),{timeout:12000});
  await reader.close();
  await page.locator(".layout-user").click();
  await page.getByRole("menuitem",{name:"退出登录",exact:true}).click();
  const logout = page.getByRole("dialog").filter({hasText:"确定注销并退出系统吗？"});
  await logout.getByRole("button",{name:"确定",exact:true}).click();
  await page.getByPlaceholder("用户名").waitFor();
  const loggedOut = await page.evaluate(async()=> (await fetch("/api/session")).status);
  assert.equal(loggedOut,401,"logout must revoke the authenticated session");
  assert.equal(errors.length,0,"unexpected runtime error: "+errors.join(";"));
  console.log("YOULAI_Y1_INTEGRATION_OK single-request Enter login, dashboard data, viewer denial, session revocation");
} catch(e) {
  if(browser) for(const p of browser.contexts().flatMap(c=>c.pages()))
    await p.screenshot({path:join(out,"failure.png"),fullPage:true}).catch(()=>{});
  throw e;
} finally {
  await browser?.close();

  await new Promise(ok=>server.close(ok));
  for(const clean of callbacks.reverse())await clean();
}
