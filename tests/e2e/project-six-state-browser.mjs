import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {approvedFixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,save,framework,project,approval,demand,demandInput}=approvedFixture({after:fn=>cleanup.push(fn)});
s.projects.save(user,{name:"六态_储备",framework_id:framework.id});
s.projects.stock(user,s.projects.save(user,{name:"六态_已入库",framework_id:framework.id}).id,{expected_version:1});
let initial=s.projects.save(user,{name:"六态_立项中",framework_id:framework.id});
const tower=save("physical",{asset_no:"SIX-WEB-01",tower_material:"angle"});
const newDemand=s.demands.save(user,{...demandInput,problem_description:"六态验收",
  work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}]});
s.demands.transition(user,newDemand.id,{expected_version:1,expected_event_seq:1,status:"active"});
initial=s.projects.link(user,initial.id,{demand_id:newDemand.id,expected_version:1});
initial=s.projects.stock(user,initial.id,{expected_version:initial.version});
initial=s.projects.approvalDraft(user,initial.id,{expected_version:initial.version,approved_budget_fen:32000,
  scopes:[{project_scope_id:initial.scopes[0].id,demand_version:1,
    locations:[{location_item_no:1,approved_quantity_scaled:10000}]}]});
assert.equal(initial.display_status,"立项中");

const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1380,height:960}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const out=join(process.cwd(),"test-results/schema113/project-six-state-browser");
mkdirSync(out,{recursive:true});
const detail=page.locator(".business-detail-dialog:visible");
async function selectStatus(status,name) {
  const response=page.waitForResponse(r=>r.url().includes("/api/projects?"),{timeout:10000});
  await page.getByRole("tab",{name:status,exact:true}).click();
  await response;
  if(name) {
    const row=page.getByRole("row").filter({hasText:name});
    await row.waitFor();
    assert.equal(await row.getByText(status,{exact:true}).count(),1);
  }
}
async function refresh() {
  await page.reload();
  await page.getByRole("columnheader",{name:/项目状态/}).waitFor();
}
try {
  await page.goto("http://127.0.0.1:"+server.address().port+"/#/projects");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("columnheader",{name:/项目状态/}).waitFor();
  for(const state of ["储备","已入库","立项中","已批准","变更中","已结项"])
    assert.equal(await page.getByRole("tab",{name:state,exact:true}).count(),1);
  await selectStatus("储备","六态_储备");
  await selectStatus("已入库","六态_已入库");
  await selectStatus("立项中","六态_立项中");
  await selectStatus("已批准",project.name);
  const change=s.projects.approvalDraft(user,project.id,{expected_version:project.version,
    expected_approval_version_id:approval.id,approved_budget_fen:121000,confirm_changes:true,
    scopes:[{project_scope_id:project.scopes[0].id,demand_version:demand.current_version,
      locations:demand.work_locations.map(loc=>({location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled}))}]});
  const draft=change.approvals.find(a=>a.status==="draft");
  await refresh();
  await selectStatus("变更中",project.name);
  await page.getByRole("row").filter({hasText:project.name}).locator(".cell-link:visible").first().click();
  await detail.locator(".detail-header").getByText("变更中", { exact: true }).waitFor();
  await detail.getByRole("button",{name:"查看变更差异",exact:true}).click();
  const review = page.getByRole("region", { name: "审核项目变更", exact: true });
  await review.getByRole("button", { name: "确认正式批准", exact: true }).waitFor();
  await page.screenshot({path:join(out,"project-change-pending.png"),fullPage:true});
  await review.getByRole("button", { name: "← 返回", exact: true }).click();
  await review.waitFor({ state: "hidden" });
  let revised=s.projects.discardApproval(user,project.id,draft.id);
  await refresh();
  await selectStatus("已批准",project.name);
  revised=s.finance.close(user,project.id,{expected_version:revised.version});
  await refresh();
  await selectStatus("已结项",project.name);
  assert.equal(revised.display_status,"已结项");
  assert.deepEqual(errors,[]);
  console.log("PROJECT_SIX_STATES_BROWSER_OK");
} catch(error) {
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const fn of cleanup.reverse())await fn();
}
