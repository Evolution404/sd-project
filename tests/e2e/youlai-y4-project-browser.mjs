import {pickNativeRows, selectWorksheetCell, worksheetCanvas, typeWorksheetCell} from "./youlai-business-worksheet-helpers.mjs";
import { enterSettlementQuantity, settlementCanvas } from "./youlai-settlement-grid-helpers.mjs";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { chromium } from "playwright";
import { resolve } from "node:path";
const cleanup=[];
const {s,user,save,demandInput,unit}=fixture({after:f=>cleanup.push(f)});
const approvedMaterial=s.materials.save(user,{unit_id:unit.id,name:"批准专用物资",model:"TEST-APPROVAL",specification:"测试",note:"",status:"active"});
const fw=save("frameworks",{name:"项目归属测试框架",fiscal_year:2026,limit_fen:5000000});
const positions=demandInput.work_locations.concat(Array.from({length:17},(_,index)=>{
  const tower=save("physical",{asset_no:"SCOPE-T"+(index+20),tower_material:"angle"});
  return {location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000};
}));
const demand=s.demands.save(user,{...demandInput,work_locations:positions});
const candidateTowers=Array.from({length:5},(_,index)=>save("physical",{
  asset_no:"CANDIDATE-T"+(index+1),tower_material:"angle",
}));
const candidate=s.demands.save(user,{
  ...demandInput, problem_description:"新增候选杆塔防鸟任务",
  work_locations:candidateTowers.map(tower=>({location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000})),
});
const passwords = {
  admin: "Schema113-test-password", editor: "editor-project-test-password",
  verifier: "verifier-project-test-password", viewer: "viewer-project-test-password",
};
const accounts = Object.fromEntries(["editor", "verifier", "viewer"].map(role =>
  [role, s.auth.saveUser(user, { username: role, password: passwords[role], role })]));
const backend=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
await new Promise(r=>backend.listen(0,"127.0.0.1",r));
let browser;
try {
  browser=await chromium.launch({headless:true,channel:"chrome"});
  const base = "http://127.0.0.1:" + backend.address().port + "/";
  const runtimeErrors=[];
  async function signIn(role) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("pageerror", error => runtimeErrors.push(role + ": " + error.message));
    await page.goto(base + "#/login");
    await page.getByPlaceholder("用户名").fill(role);
    await page.getByPlaceholder("密码").fill(passwords[role]);
    await page.getByRole("button",{name:"登录",exact:true}).click();
    await page.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:15000});
    return page;
  }

  const admin = await signIn("admin");
  await admin.goto(base + "#/configuration/system");
  await admin.getByText("系统管理员",{exact:true}).first().waitFor();
  const editor = await signIn("editor");
  const verifier = await signIn("verifier");
  const viewer = await signIn("viewer");
  for (const row of [demand,candidate]) {
    await verifier.goto(base + "#/business/demands?demand=" + row.id);
    await verifier.locator(".el-drawer:visible").getByText(row.problem_description,{exact:true}).first().waitFor();
    await verifier.getByRole("button",{name:"确认专业需求",exact:true}).click();
    const [confirmed] = await Promise.all([
      verifier.waitForResponse(response => response.url().endsWith("/api/demands/" + row.id + "/status") &&
        response.request().method() === "POST"),
      verifier.getByRole("dialog",{name:"确认专业需求"}).getByRole("button",{name:"确定"}).click(),
    ]);
    assert.equal(confirmed.status(), 200);
    assert.equal(s.demands.get(row.id).status,"active");
  }
  let page = editor;
  await page.goto(base + "#/business/projects");
  await page.getByRole("button",{name:"新增子项目",exact:true}).click();
  const dialog=page.getByRole("dialog").last();
  await dialog.getByRole("textbox",{name:"项目名称"}).fill("新版项目操作验收");
  await dialog.getByRole("combobox",{name:"年度框架"}).click();
  await page.getByRole("option",{name:/项目归属测试框架/}).last().click();
  await dialog.getByRole("button",{name:"确定"}).click();
  await page.getByText("新版项目操作验收",{exact:true}).first().waitFor({timeout:10000});
  const list=s.projects.search({page:1,page_size:20,sort:"created_at",direction:"desc",deleted:false,filters:{},q:""}).items;
  const project=list.find(x=>x.name==="新版项目操作验收");
  assert.ok(project);
  assert.equal(project.framework_id,fw.id);
  const projectUrl = base + "#/business/projects?project=" + project.id;
  await viewer.goto(projectUrl);
  await viewer.getByRole("button",{name:"关闭详情"}).waitFor();
  assert.equal(await viewer.getByRole("button",{name:"新增子项目",exact:true}).count(),0);
  assert.equal(await viewer.getByRole("button",{name:"批量新增子项目",exact:true}).count(),0);
  assert.equal(await viewer.getByRole("button",{name:"确认入库"}).count(),0);
  await page.getByText("新版项目操作验收",{exact:true}).first().click();
  await page.getByRole("button",{name:"关联需求"}).click();
  const picker=page.getByRole("dialog",{name:"关联完整专业需求"});
  await picker.getByText("防鸟设施缺失").first().waitFor();
  await picker.getByRole("row").filter({hasText:"防鸟设施缺失"}).locator("label.el-checkbox").click();
  await picker.getByRole("button",{name:"关联已选完整需求（1）"}).click();
  await picker.waitFor({state:"hidden"});
  assert.equal(s.projects.get(project.id).scopes[0].proposed_quantity_scaled,260000);
  await page.getByRole("button",{name:"确认入库"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await page.getByText("项目已正式入库").waitFor({timeout:10000});
  assert.equal(s.projects.get(project.id).status,"stocked");
  assert.equal(s.demands.get(demand.id).binding.project_id,project.id);

  await page.getByRole("button",{name:"编制立项范围及预算"}).click();
  await page.waitForURL(/\/approval\/compile/);
  await page.getByRole("textbox",{name:"拟批准预算（元）"}).fill("1200.00");
  await page.getByRole("textbox",{name:"编制依据"}).fill("巡视记录确认完整作业范围");
  await page.getByRole("button",{name:"返回子项目"}).click();
  const leave=page.getByRole("dialog",{name:"离开办理页"});
  await leave.getByRole("button",{name:"继续办理"}).click();
  await leave.waitFor({state:"hidden"});
  assert.equal(await page.getByRole("textbox",{name:"拟批准预算（元）"}).inputValue(),"1200.00");
  await page.getByRole("button",{name:"添加批准物资",exact:true}).click();
  const materialPicker=page.getByRole("dialog",{name:"选择批准物资"});
  await materialPicker.getByRole("row").filter({hasText:"批准专用物资"}).locator("label.el-checkbox").click();
  await materialPicker.getByRole("button",{name:"添加所选物资（1）"}).click();
  const approvedCanvas=await worksheetCanvas(page.getByRole("region",{name:"批准物资数量",exact:true}));
  await typeWorksheetCell(page,approvedCanvas,1,3,[140,180,110,145,125],"0.5");
  await page.getByText(/该计量单位仅允许整数/).waitFor();
  assert.equal(s.projects.get(project.id).approvals.length,0);
  await typeWorksheetCell(page,approvedCanvas,1,3,[140,180,110,145,125],"3");
  await page.getByRole("button",{name:"保存立项草稿"}).click();
  await page.waitForURL(/\/approval\/review/);
  await page.getByRole("heading",{name:"审核首次立项"}).waitFor();
  let persisted=s.projects.get(project.id);
  assert.equal(persisted.display_status,"立项中");
  assert.equal(persisted.approval,null);
  assert.equal(persisted.approvals[0].scopes[0].materials[0].material_id,approvedMaterial.id);
  assert.equal(persisted.approvals[0].scopes[0].materials[0].approved_quantity_scaled,30000);
  await page.getByRole("row").filter({hasText:"批准专用物资"}).getByText("3",{exact:true}).waitFor();
  assert.deepEqual(persisted.approvals[0].scopes[0].locations.map(row=>row.approved_quantity_scaled),
    positions.map(row=>row.quantity_scaled));
  await page.getByRole("button",{name:"集中核价"}).click();
  const quote=page.getByRole("dialog",{name:"批准范围参考报价"});
  await quote.getByText("完整参考价 ¥2520.00",{exact:true}).waitFor();
  await quote.getByRole("button",{name:"确认正式报价"}).click();
  await page.getByText("已保存正式参考报价",{exact:true}).waitFor();
  await quote.getByRole("button",{name:"关闭报价"}).click();
  assert.equal(s.projects.get(project.id).approvals[0].reference.total_fen,252000);
  assert.equal(await page.getByRole("button",{name:"确认正式批准"}).isEnabled(),false);
  async function openReview() {
    page = verifier;
    await page.goto(projectUrl);
    await page.getByRole("button",{name:"刷新详情",exact:true}).click();
    await page.getByRole("button",{name:"审核批准草稿"}).click();
    await page.waitForURL(/\/approval\/review/);
  }
  await openReview();
  await page.getByRole("button",{name:"确认正式批准"}).click();
  await page.getByRole("dialog",{name:"正式批准"}).getByRole("button",{name:"确定"}).click();
  await page.getByText("已正式批准",{exact:true}).waitFor();
  persisted=s.projects.get(project.id);
  assert.equal(persisted.display_status,"已批准");
  const original=persisted.approval;
  assert.equal(original.approved_budget_fen,120000);
  assert.equal(original.approved_by,accounts.verifier.id);
  await viewer.goto(projectUrl);
  await viewer.getByRole("tab",{name:"正式业务追溯",exact:true}).click();
  const viewerDrawer=viewer.locator(".el-drawer:visible");
  await viewerDrawer.getByRole("button",{name:"首次批准项目",exact:true}).click();
  await viewerDrawer.getByRole("button",{name:"查看 "+demand.demand_no+" 第 1 版",exact:true}).click();
  await viewerDrawer.getByRole("heading",{name:"作业位置及工作量",exact:true}).waitFor();
  await viewerDrawer.getByRole("button",{name:"查看台账历史： T15",exact:true}).click();
  await viewerDrawer.getByRole("heading",{name:/T15/}).waitFor();
  await viewerDrawer.getByRole("button",{name:"返回上一条历史"}).click();
  await viewerDrawer.getByRole("button",{name:"返回上一条历史"}).click();
  await viewerDrawer.getByRole("button",{name:"查看 "+demand.demand_no+" 第 1 版",exact:true}).waitFor();
  page = editor;
  await page.goto(projectUrl);

  await page.getByRole("button",{name:"编制正式变更"}).click();
  await page.getByRole("textbox",{name:"拟批准预算（元）"}).fill("1500.00");
  await page.getByRole("textbox",{name:"变更原因"}).fill("补充相邻杆塔的现场任务");
  await pickNativeRows(page,{title:"选择候选需求",placeholder:"按需求编号或问题描述搜索",queries:[["新增候选杆塔防鸟任务",/新增候选杆塔防鸟任务/]],confirm:"纳入变更草稿"});
  await page.getByText("新增完整承接范围",{exact:true}).waitFor();
  const changeMaterials=await worksheetCanvas(page.getByRole("region",{name:"批准物资数量",exact:true}));
  await selectWorksheetCell(changeMaterials,1,0,[140,180,110,145,125]);
  await page.getByRole("button",{name:"移除选中物资",exact:true}).click();
  await page.getByRole("button",{name:"核对变更差异"}).click();
  await page.getByRole("dialog",{name:"核对正式变更差异"}).getByRole("row").filter({hasText:"批准专用物资"}).getByText("移除",{exact:true}).waitFor();
  await page.getByRole("dialog",{name:"核对正式变更差异"}).getByRole("button",{name:"确认并保存变更草稿"}).click();
  await page.waitForURL(/\/approval\/review/);
  await page.getByRole("heading",{name:"审核正式变更"}).waitFor();
  persisted=s.projects.get(project.id);
  assert.equal(persisted.display_status,"变更中");
  assert.equal(persisted.approval.id,original.id);
  assert.equal(persisted.approvals.find(row=>row.status==="draft").pending_scopes[0].snapshot.work_locations.length,5);
  assert.equal(s.demands.get(candidate.id).binding,null);
  await openReview();
  await page.getByRole("button",{name:"确认正式批准"}).click();
  await page.getByRole("dialog",{name:"正式批准"}).getByRole("button",{name:"确定"}).click();
  await page.getByText("已正式批准",{exact:true}).waitFor();
  page = editor;
  await page.goto(projectUrl);
  await page.getByRole("button",{name:"费用与结算",exact:true}).click();
  persisted=s.projects.get(project.id);
  assert.equal(persisted.approval.approved_budget_fen,150000);
  assert.equal(persisted.approval.approved_by,accounts.verifier.id);
  assert.equal(persisted.approvals.find(row=>row.id===original.id).approved_budget_fen,120000);
  assert.equal(persisted.approvals.find(row=>row.id===original.id).scopes[0].locations.length,20);
  assert.equal(persisted.approvals.find(row=>row.id===original.id).scopes[0].materials[0].approved_quantity_scaled,30000);
  assert.equal(persisted.approvals.find(row=>row.id===persisted.approval.id).scopes.flatMap(scope=>scope.materials).length,0);
  assert.equal(persisted.approvals.find(row=>row.id===persisted.approval.id).scopes
    .reduce((count,scope)=>count+scope.locations.length,0),25);
  assert.equal(s.demands.get(candidate.id).binding.project_id,project.id);
  await page.getByRole("button",{name:"新增结算草稿"}).click();
  const settlement=page.getByRole("region",{name:"编制结算草稿"});
  const grid = await settlementCanvas(settlement);
  const workspace = page.locator(".layout-content");
  await workspace.evaluate(node => { node.scrollTop = 0; });
  const box = await grid.boundingBox();
  assert.ok(box && box.y + 82 < page.viewportSize().height);
  const gridX = box.x + 550;
  const gridY = box.y + 82;
  await page.mouse.move(gridX, gridY);
  await page.mouse.wheel(0, 1600);
  await page.mouse.wheel(0, 1600);
  await page.mouse.click(gridX, gridY);
  await settlement.locator(".settlement-work-status").getByText(/SCOPE-T|CANDIDATE-T/).waitFor();
  assert.equal(await workspace.evaluate(node => node.scrollTop), 0, "sheet wheel at the boundary may not scroll the page");
  await page.mouse.move(box.x - 9, gridY);
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(() => document.querySelector(".layout-content").scrollTop > 0);
  await workspace.evaluate(node => { node.scrollTop = 0; });
  await page.mouse.move(gridX, gridY);
  await page.mouse.wheel(0, -2000);
  await page.mouse.click(gridX, gridY);
  await settlement.locator(".settlement-work-status").getByText(/批准余量/).waitFor();
  await enterSettlementQuantity(page, grid, 1, "4");
  await settlement.getByPlaceholder("如 1200.00").fill("500.00");
  await settlement.getByPlaceholder("请填写本次结算依据").fill("核实实际完成三套");
  await settlement.getByRole("button",{name:"保存草稿"}).click();
  await settlement.locator(".settlement-work-validation").getByText("超出批准余量 1 套").waitFor();
  assert.equal(s.finance.allSettlements().filter(row=>row.project_id===project.id).length,0);
  await settlement.getByRole("button",{name:"E2（T15）"}).click();
  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await settlement.locator(".settlement-work-validation").waitFor({state:"hidden"});
  await settlement.getByRole("button",{name:"保存草稿"}).click();
  await settlement.waitFor({state:"hidden"});
  assert.equal(s.finance.summary(project.id).settlement_fen,0);
  const bill=s.finance.allSettlements().find(row=>row.project_id===project.id);
  assert.ok(bill?.draft);
  await page.getByRole("row").filter({hasText:bill.number}).getByRole("button",{name:"查看详情"}).click();
  await page.getByRole("dialog",{name:"结算正式事实及草稿"})
    .getByRole("button",{name:"进入结算审核办理"}).click();
  let settlementDetail=page.getByRole("region",{name:"结算审核办理"});
  await settlementDetail.getByRole("button",{name:"复核并提交审核"}).click();
  await page.getByRole("dialog",{name:"提交结算审核"}).getByRole("button",{name:"确定"}).click();
  await page.getByText("已提交结算审核",{exact:true}).waitFor();
  assert.equal(s.finance.summary(project.id).settlement_fen,0);
  assert.equal(await settlementDetail.getByRole("button",{name:"审核通过"}).count(),0);
  assert.equal(s.finance.settlement(bill.id).review.actor_id,accounts.editor.id);
  const reviewUrl = page.url();
  await viewer.goto(reviewUrl);
  await viewer.waitForURL(url=>url.hash === "#/404");
  page = verifier;
  await page.goto(projectUrl);
  await page.getByRole("button",{name:"费用与结算",exact:true}).click();
  await page.getByRole("row").filter({hasText:bill.number}).getByRole("button",{name:"查看详情"}).click();
  await page.getByRole("dialog",{name:"结算正式事实及草稿"})
    .getByRole("button",{name:"进入结算审核办理"}).click();
  settlementDetail=page.getByRole("region",{name:"结算审核办理"});
  await settlementDetail.getByRole("button",{name:"审核通过"}).click();
  await page.getByRole("dialog",{name:"审核结算"}).getByRole("button",{name:"确定"}).click();
  await page.getByText("结算审核通过",{exact:true}).waitFor();
  assert.equal(s.finance.summary(project.id).settlement_fen,50000);
  assert.equal(s.finance.settlement(bill.id).review.actor_id,accounts.verifier.id);
  await settlementDetail.getByRole("button",{name:"返回结算列表"}).click();
  await page.getByRole("button",{name:"返回子项目"}).click();
  await page.getByRole("button",{name:"审核结项"}).click();
  const close=page.getByRole("dialog",{name:"结项核对"});
  await close.getByText(/以下未完成需求将释放剩余工作量/).waitFor();
  await close.getByRole("row").filter({hasText:"T15"}).getByRole("cell",{name:"3",exact:true}).first().waitFor();
  await close.getByRole("textbox",{name:"结项说明"}).fill("保留实际未完成量，后续项目接续");
  await close.getByRole("button",{name:"确认正式结项"}).click();
  await page.getByText("项目已正式结项",{exact:true}).waitFor();
  assert.equal(s.projects.get(project.id).status,"closed");
  assert.equal(s.demands.get(demand.id).binding,null);
  assert.equal(s.demands.get(candidate.id).binding,null);

  page = editor;
  await page.goto(base + "#/business/demands?demand=" + demand.id);
  await page.getByRole("button",{name:"创建子项目并承接",exact:true}).click();
  await page.waitForURL(url=>url.hash.includes("fromDemand=" + demand.id));
  const nextDialog=page.getByRole("dialog",{name:"创建子项目并承接"});
  await nextDialog.getByText(demand.demand_no,{exact:false}).waitFor();
  await nextDialog.getByText(/19\s*个剩余作业位置/).waitFor();
  await nextDialog.getByRole("textbox",{name:"项目名称"}).fill("剩余需求接续项目");
  await nextDialog.getByRole("button",{name:"关闭",exact:true}).click();
  await page.getByRole("dialog",{name:"放弃表单修改"}).getByRole("button",{name:"继续填写"}).click();
  assert.equal(await nextDialog.getByRole("textbox",{name:"项目名称"}).inputValue(),"剩余需求接续项目");
  await nextDialog.getByRole("combobox",{name:"年度框架"}).click();
  await page.getByRole("option",{name:/项目归属测试框架/}).last().click();
  await nextDialog.getByRole("button",{name:"确定"}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/business/projects?project="));
  const transferred=s.demands.get(demand.id).binding;
  assert.ok(transferred);
  assert.notEqual(transferred.project_id,project.id);
  const successor=s.projects.get(transferred.project_id);
  assert.equal(successor.name,"剩余需求接续项目");
  assert.equal(successor.scopes[0].proposed_quantity_scaled,230000);
  assert.equal(s.projects.get(project.id).approvals[0].scopes[0].demand_id,demand.id);
  assert.deepEqual(runtimeErrors,[]);
  console.log("YOULAI_Y4_PROJECT_OK 四角色，20+5 处完整范围，台账追溯，结算、结项释放、原需求接续");
}finally{
 await browser?.close();
 await new Promise(r=>backend.close(r));
 for(const fn of cleanup.reverse())await fn();
}
