import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const { s, project, demand, operation, towers } = approvedFixture({
  after: action => cleanup.push(action),
});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1280,height:960}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const output=join(process.cwd(),"test-results/schema113/adopted-trace");
mkdirSync(output,{recursive:true});
const base="http://127.0.0.1:"+server.address().port;
const detail=page.locator(".business-detail-dialog:visible");
try {
  await page.goto(base+"/#/projects?project="+project.id+"&tab=scope");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await detail.getByRole("heading",{name:project.name,exact:true}).waitFor();
  await page.getByRole("tab",{name:"承接需求"}).click();
  await detail.getByRole("button",{name:demand.demand_no,exact:true}).click();
  await page.waitForURL(url=>url.hash.includes("#/demands")&&url.hash.includes("demand="+demand.id));
  await detail.getByText(demand.problem_description).first().waitFor();
  await detail.getByRole("button",{name:/查看采用的操作定义/}).click();
  await page.waitForURL(url=>url.hash.includes("#/standards/operations")&&
    url.hash.includes("record="+operation.id)&&
    url.hash.includes("adoptedVersion="+demand.operation_version));
  await detail.getByText("该需求正式采用第"+demand.operation_version+"版操作定义",{exact:false}).waitFor();
  await detail.getByRole("heading",{name:"完整版本与审计历史"}).waitFor();
  assert.equal(s.demands.get(demand.id).operation_version,demand.operation_version);
  await page.screenshot({path:join(output,"01-adopted-operation.png"),fullPage:true});
  await detail.getByRole("button",{name:"返回需求详情"}).click();
  await page.waitForURL(url=>url.hash.includes("#/demands")&&url.hash.includes("demand="+demand.id));
  const locations=detail.locator(".panel").filter({
    has:page.getByRole("heading",{name:"作业位置",exact:true}),
  });
  await locations.locator("tbody tr").first().locator("button").first().click();
  await page.waitForURL(url=>url.hash.includes("#/ledger/physical")&&
    url.hash.includes("record="+towers[0].id));
  await detail.getByRole("heading",{name:/T15/}).waitFor();
  await detail.getByRole("heading",{name:"完整版本与审计历史"}).waitFor();
  await page.screenshot({path:join(output,"02-physical-device-history.png"),fullPage:true});
  await detail.getByRole("button",{name:"返回需求详情"}).click();
  await page.waitForURL(url=>url.hash.includes("#/demands")&&url.hash.includes("demand="+demand.id));
  await detail.getByText(demand.problem_description).first().waitFor();
  assert.equal(s.demands.get(demand.id).work_locations[0].physical_tower_id,towers[0].id);
  assert.deepEqual(errors,[]);
  console.log("ADOPTED_TRACE_BROWSER_OK project->demand->frozen operation version->demand->physical device and history->demand with stable IDs");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const done of cleanup.reverse())await done();
}
