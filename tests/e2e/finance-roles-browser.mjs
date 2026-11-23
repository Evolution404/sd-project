import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {approvedFixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user:admin,project,approval,node,scope,demand}=approvedFixture({after:fn=>cleanup.push(fn)});
const passwords={admin:"Schema113-test-password"};
const actors={admin};
for(const role of ["editor","verifier","viewer"]) {
  passwords[role]="Finance-UI-"+role+"-Password";
  s.auth.saveUser(admin,{username:role,password:passwords[role],role,status:"active"});
  actors[role]=s.auth.login(role,passwords[role]).user;
}
const draft=s.finance.saveDraft(actors.editor,project.id,{
  approval_version_id:approval.id,
  items:[{cost_node_id:node.id,project_scope_id:scope.id,
    amount_fen:12500,quantity_scaled:10000,evidence:"审批交接账单"}],
  resolutions:[{project_scope_id:scope.id,resolved_quantity_scaled:10000,
    evidence:"已核查完成范围"}],
});
s.finance.submit(actors.editor,draft.id,{expected_version:0,expected_edit_version:1});
const prior = s.finance.saveDraft(actors.editor, project.id, {
  mode:"itemized", items:[{ cost_node_id:node.id, amount_fen:1000, evidence:"对账权限验收" }],
});
s.finance.submit(actors.editor, prior.id, {expected_version:0,expected_edit_version:1});
s.finance.review(actors.verifier, prior.id, {expected_version:1,expected_event_seq:1,action:"approve"});

const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const contexts=[],errors=[];
const output=join(process.cwd(),"test-results/schema113/finance-roles");
mkdirSync(output,{recursive:true});
async function as(role) {
  const context=await browser.newContext({viewport:{width:1450,height:1040}});
  contexts.push(context);
  const page=await context.newPage();
  page.on("pageerror",err=>errors.push(role+": "+err.message));
  await page.goto(base+"/#/projects/"+project.id+"/finance");
  await page.getByLabel("用户名",{exact:true}).fill(role);
  await page.getByLabel("密码",{exact:true}).fill(passwords[role]);
  await page.getByRole("button",{name:"登录",exact:true}).click();
  const detail=page.locator(".business-detail-page:visible");
  await detail.getByText(project.name,{exact:true}).first().waitFor();
  await detail.getByRole("tab", { name: "结算单", exact: true }).click();
  if (role === "admin" || role === "editor") await detail.getByRole("button",{name:"新增结算",exact:true}).waitFor();
  const bill=detail.getByRole("row").filter({hasText:draft.number}).first();
  await bill.waitFor();
  return {page,detail,bill};
}
function button(area,name) {return area.getByRole("button",{name,exact:true});}
const section = (actor, name) => actor.detail.getByRole("tab", { name, exact: true }).click();
async function openReconciliation(actor) {
  await section(actor, "结算单");
  await button(actor.detail, prior.number).click();
  await button(actor.detail, "逐笔对账").click();
}
async function closeReconciliation(actor) {
  await button(actor.detail, "关闭单据详情").click();
}
try {
  const owner=await as("admin");
  assert.equal(await button(owner.detail,"新增结算").isEnabled(),true);
  await openReconciliation(owner);
  assert.equal(await button(owner.detail,"新增正式核对").isEnabled(),true);
  await closeReconciliation(owner);
  await section(owner, "实际费用");
  assert.equal(await button(owner.detail,"核定费用").isEnabled(),true);
  await owner.page.screenshot({path:join(output,"01-admin.png"),fullPage:true});
  // A summary failure must leave a working settlement list and preserve its last known totals.
  await owner.page.route("**/api/projects/*/summary", route => route.abort());
  await owner.detail.getByText("包含已删除费用", {exact:true}).click();
  await owner.detail.locator(".el-alert--error")
    .filter({hasText:"结算总览"}).waitFor();
  await section(owner, "结算单");
  await owner.bill.waitFor();
  assert.equal(await button(owner.detail,"导出 Excel").isEnabled(),true);
  await owner.detail.getByRole("region",{name:"项目结算总览"}).waitFor();
  await owner.page.unroute("**/api/projects/*/summary");
  await button(owner.detail, "重新读取费用数据").click();
  await owner.detail.locator(".el-alert--error").filter({hasText:"费用数据读取失败"}).waitFor({state:"hidden"});

  // A failed settlement query must keep the visible rows and block export of the old query.
  const filteredBills = url => url.pathname.endsWith("/settlements") && (url.searchParams.get("filters") || "").includes("999");
  await owner.page.route(filteredBills, route => route.abort());
  await button(owner.detail, "筛选本次金额").click();
  const amount = owner.page.getByPlaceholder("筛选本次金额", {exact:true});
  await amount.fill("999.00");
  await amount.press("Enter");
  await owner.detail.locator(".el-alert--error").filter({hasText:"结算单"}).waitFor();
  await owner.bill.waitFor();
  assert.equal(await button(owner.detail,"导出 Excel").isDisabled(),true);
  await owner.page.unroute(filteredBills);
  await button(owner.detail, "重新读取费用数据").click();
  await owner.bill.waitFor({state:"hidden"});
  await owner.detail.locator(".el-alert--error").filter({hasText:"费用数据读取失败"}).waitFor({state:"hidden"});

  const editor=await as("editor");
  assert.equal(await button(editor.detail,"新增结算").isEnabled(),true);
  await section(editor, "实际费用");
  assert.equal(await button(editor.detail,"核定费用").isDisabled(),true);
  await editor.detail.getByText("费用核定须由具备审核权限的人员办理").waitFor();
  await openReconciliation(editor);
  assert.equal(await button(editor.detail,"新增正式核对").isDisabled(),true);
  await editor.detail.getByText("正式费用核对须由具备审核权限的人员办理").waitFor();
  await closeReconciliation(editor);
  await section(editor, "结算单");
  assert.equal(await button(editor.bill,"审核结算").count(),0);
  const directReview = new URL(editor.page.url());
  directReview.hash = `/projects/${project.id}/settlements/${draft.id}/review`;
  await editor.page.goto(directReview.toString());
  const editorReview = editor.page.getByRole("region", { name: "审核结算", exact: true });
  await editorReview.getByText("当前账号或结算状态无法审核").waitFor();
  assert.equal(await button(editorReview,"确认批准结算").count(),0);
  await editor.page.screenshot({path:join(output,"02-editor.png"),fullPage:true});

  const viewer=await as("viewer");
  await section(viewer, "实际费用");
  assert.equal(await button(viewer.detail,"核定费用").isDisabled(),true);
  await openReconciliation(viewer);
  assert.equal(await button(viewer.detail,"新增正式核对").isDisabled(),true);
  await closeReconciliation(viewer);
  await section(viewer, "结算单");
  assert.equal(await button(viewer.detail,"新增结算").count(),0);
  await viewer.detail.getByText("当前账号可查看及导出结算").waitFor();
  assert.equal(await button(viewer.bill,"审核结算").count(),0,
    "read-only viewers have no review action");
  await viewer.bill.getByRole("button",{name:"更多操作"}).click();
  const viewMenu=viewer.page.getByRole("menu").filter({
    has:viewer.page.getByRole("menuitem",{name:"历史",exact:true}),
  });
  assert.equal(await viewMenu.getByRole("menuitem",{name:"历史",exact:true}).isEnabled(),true);
  assert.equal(await viewMenu.getByRole("menuitem",{name:"审核中（禁止修订）",exact:true}).isDisabled(),true);
  await viewer.page.keyboard.press("Escape");
  await viewer.page.screenshot({path:join(output,"03-viewer.png"),fullPage:true});
  assert.equal(s.finance.settlement(draft.id).review.action,"submit");

  const verifier=await as("verifier");
  assert.equal(await button(verifier.detail,"新增结算").count(),0);
  await verifier.detail.getByText("当前账号可查看及导出结算").waitFor();
  await section(verifier, "实际费用");
  assert.equal(await button(verifier.detail,"核定费用").isEnabled(),true);
  await openReconciliation(verifier);
  assert.equal(await button(verifier.detail,"新增正式核对").isEnabled(),true);
  await closeReconciliation(verifier);
  await section(verifier, "结算单");
  const documentPath = url => url.pathname === `/api/projects/${project.id}/settlements/${draft.id}`;
  await verifier.page.route(documentPath, route => route.abort(), {times:1});
  await button(verifier.bill, "审核结算").click();
  const financeReview = verifier.page.getByRole("region", {name:"审核结算",exact:true});
  await button(financeReview, "重新读取").waitFor();
  assert.equal(await button(financeReview, "确认批准结算").count(), 0);
  await button(financeReview, "重新读取").click();
  await financeReview.getByRole("columnheader", {name:"费用科目",exact:true}).waitFor();
  await financeReview.getByRole("cell", {name:node.name,exact:true}).waitFor();
  const reviewDemand = financeReview.getByRole("cell", {name:demand.demand_no + " · " + demand.problem_description,exact:true}).first();
  await reviewDemand.waitFor();
  assert.equal(await reviewDemand.locator(".cell").evaluate(cell => getComputedStyle(cell).whiteSpace), "normal");
  await financeReview.getByRole("cell", {name:"套",exact:true}).waitFor();
  await verifier.page.screenshot({path:join(output,"04-verifier-review.png"),fullPage:true});
  await button(financeReview, "确认批准结算").click();
  await verifier.bill.getByText(/已批准/).waitFor();
  const reviewed=s.finance.settlement(draft.id);
  assert.equal(reviewed.review.action,"approve");
  assert.equal(reviewed.review.actor_id,actors.verifier.id);
  assert.equal(s.finance.summary(project.id).settlement_fen,13500);
  await verifier.page.screenshot({path:join(output,"04-verifier-approved.png"),fullPage:true});

  await viewer.page.reload();
  await viewer.bill.waitFor();
  assert.equal(await button(viewer.bill,"审核结算").count(),0,
    "approved settlement must not expose a second approve action");
  assert.deepEqual(errors,[]);
  console.log("FINANCE_ROLES_BROWSER_OK admin all, editor drafts only, verifier cost+review, viewer history only, real settlement approval recorded and no duplicate approve");
} finally {
  for(const context of contexts.reverse())await context.close();
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const done of cleanup.reverse())await done();
}
