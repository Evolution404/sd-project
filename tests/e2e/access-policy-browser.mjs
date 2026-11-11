import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const {s}=fixture({after: fn=>cleanup.push(fn)});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const executable=chromium.executablePath();
const browser=await chromium.launch(existsSync(executable)
  ? {headless:true} : {headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:960,height:860}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const path=join(process.cwd(),"test-results/schema113/access-policy");
mkdirSync(path,{recursive:true});
try {
  const base="http://127.0.0.1:"+server.address().port;
  await page.goto(base+"/#/system/ips");
  const login=page.locator(".login-card");
  await login.getByRole("heading",{name:"项目全流程管理",exact:true}).waitFor();
  assert.equal(await login.getByText("输电运检",{exact:false}).count(),0);
  assert.equal(await login.getByText("输电项目",{exact:false}).count(),0);
  assert.equal(await login.getByText("登录内网工作区",{exact:false}).count(),0);
  await page.screenshot({path:join(path,"login-960.png"),fullPage:true});
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("heading",{name:"系统管理",exact:true}).waitFor();
  const toggle=page.locator(".access-policy-settings .el-switch");
  await toggle.waitFor();
  assert.equal(await toggle.locator("input").isChecked(),true);
  await toggle.click();
  await page.getByText("访问限制已关闭",{exact:true}).waitFor();
  assert.equal(await toggle.locator("input").isChecked(),false);
  assert.equal(s.auth.permittedIp("192.0.2.80"),true);
  await page.screenshot({path:join(path,"restriction-off-960.png"),fullPage:true});
  await toggle.click();
  const confirm=page.getByRole("dialog",{name:"确认开启访问限制"});
  await confirm.getByRole("button",{name:"确认开启"}).click();
  await page.getByText("访问限制已开启",{exact:true}).waitFor();
  assert.equal(await toggle.locator("input").isChecked(),true);
  assert.equal(s.auth.permittedIp("192.0.2.80"),false);
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.locator("input").isChecked(),true);
  assert.deepEqual(errors,[]);
  console.log("ACCESS_POLICY_BROWSER_OK login branding, persisted toggle, confirmation and live IP restriction");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const done of cleanup) await done();
}
