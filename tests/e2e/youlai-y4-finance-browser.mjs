import assert from "node:assert/strict";
import {worksheetCanvas,typeWorksheetCell} from "./youlai-business-worksheet-helpers.mjs";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { chromium } from "playwright";
import { resolve,join } from "node:path";
import { mkdirSync } from "node:fs";
import ExcelJS from "exceljs";
import { columnIndex } from "../workbook-helpers.mjs";
import { copySettlementColumn, copySettlementSelection, enterSettlementQuantity, pasteSettlementCells,
  selectSettlementCell, settlementCanvas } from "./youlai-settlement-grid-helpers.mjs";
const cleanup=[];
const f=approvedFixture({after:fn=>cleanup.push(fn)});
const backend=httpServer(f.s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(r=>backend.listen(0,"127.0.0.1",r));
const port=backend.address().port;
const out=join(process.cwd(),"test-results/youlai-y4");
mkdirSync(out,{recursive:true});
let browser,page;
try{
  browser=await chromium.launch({headless:true,channel:"chrome"});
  page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
  page.setDefaultTimeout(12000);
  const runtimeErrors=[];
  page.on("pageerror",error=>runtimeErrors.push(error.message));
  await page.goto("http://127.0.0.1:"+port+"/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:16000});
  await page.goto("http://127.0.0.1:"+port+"/#/funding/finance");
  await page.getByRole("button",{name:"新增结算草稿"}).click();
  await page.getByText("测试子项目").first().waitFor({timeout:14000});
  await page.getByRole("row").filter({hasText:"测试子项目"}).getByRole("button",{name:"选择项目"}).click();
  await page.waitForURL(url=>url.hash.endsWith("/settlements/new"));
  const editor=page.getByRole("region",{name:"编制结算草稿"});
  const grid = await settlementCanvas(editor);
  const count = editor.getByTestId("settlement-filled-count");
  await count.getByText("0", { exact: true }).waitFor();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:" + port });
  await selectSettlementCell(grid, 1, 1);
  assert.equal((await copySettlementSelection(page)).trim(), f.demand.operation_snapshot);
  await page.keyboard.press("Escape");

  await enterSettlementQuantity(page, grid, 1, "2");
  await count.getByText("1", { exact: true }).waitFor();
  await selectSettlementCell(grid, 1);
  assert.equal((await copySettlementSelection(page)).trim(), "2");
  await selectSettlementCell(grid, 2);
  await page.keyboard.press("Shift+ArrowDown");
  await editor.getByText("已选 2 个单元格", { exact: true }).waitFor();
  await page.keyboard.press("ControlOrMeta+V");
  await count.getByText("3", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await count.getByText("1", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "重做", exact: true }).click();
  await count.getByText("3", { exact: true }).waitFor();
  assert.deepEqual(await copySettlementColumn(page, grid, 4, 3), ["2", "2", "2"]);

  await selectSettlementCell(grid, 1);
  await pasteSettlementCells(page, "2\t实际完成T15\n0.5\t\n3\t");
  // Select a different position first; consecutive clicks on the same canvas cell
  // are a native double-click edit gesture, not a selection gesture.
  await selectSettlementCell(grid, 3, 4);
  assert.deepEqual(await copySettlementColumn(page, grid, 4, 3), ["2", "0.5", "3"]);
  await editor.getByPlaceholder("如 1200.00").fill("800.00");
  await editor.getByPlaceholder("请填写本次结算依据").fill("新有来全量位置草稿验收");
  const save = editor.getByRole("button", { name: "保存草稿", exact: true });
  assert.equal(await save.isEnabled(), true);
  assert.equal(await editor.locator(".settlement-work-validation").count(), 0);
  await save.click();
  const panel = editor.getByRole("alert").filter({ hasText: "请修正 1 个数量单元格后保存" });
  await panel.getByRole("button", { name: "E3（T16）" }).waitFor();
  await panel.getByText("单位为套，请填写整数").waitFor();
  assert.equal(f.s.finance.allSettlements().length, 0, "invalid draft may not reach formal storage");
  await editor.screenshot({ path: join(out, "finance-worksheet-invalid.png"), animations: "disabled" });

  await enterSettlementQuantity(page, grid, 2, "1");
  await panel.waitFor({ state: "hidden" });
  await selectSettlementCell(grid, 2);
  await page.keyboard.press("a");
  await save.click();
  await panel.getByText("请填写有效的非负数量").waitFor();
  assert.equal(f.s.finance.allSettlements().length, 0, "the in-progress cell must be committed before validating");
  await enterSettlementQuantity(page, grid, 2, "1");
  await panel.waitFor({ state: "hidden" });
  assert.deepEqual(await copySettlementColumn(page, grid, 4, 3), ["2", "1", "3"]);
  await editor.getByRole("button",{name:"返回结算列表"}).click();
  const discard=page.getByRole("dialog",{name:"离开结算编制"});
  await discard.getByRole("button",{name:"继续编制"}).click();
  assert.equal(await editor.getByPlaceholder("如 1200.00").inputValue(),"800.00");
  assert.deepEqual(await copySettlementColumn(page, grid, 4, 3), ["2", "1", "3"]);
  await editor.screenshot({path:join(out,"finance-worksheet-1920.png")});
  await editor.getByRole("button",{name:"保存草稿"}).click();
  await editor.waitFor({state:"hidden",timeout:15000});
  const found=f.s.finance.allSettlements().find(x=>x.draft?.document.basis==="新有来全量位置草稿验收");
  assert.ok(found,"saved through unchanged formal service");
  assert.equal(found.draft.document.amount_fen,80000);
  assert.equal(found.draft.document.resolutions.length,3);
  assert.deepEqual(found.draft.document.resolutions.map(x=>x.resolved_quantity_scaled),[20000,10000,30000]);
  assert.equal(found.draft.document.resolutions[0].evidence,"实际完成T15");
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,0);
  const billRow=page.getByRole("row").filter({hasText:found.number}).first();
  await billRow.getByRole("button",{name:"查看详情"}).click();
  const drawer=page.getByRole("dialog",{name:"结算正式事实及草稿"});
  await drawer.getByText("实际完成T15").waitFor({timeout:10000});
  async function enterReview() {
    await drawer.getByRole("button",{name:"进入结算审核办理"}).click();
    await page.waitForURL(url=>url.hash.split("?")[0].endsWith("/review"));
  }
  await enterReview();
  const detail=page.getByRole("region",{name:"结算审核办理"});
  await detail.getByText("实际完成T15").waitFor({timeout:10000});
  await detail.getByRole("button",{name:"复核并提交审核"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await detail.getByRole("button",{name:"审核通过"}).waitFor({timeout:10000});
  const submitted=f.s.finance.allSettlements().find(x=>x.id===found.id);
  assert.equal(submitted.review.action,"submit");
  assert.equal(submitted.version.amount_fen,80000);
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,0);
  await detail.getByRole("button",{name:"退回结算"}).click();
  const returnPrompt=page.locator(".el-message-box:visible");
  await returnPrompt.getByRole("textbox").fill("请复核现场工作量");
  await returnPrompt.getByRole("button",{name:"确定"}).click();
  await detail.getByText("请复核现场工作量",{exact:true}).waitFor();
  assert.equal(f.s.finance.settlement(found.id).version.id,submitted.version.id);
  assert.equal(f.s.finance.settlement(found.id).review.action,"return");
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,0);
  await detail.getByRole("button",{name:"原版本重新提交"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await detail.getByRole("button",{name:"审核通过"}).waitFor();
  assert.equal(f.s.finance.settlement(found.id).version.id,submitted.version.id);
  assert.equal(f.s.finance.settlement(found.id).review.event_seq,3);
  await detail.getByRole("button",{name:"审核通过"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await page.getByText("结算审核通过").waitFor({timeout:12000});
  // Wait for the newly loaded server-backed state, not a potentially stale toast.
  await detail.getByRole("button",{name:"编制修订",exact:true}).waitFor();
  const reviewed=f.s.finance.allSettlements().find(x=>x.id===found.id);
  assert.equal(reviewed.review.action,"approve");
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,80000);

  const change=f.s.projects.approvalDraft(f.user,f.project.id,{
    expected_version:f.project.version,expected_approval_version_id:f.approval.id,
    approved_budget_fen:140000,confirm_changes:true,
    scopes:[{
      project_scope_id:f.scope.id,demand_version:1,
      locations:f.approval.scopes[0].locations.map(row=>({
        location_item_no:row.location_item_no,approved_quantity_scaled:row.approved_quantity_scaled,
      })),
    }],
  });
  f.s.projects.approve(f.user,change.id,change.approvals.find(row=>row.status==="draft").id,{
    expected_version:change.version,
  });
  await detail.getByRole("button",{name:"编制修订"}).click();
  const revision=page.getByRole("region",{name:"编制结算修订"});
  const revisedGrid = await settlementCanvas(revision);
  assert.deepEqual(await copySettlementColumn(page, revisedGrid, 4, 3), ["2", "1", "3"]);
  assert.deepEqual(await copySettlementColumn(page, revisedGrid, 8, 3), ["0", "0", "0"]);
  const approvalSelector=revision.locator(".el-form-item").filter({hasText:"采用批准版本"}).locator(".el-select");
  const switchDialog=page.getByRole("dialog",{name:"核对批准版本差异",exact:true});
  const chooseApproval=async (name,action)=>{
    await approvalSelector.click();
    await page.getByRole("option",{name,exact:true}).click();
    await switchDialog.getByRole("button",{name:action,exact:true}).click();
    await switchDialog.waitFor({state:"hidden"});
  };
  await chooseApproval("第 2 版（当前）","保持当前版本");
  await approvalSelector.getByText("第 1 版",{exact:true}).waitFor();
  assert.deepEqual(await copySettlementColumn(page, revisedGrid, 4, 3), ["2", "1", "3"]);
  assert.equal(Number(await revision.getByPlaceholder("如 1200.00").inputValue()),800);
  await chooseApproval("第 2 版（当前）","确认切换");
  await approvalSelector.getByText("第 2 版（当前）",{exact:true}).waitFor();
  await settlementCanvas(revision);
  await chooseApproval("第 1 版","确认切换");
  await approvalSelector.getByText("第 1 版",{exact:true}).waitFor();
  await revision.getByPlaceholder("如 1200.00").fill("850.00");
  await revision.getByRole("textbox",{name:"修订说明"}).fill("追加经核实的实际费用");
  await revision.getByRole("button",{name:"保存草稿"}).click();
  await revision.waitFor({state:"hidden"});
  let current=f.s.finance.settlement(found.id);
  assert.equal(current.draft.document.approval_version_id,f.approval.id);
  assert.equal(current.draft.document.change_type,"revision");
  assert.equal(current.draft.document.resolutions.length,3);
  assert.equal(current.effective_amount_fen,80000);
  await billRow.getByRole("button",{name:"查看详情"}).click();
  await enterReview();
  await detail.getByRole("button",{name:"复核并提交审核"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await detail.getByRole("button",{name:"审核通过"}).waitFor();
  assert.equal(f.s.finance.settlement(found.id).effective_amount_fen,80000);
  await detail.getByRole("button",{name:"审核通过"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await page.getByText("结算审核通过",{exact:true}).waitFor();
  // Wait for the newly loaded server-backed state, not a potentially stale toast.
  await detail.getByRole("button",{name:"编制修订",exact:true}).waitFor();
  current=f.s.finance.settlement(found.id);
  assert.equal(current.version.version_no,2);
  assert.equal(current.version.approval_version_id,f.approval.id);
  assert.equal(current.effective_amount_fen,85000);
  assert.equal(f.s.finance.history(found.id).find(row=>row.id===submitted.version.id).amount_fen,80000);

  await page.goto("http://127.0.0.1:"+port+"/#/business/projects?project="+f.project.id);
  await page.getByRole("button",{name:"费用与结算",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/funding/finance?project="));
  await page.getByRole("tab",{name:"费用科目、费用及核对"}).click();
  await page.getByRole("tab",{name:"费用科目",exact:true}).click();
  const nodeForm=page.getByRole("dialog",{name:"新增费用科目"});
  async function addCategory(name, parent) {
    const add = parent
      ? page.getByRole("row").filter({ has: page.getByRole("cell", { name: parent, exact: true }) })
        .getByRole("button", { name: "新增下级", exact: true })
      : page.getByRole("button", { name: "新增一级科目", exact: true });
    await add.click();
    await nodeForm.getByRole("textbox", { name: "科目名称" }).fill(name);
    await nodeForm.getByRole("button", { name: "保存科目" }).click();
    await nodeForm.waitFor({ state: "hidden" });
  }
  for (const group of ["现场费用分类", "工程费用分类", "停用费用分类"]) {
    await addCategory(group);
    await addCategory("现场核对费用", group);
  }
  const categories = f.s.finance.costTree(f.user, f.project.id);
  const siteGroup = categories.find(row => row.name === "现场费用分类");
  const costNode = categories.find(row => row.parent_id === siteGroup.id);
  const inactiveGroup = categories.find(row => row.name === "停用费用分类");
  await page.getByRole("row").filter({ has: page.getByText(inactiveGroup.name, { exact: true }) })
    .getByRole("button", { name: "修订", exact: true }).click();
  const reviseCategory = page.getByRole("dialog", { name: "修订费用科目" });
  await reviseCategory.getByText("停用", { exact: true }).click();
  await reviseCategory.getByRole("button", { name: "保存科目", exact: true }).click();
  await reviseCategory.waitFor({ state: "hidden" });
  assert.ok(costNode.selectable);
  assert.equal(f.s.finance.costTree(f.user, f.project.id).find(row => row.parent_id === inactiveGroup.id).selectable, false);

  async function selectSiteCost(scope) {
    await scope.getByRole("button", { name: "选择费用科目", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "选择费用科目", exact: true });
    await picker.getByRole("columnheader", { name: "科目名称", exact: true }).waitFor();
    await picker.getByRole("columnheader", { name: "上级科目", exact: true }).waitFor();
    const names = picker.getByRole("cell", { name: "现场核对费用", exact: true });
    await names.first().waitFor();
    assert.equal(await names.count(), 2, "a leaf of a disabled ancestor must not be offered");
    const selected = picker.getByRole("row").filter({ has: page.getByRole("cell", { name: siteGroup.name, exact: true }) });
    await selected.getByRole("button", { name: "选择", exact: true }).click();
    await picker.getByRole("button", { name: "确认选择（1）", exact: true }).click();
    await picker.waitFor({ state: "hidden" });
  }

  await page.getByRole("tab",{name:"实际费用",exact:true}).click();
  async function registerCost(title, yuan) {
    await page.getByRole("button",{name:"登记实际费用"}).click();
    const costForm=page.getByRole("dialog",{name:"登记实际费用"});
    await costForm.getByRole("textbox",{name:"费用事项"}).fill(title);
    await selectSiteCost(costForm);
    await costForm.getByRole("textbox",{name:"实际金额（元）"}).fill(yuan);
    const occurredOn=costForm.getByLabel("发生日期",{exact:true});
    await occurredOn.fill("2026-11-20");
    await occurredOn.press("Enter");
    await costForm.getByRole("textbox",{name:"费用凭据"}).fill("现场凭据已核实");
    await costForm.getByRole("button",{name:"核定费用"}).click();
    await costForm.waitFor({state:"hidden"});
  }
  await registerCost("实际发生的人工费","120.00");
  await registerCost("待作废的重复费用","30.00");
  assert.equal(f.s.finance.summary(f.project.id).actual_cost_fen,15000);
  assert.ok(f.s.finance.costs(f.project.id).every(row => row.cost_node_id === costNode.id));
  const redundant=page.getByRole("row").filter({hasText:"待作废的重复费用"});
  await redundant.getByRole("button",{name:"更多操作"}).click();
  await page.getByRole("menuitem",{name:"作废",exact:true}).click();
  const voidDialog=page.getByRole("dialog",{name:"作废实际费用"});
  await voidDialog.getByRole("textbox").fill("重复录入");
  await voidDialog.getByRole("button",{name:"确定"}).click();
  await redundant.getByText("已作废",{exact:true}).waitFor();
  assert.equal(f.s.finance.summary(f.project.id).actual_cost_fen,12000);
  await redundant.getByRole("button",{name:"删除",exact:true}).click();
  await page.getByRole("dialog",{name:"删除实际费用"}).getByRole("button",{name:"确定"}).click();
  await redundant.waitFor({state:"hidden"});
  assert.ok(f.s.finance.costs(f.project.id,true).some(row=>row.title==="待作废的重复费用"&&row.deleted));

  await page.getByRole("tab",{name:"结算单",exact:true}).click();
  await page.getByRole("button",{name:"新增结算草稿"}).click();
  const phased=page.getByRole("region",{name:"编制结算草稿"});
  await phased.locator(".el-form-item").filter({hasText:"结算方式"}).locator(".el-select").click();
  await page.getByRole("option",{name:"按子费用",exact:true}).click();
  await phased.getByPlaceholder("请填写本次结算依据").fill("第二期核对结算");
  await phased.getByRole("button",{name:"新增子费用"}).click();
  await selectSiteCost(phased);
  const itemCanvas=await worksheetCanvas(phased.getByRole("region",{name:"子费用金额及依据",exact:true}));
  await typeWorksheetCell(page,itemCanvas,1,2,[240,170,125,260],"120.00");
  await typeWorksheetCell(page,itemCanvas,1,3,[240,170,125,260],"本期现场费用依据");
  await phased.getByRole("button",{name:"保存草稿"}).click();
  await phased.waitFor({state:"hidden"});
  const second=f.s.finance.allSettlements().find(row=>row.draft?.document.basis==="第二期核对结算");
  assert.equal(second?.draft.document.mode,"itemized");
  assert.equal(second?.draft.document.amount_fen,12000);
  assert.equal(second?.draft.document.items[0].cost_node_id, costNode.id);
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,85000);
  await page.getByRole("row").filter({hasText:second.number}).getByRole("button",{name:"查看详情"}).click();
  await enterReview();
  await detail.getByRole("button",{name:"复核并提交审核"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await detail.getByRole("button",{name:"审核通过"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await page.getByText("结算审核通过",{exact:true}).waitFor();
  // Wait for the newly loaded server-backed state, not a potentially stale toast.
  await detail.getByRole("button",{name:"编制修订",exact:true}).waitFor();
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,97000);
  await detail.getByRole("button",{name:"返回结算列表"}).click();

  await page.getByRole("tab",{name:"费用科目、费用及核对"}).click();
  await page.getByRole("row").filter({hasText:"实际发生的人工费"}).getByRole("button",{name:"费用核对",exact:true}).click();
  const recon=page.getByRole("dialog",{name:"核对实际费用与结算明细"});
  await recon.getByRole("button",{name:"选择生效结算明细"}).click();
  const reconPicker=page.getByRole("dialog",{name:"选择生效结算明细",exact:true});
  await reconPicker.getByPlaceholder("搜索结算单编号或费用科目").fill(second.number);
  await reconPicker.getByRole("button",{name:"查询",exact:true}).click();
  await reconPicker.getByRole("row").filter({hasText:second.number}).filter({hasText:"现场核对费用"}).getByRole("button",{name:"选择",exact:true}).click();
  await reconPicker.getByRole("button",{name:"确认选择（1）",exact:true}).click();
  await recon.getByRole("textbox",{name:"核对实际费用（元）"}).fill("120.00");
  await recon.getByRole("textbox",{name:"核对结算金额（元）"}).fill("120.00");
  await recon.getByRole("textbox",{name:"核对依据"}).fill("决算凭证逐笔一致");
  await recon.getByText("标记最终核对",{exact:true}).click();
  assert.equal(await recon.getByRole("checkbox",{name:"标记最终核对"}).isChecked(),true);
  await recon.getByRole("button",{name:"保存核对"}).click();
  await page.getByText("已最终核对",{exact:true}).waitFor();
  assert.equal(f.s.finance.summary(f.project.id).reconciled_cost_fen,12000);
  await page.goto("http://127.0.0.1:"+port+"/#/funding/finance");
  await page.getByRole("tab",{name:"实际费用",exact:true}).click();
  const portfolioCost=page.getByRole("row").filter({hasText:"实际发生的人工费"});
  await portfolioCost.getByRole("button",{name:"查看正式历史"}).click();
  const trace=page.getByRole("dialog",{name:"财务正式历史"});
  await trace.getByText("现场凭据已核实",{exact:true}).waitFor();
  await trace.locator(".el-drawer__close-btn").click();
  await page.getByRole("tab",{name:"费用核对",exact:true}).click();
  const portfolioMatch=page.getByRole("row").filter({hasText:"实际发生的人工费"});
  await portfolioMatch.getByRole("cell",{name:"已最终核对",exact:true}).waitFor();
  await portfolioMatch.getByRole("button",{name:"查看正式历史"}).click();
  await trace.getByText("决算凭证逐笔一致",{exact:true}).waitFor();
  await trace.getByRole("button",{name:"核对采用的费用版本"}).click();
  await trace.getByText("现场凭据已核实",{exact:true}).waitFor();
  await trace.getByRole("button",{name:"返回上一条历史"}).click();
  await trace.getByRole("button",{name:"核对采用的结算版本"}).click();
  await trace.getByText(second.number,{exact:false}).first().waitFor();
  await trace.getByRole("button",{name:"返回上一条历史"}).click();
  await trace.getByText("决算凭证逐笔一致",{exact:true}).waitFor();
  await trace.locator(".el-drawer__close-btn").click();
  const reconciliation=f.s.finance.reconciliations(f.project.id).find(row=>row.evidence==="决算凭证逐笔一致");
  assert.ok(reconciliation);
  await page.goto("http://127.0.0.1:"+port+"/#/funding/finance?project="+f.project.id+"&work=reconciliations");
  const originalReconciliation=page.getByRole("row").filter({hasText:"决算凭证逐笔一致"});
  await originalReconciliation.getByRole("button",{name:"修订核对",exact:true}).waitFor();
  assert.ok(await originalReconciliation.locator(".row-actions").evaluate(container => {
    const bounds = container.closest(".cell").getBoundingClientRect();
    return [...container.querySelectorAll("button")].every(button => {
      const box = button.getBoundingClientRect();
      return box.width > 0 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
    });
  }),"the native action cell must show the full action buttons at the desktop viewport");
  await originalReconciliation.getByRole("button",{name:"修订核对",exact:true}).click();
  const correction=page.getByRole("dialog",{name:"修订费用核对"});
  assert.equal(await correction.getByRole("textbox",{name:"核对实际费用（元）"}).inputValue(),"120.00");
  await correction.getByRole("textbox",{name:"核对依据"}).fill("再次核验决算凭证");
  await correction.getByRole("button",{name:"保存核对"}).click();
  await correction.waitFor({state:"hidden"});
  const revisedReconciliation=page.getByRole("row").filter({hasText:"再次核验决算凭证"});
  await revisedReconciliation.getByText("已最终核对",{exact:true}).waitFor();
  const versions=f.s.finance.reconciliationHistory(reconciliation.record_id);
  assert.equal(versions.length,2);
  assert.ok(versions.some(row=>row.version_no===1&&row.evidence==="决算凭证逐笔一致"));
  assert.equal(f.s.finance.summary(f.project.id).reconciled_cost_fen,12000);
  await revisedReconciliation.getByRole("button",{name:"更多操作"}).click();
  await page.getByRole("menuitem",{name:"作废核对",exact:true}).click();
  const voidReconciliation=page.getByRole("dialog",{name:"作废费用核对"});
  await voidReconciliation.getByRole("textbox").fill("撤销误关联的核对凭据");
  await voidReconciliation.getByRole("button",{name:"确定"}).click();
  const voidedReconciliation=page.getByRole("row").filter({hasText:"撤销误关联的核对凭据"});
  await voidedReconciliation.getByText("已作废",{exact:true}).waitFor();
  assert.equal(f.s.finance.summary(f.project.id).reconciled_cost_fen,0);
  await voidedReconciliation.getByRole("button",{name:"删除核对",exact:true}).click();
  await page.getByRole("dialog",{name:"核对费用记录删除影响"}).getByRole("button",{name:"确认删除"}).click();
  await voidedReconciliation.waitFor({state:"hidden"});
  assert.ok(f.s.finance.reconciliations(f.project.id,true).find(row=>row.record_id===reconciliation.record_id&&row.deleted));
  assert.equal(f.s.finance.reconciliationHistory(reconciliation.record_id).length,3);
  await page.goto("http://127.0.0.1:"+port+"/#/funding/finance?project="+f.project.id);
  await page.getByRole("tab",{name:"结算单",exact:true}).click();
  await page.getByRole("button",{name:"导入 Excel",exact:true}).click();
  const exchange = page.getByRole("dialog",{name:"导入 Excel"});
  const [template] = await Promise.all([page.waitForEvent("download"),
    exchange.getByRole("button",{name:"下载模板",exact:true}).click()]);
  assert.equal(template.suggestedFilename(),"结算模板.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await template.path());
  const documents = workbook.getWorksheet("结算单");
  documents.getRow(2).getCell(columnIndex(documents,"amount_fen")).value = "505.05";
  const balances = f.s.finance.summary(f.project.id);
  const oldIds = new Set(f.s.finance.settlements(f.project.id).map(row=>row.id));
  await exchange.locator('input[type="file"]').setInputFiles({ name:"下一期结算.xlsx",
    mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer:Buffer.from(await workbook.xlsx.writeBuffer()) });
  await exchange.getByText("新增 1 条，修改 0 条，保持 0 条，0 条需处理",{exact:true}).waitFor();
  assert.equal(f.s.finance.settlements(f.project.id).length,oldIds.size);
  await exchange.getByRole("button",{name:"保存整批",exact:true}).click();
  await exchange.getByText("已处理 1 条，0 项需处理",{exact:true}).waitFor();
  const imported = f.s.finance.settlements(f.project.id).find(row=>!oldIds.has(row.id));
  assert.equal(imported?.draft.document.amount_fen,50505);
  assert.equal(imported.version,null);
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,balances.settlement_fen);
  assert.deepEqual(runtimeErrors,[]);
  console.log("YOULAI_Y4_FINANCE_WORKFLOW_OK full worksheet, clipboard, return and resubmission, historical approval, immutable revision, itemized settlement, actual costs, void/delete and final reconciliation");
} catch (error) {
 await page?.screenshot({ path: join(out, "finance-worksheet-failure.png"), fullPage: true });
 throw error;
} finally {
 await browser?.close();
 await new Promise(r=>backend.close(r));
 for(const fn of cleanup.reverse())await fn();
}
