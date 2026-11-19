import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,save,operation,project:approved,demandInput}=approvedFixture({after:fn=>cleanup.push(fn)});
const project=s.projects.save(user,{name:"四角色待承接子项目",framework_id:approved.framework_id});
const physical=save("physical",{asset_no:"ROLE-T99",tower_material:"angle"});
const pending=s.demands.save(user,{
  ...demandInput,demand_no:"ROLE-PENDING-001",problem_description:"四角色共同办理的待确认需求",
  work_locations:[{location_kind:"physical_tower",physical_tower_id:physical.id,quantity_scaled:10000}],
  sources:[{description:"审核前的现场巡视"}],
});
const passwords={
  admin:"Schema113-test-password",
  editor:"Editor-Role-Password",
  verifier:"Verifier-Role-Password",
  viewer:"Viewer-Role-Password",
};
for(const role of ["editor","verifier","viewer"])
  s.auth.saveUser(user,{username:role,password:passwords[role],role,status:"active"});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const errors=[];
const output=join(process.cwd(),"test-results/schema113/four-roles");
mkdirSync(output,{recursive:true});
const openPages=[];
async function openAs(role,path="/#/demands?demand="+pending.id) {
  const context=await browser.newContext({viewport:{width:1280,height:920}});
  const page=await context.newPage();
  openPages.push(context);
  page.on("pageerror",error=>errors.push(role+": "+error.message));
  await page.goto(base+path);
  await page.getByLabel("用户名",{exact:true}).fill(role);
  await page.getByLabel("密码",{exact:true}).fill(passwords[role]);
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.locator(".shell").waitFor();
  return page;
}
async function rejectedMutation(page,url,body) {
  return await page.evaluate(async ({url,body}) => {
    const response=await fetch("/api"+url,{
      method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},
      body:JSON.stringify(body),
    });
    return {status:response.status,response:await response.json()};
  },{url,body});
}
const mutation={status:"active",expected_version:1,expected_event_seq:1};
try {
  // Administrator manages access policy and can inspect the same project.
  const admin=await openAs("admin","/#/system/ips");
  const switcher=admin.locator(".access-policy-settings .el-switch");
  await switcher.waitFor();
  assert.equal(await switcher.isEnabled(),true);
  assert.equal(await switcher.locator("input").isChecked(),true);
  await admin.goto(base+"/#/projects?project="+project.id+"&tab=scope");
  await admin.locator(".business-detail-dialog:visible")
    .getByRole("heading",{name:project.name,exact:true}).waitFor();
  await admin.screenshot({path:join(output,"01-admin-management-project.png"),fullPage:true});

  // Editor changes actual demand content; must not be able to confirm or approve.
  const editor=await openAs("editor");
  const editorDetail=editor.locator(".business-detail-dialog:visible");
  await editorDetail.getByText(pending.problem_description).first().waitFor();
  assert.equal(await editorDetail.getByRole("button",{name:"修订需求"}).isEnabled(),true);
  assert.equal(await editorDetail.getByRole("button",{name:"确认并待承接"}).isDisabled(),true);
  await editorDetail.getByText("当前账号没有需求确认权限",{exact:false}).waitFor();
  assert.equal((await rejectedMutation(editor,"/demands/"+pending.id+"/status",mutation)).status,403);
  const pricingDefinitionFailures=[];
  editor.on("response",res=>{
    if (res.url().includes("/attributes") && res.status() >= 400)
      pricingDefinitionFailures.push({status:res.status(),url:res.url()});
  });
  await editorDetail.getByRole("button",{name:"修订需求"}).click();
  const editDialog=editor.getByRole("region",{name:"修订需求"});
  await editDialog.getByLabel("问题描述",{exact:true}).fill("编辑人员核实现场事实并修订需求");
  await editDialog.getByRole("button",{name:"保存需求版本"}).click();
  await editDialog.waitFor({state:"hidden",timeout:12000});
  assert.deepEqual(pricingDefinitionFailures,[],"frozen version must use stable operation identity");
  assert.equal(s.demands.get(pending.id).problem_description,"编辑人员核实现场事实并修订需求");
  assert.equal(s.demands.get(pending.id).status,"pending");
  await editor.screenshot({path:join(output,"02-editor-updated-pending.png"),fullPage:true});

  // Verifier confirms the currently saved pending demand, cannot edit or bind it.
  const verifier=await openAs("verifier");
  const verifyDetail=verifier.locator(".business-detail-dialog:visible");
  await verifyDetail.getByText("编辑人员核实现场事实并修订需求").first().waitFor();
  assert.equal(await verifyDetail.getByRole("button",{name:"修订需求"}).isDisabled(),true);
  assert.equal(await verifyDetail.getByRole("button",{name:"确认并待承接"}).isEnabled(),true);
  await verifyDetail.getByText("当前账号没有需求修订权限",{exact:false}).waitFor();
  assert.equal((await rejectedMutation(verifier,"/demands/"+pending.id,{
    problem_description:"尝试越权编辑",
  })).status,403);
  await verifyDetail.getByRole("button",{name:"确认并待承接"}).click();
  await verifier.locator(".el-message-box:visible .el-button--primary").click();
  await verifyDetail.getByRole("button",{name:"关联子项目"}).waitFor();
  assert.equal(s.demands.get(pending.id).status,"active");
  assert.equal(await verifyDetail.getByRole("button",{name:"关联子项目"}).isDisabled(),true);
  await verifyDetail.getByText("关联子项目须由管理员或编辑人员办理",{exact:false}).waitFor();
  await verifier.screenshot({path:join(output,"03-verifier-confirmed.png"),fullPage:true});

  // The editor now binds the same confirmed demand into the existing project.
  await editor.reload();
  await editorDetail.getByRole("button",{name:"关联子项目"}).waitFor();
  await editorDetail.getByRole("button",{name:"关联子项目"}).click();
  const picker=editor.getByRole("dialog",{name:"选择子项目承接需求"});
  await picker.getByRole("row").filter({hasText:project.name})
    .getByRole("button",{name:"选择",exact:true}).click();
  await picker.getByRole("button",{name:"承接该需求"}).click();
  await editorDetail.getByRole("button",{name:"进入承接项目"}).waitFor();
  assert.equal(s.demands.get(pending.id).binding.project_id,project.id);
  await editorDetail.getByRole("button",{name:"进入承接项目"}).click();
  await editor.waitForURL(url=>url.hash.includes("#/projects")&&url.hash.includes("focus=demand"));
  await editor.locator(".business-detail-dialog:visible")
    .getByRole("heading",{name:project.name,exact:true}).waitFor();
  await editor.screenshot({path:join(output,"04-editor-linked-project.png"),fullPage:true});

  // Viewer may trace the formal business chain, but cannot mutate it even by API.
  const viewer=await openAs("viewer");
  const viewerDetail=viewer.locator(".business-detail-dialog:visible");
  await viewerDetail.getByRole("button",{name:"进入承接项目"}).waitFor();
  assert.equal(await viewerDetail.getByRole("button",{name:"修订需求"}).isDisabled(),true);
  await viewerDetail.getByText("当前账号没有需求修订权限",{exact:false}).waitFor();
  assert.equal((await rejectedMutation(viewer,"/demands/"+pending.id,{
    problem_description:"只读越权修改",
  })).status,403);
  assert.equal((await rejectedMutation(viewer,"/projects/"+project.id+"/link",{
    demand_id:pending.id,expected_version:s.demands.get(pending.id).current_version,
  })).status,403);
  assert.equal((await rejectedMutation(viewer,"/access-policy",{
    ip_restriction_enabled:false,expected_version:1,
  })).status,403);
  await viewerDetail.getByRole("button",{name:/查看采用的操作定义/}).click();
  await viewer.waitForURL(url=>url.hash.includes("#/standards/operations"));
  await viewer.locator(".business-detail-dialog:visible")
    .getByRole("button",{name:"返回需求详情"}).click();
  await viewer.waitForURL(url=>url.hash.includes("#/demands")&&url.hash.includes("demand="+pending.id));
  await viewerDetail.getByRole("button",{name:"进入承接项目"}).click();
  await viewer.waitForURL(url=>url.hash.includes("#/projects")&&url.hash.includes("project="+project.id));
  await viewer.screenshot({path:join(output,"05-viewer-history-readonly.png"),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("FOUR_ROLES_JOURNEY_OK admin setup, editor revise+bind, verifier activate, viewer trace; role-specific reasons and API bypass blocked");
} finally {
  for(const context of openPages.reverse())await context.close();
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const done of cleanup.reverse())await done();
}
