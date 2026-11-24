import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { resolve,join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const clean=[];
const {s}=fixture({after:fn=>clean.push(fn)});
const server=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const port=server.address().port;
const root=process.cwd();
const output=join(root,"test-results","youlai-y2");
mkdirSync(output,{recursive:true});
let browser;
try{
  browser=await chromium.launch(existsSync(chromium.executablePath())?
    {headless:true}:{headless:true,channel:"chrome"});
  const page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const base=`http://127.0.0.1:${port}/`;
  await page.goto(base+"#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:12000});
  await page.goto(base+"#/configuration/system");
  await page.locator(".role-page").waitFor({timeout:15000});
  await page.getByText("项目正式立项批准",{exact:true}).waitFor({timeout:15000});
  assert.ok(await page.getByText("系统管理员",{exact:true}).count());
  assert.ok(await page.getByText("业务编制人员",{exact:true}).count());
  await page.screenshot({path:join(output,"admin-role-page-original-1920.png"),fullPage:true});
  await page.locator(".role-list__item").filter({hasText:"verifier"}).click();
  await page.getByRole("button",{name:"操作数据范围",exact:true}).click();
  const scopes=page.getByRole("dialog",{name:"操作数据范围"});
  const approvalScope=scopes.getByRole("combobox",{name:"项目正式立项批准的数据范围"});
  await approvalScope.locator("xpath=ancestor::div[contains(@class,'el-select') and not(contains(@class,'el-select__'))][1]").click();
  await page.getByRole("option",{name:"本账号所属组织及下级",exact:true}).click();
  await page.screenshot({path:join(output,"role-operation-data-scope-1920.png")});
  await scopes.getByRole("button",{name:"应用到待保存权限"}).click();
  await scopes.waitFor({state:"hidden"});
  await page.getByRole("button",{name:"保存",exact:true}).click();
  const scopePreview=page.getByRole("dialog",{name:"确认权限变更"});
  await scopePreview.getByText(/更新正式操作的数据范围/).waitFor();
  const [scopeResponse]=await Promise.all([
    page.waitForResponse(response=>response.url().endsWith("/api/roles/verifier/permissions")&&response.request().method()==="PUT"),
    scopePreview.getByRole("button",{name:"保存权限"}).click(),
  ]);
  assert.equal(scopeResponse.status(),200);
  const configured=await scopeResponse.json();
  assert.deepEqual(s.identity.scopesForRole("verifier"),configured.data_scopes);
  assert.deepEqual(configured.data_scopes,[{ permission_code:"project.approve",scope:"department_and_children",organization_ids:[] }]);
  await page.locator(".role-list__item").filter({hasText:"系统管理员"}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(button=>
    button.textContent?.trim()==="操作数据范围")?.disabled);
  const action=page.locator(".page-main").getByText("项目正式立项批准",{exact:true});
  await action.click();
  await page.getByRole("button",{name:"保存",exact:true}).click();
  const preview=page.getByRole("dialog",{name:"确认权限变更"});
  await preview.getByText(/撤回 项目正式立项批准/).waitFor();
  const [response]=await Promise.all([
    page.waitForResponse(response=>response.url().endsWith("/api/roles/admin/permissions")&&response.request().method()==="PUT"),
    preview.getByRole("button",{name:"保存权限"}).click(),
  ]);
  assert.equal(response.status(),200,"permission update must be persisted");
  await page.waitForURL(url=>url.hash.startsWith("#/login"),{timeout:15000});
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  // After forced re-login, the original deep link is restored intentionally.
  await page.waitForURL(url=>url.hash.startsWith("#/configuration/system"),{timeout:15000});
  const after=await page.evaluate(async()=> (await fetch("/api/session")).json());
  assert.ok(!after.permissions.includes("project.approve"),"admin's revoked approval remains absent");
  assert.ok(after.permissions.includes("role.manage"),"role management remains granted");
  assert.ok(after.permissions.includes("settlement.approve"),"other approval rights remain");
  await page.goto(base+"#/configuration/system");
  await page.getByText("项目正式立项批准",{exact:true}).waitFor({timeout:15000});
  const actionLabel=page.getByText("项目正式立项批准",{exact:true}).locator("xpath=ancestor::label[1]");
  assert.equal(await actionLabel.locator(".is-checked").count(),0,"revoked grant no longer checked");
  await page.goto(base+"#/configuration/audit");
  const scopeAudit=page.getByRole("row").filter({hasText:"角色权限变更"}).filter({hasText:"verifier"});
  await scopeAudit.getByRole("button",{name:"查看详情"}).click();
  const audit=page.getByRole("dialog",{name:"审计记录详情"});
  await audit.getByText(/department_and_children/).waitFor();
  await audit.locator(".el-drawer__close-btn").click();
  await page.getByRole("tab",{name:"账号安全事件",exact:true}).click();
  await page.getByRole("row").filter({hasText:"登录成功"}).filter({hasText:"admin"}).first().waitFor();
  await page.screenshot({path:join(output,"account-security-audit-1920.png")});
  assert.deepEqual(errors,[]);
  console.log("YOULAI_Y2_ROLE_BROWSER_OK upstream role page, editable admin, permission revoked, forced relogin, persisted");
} catch(error) {
  if(browser)for(const page of browser.contexts().flatMap(c=>c.pages()))
    await page.screenshot({path:join(output,"failure.png"),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();

  await new Promise(ok=>server.close(ok));
  for(const fn of clean.reverse())await fn();
}
