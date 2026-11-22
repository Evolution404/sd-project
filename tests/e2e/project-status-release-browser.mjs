import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,framework,project,scope}=approvedFixture({after:fn=>cleanup.push(fn)});
s.projects.save(user,{code:"P-RES-01",name:"储备状态项目",framework_id:framework.id});
let stocked=s.projects.save(user,{code:"P-STOCK-01",name:"已入库状态项目",framework_id:framework.id});
stocked=s.projects.stock(user,stocked.id,{expected_version:1});
const server=httpServer(s);
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1400,height:950}});
const errors=[];
page.on("pageerror",e=>errors.push(e.message));
const out=join(process.cwd(),"test-results/schema113/project-status-release");
mkdirSync(out,{recursive:true});
try {
  await page.goto("http://127.0.0.1:"+server.address().port+"/#/projects");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("columnheader",{name:/项目状态/}).waitFor();
  const states=[
    ["储备","储备状态项目"],
    ["已入库","已入库状态项目"],
    ["已批准","测试子项目"],
    ["已结项",null],
  ];
  for (const [state,name] of states) {
    await page.getByRole("tab",{name:state,exact:true}).click();
    await page.waitForFunction(name=>!!document.querySelector("[role=tab][aria-selected=true]")?.textContent?.includes(name),state);
    if(name) {
      await page.getByRole("row").filter({hasText:name}).waitFor();
      assert.equal(await page.getByRole("row").filter({hasText:name}).count(),1);
    } else {
      // The tab changes instantly; await the remote response before checking
      // that the previous tab's rows have disappeared.
      await page.getByRole("row").filter({hasText:"测试子项目"}).waitFor({state:"hidden"});
    }
    for (const [otherState,otherName] of states) if(otherName && otherName!==name)
      assert.equal(await page.getByRole("row").filter({hasText:otherName}).count(),0,
        state+" must exclude "+otherState);
  }
  await page.getByRole("tab",{name:"已批准",exact:true}).click();
  await page.getByRole("row").filter({hasText:"测试子项目"}).waitFor();
  await page.screenshot({path:join(out,"project-stage-tabs.png"),fullPage:true});
  await page.getByRole("row").filter({hasText:"测试子项目"}).locator(".cell-link:visible").first().click();
  const detail=page.locator(".business-detail-dialog:visible");
  await detail.getByRole("tab",{name:"承接需求"}).click();
  await detail.getByText("当前正式批准范围内的需求不可直接解绑").waitFor();
  const release=detail.getByRole("button",{name:"解除承接",exact:true});
  await release.waitFor();
  assert.ok(await release.isDisabled(),"approved bound demand must have disabled release action");
  assert.match((await release.getAttribute("title"))||"",/正式批准范围/);
  await page.screenshot({path:join(out,"approved-scope-release-disabled.png"),fullPage:true});
  s.projectClosure.commit(user,project.id,{preview_hash: s.projectClosure.preview(user, project.id).preview_hash, expected_version:project.version});
  await page.reload();
  await page.getByRole("tab",{name:"已结项",exact:true}).click();
  await page.getByRole("row").filter({hasText:"测试子项目"}).locator(".cell-link:visible").first().click();
  await detail.getByRole("tab",{name:"承接需求"}).click();
  await detail.getByText("项目已结项，最新版正式批准范围内的需求保持原承接关系及历史。").waitFor();
  await release.waitFor();
  assert.ok(await release.isDisabled(),"closed project must retain its approved binding");
  assert.match((await release.getAttribute("title"))||"",/已结项.*正式批准范围/);
  await page.screenshot({path:join(out,"closed-approved-release-disabled.png"),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("PROJECT_STATUS_RELEASE_BROWSER_OK four stage tabs, visible status column, approved release disabled and guidance");
} catch(error) {
  console.error("PROJECT_STATUS_RELEASE_BROWSER_ERROR",errors);
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const done of cleanup.reverse())await done();
}
