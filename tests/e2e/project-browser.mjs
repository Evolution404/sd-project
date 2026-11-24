import { workPage, confirmProjectApproval, submitSettlement, approveSettlement } from "./work-page-helper.mjs";
import { selectFormChoice } from "./field-helper.mjs";
import { fillSettlementPosition } from "./settlement-worksheet-helper.mjs";
import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [],
  { s, user, save, demandInput } = fixture({
    after: (action) => cleanup.push(action),
  }),
  demand = s.demands.save(user, demandInput);
s.demands.transition(user, demand.id, {
  expected_version: 1,
  expected_event_seq: 1,
  status: "active",
});
save("frameworks", {
  code: "F-BROWSER",
  name: "浏览器验收框架",
  fiscal_year: 2026,
  limit_fen: 10000000,
});
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
    existsSync(chromium.executablePath())
      ? { headless: true }
      : { headless: true, channel: "chrome" },
  ),
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = join(process.cwd(), "test-results", "schema113");
mkdirSync(output, { recursive: true });
async function select(label, option) {
  await selectFormChoice(page, label, option);
}
async function confirm() {
  await page.locator(".el-message-box:visible .el-message-box__btns .el-button--primary").click();
  await page.locator(".el-message-box").waitFor({ state: "hidden" });
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await selectNavigation(page, "子项目管理");
  await page.getByRole("button", { name: "新增子项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("浏览器完整流程项目");
  await select("年度框架", "浏览器验收框架");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  await page.locator(".business-detail-dialog:visible")
    .getByRole("heading", { name: "浏览器完整流程项目", exact: true }).waitFor();
  assert.ok(await page.getByRole("tab", { name: "概览", exact: true }).isVisible(),
    "creating a project opens its actual business workspace, not a list row");
  await page.getByRole("button", { name: "关联需求", exact: true }).click();
  const picker=page.getByRole("dialog", {name:"关联专业需求"});
  await picker.getByLabel("选择需求：" + demand.demand_no).check();
  await picker.getByRole("button", {name:"查看需求详情：" + demand.demand_no}).click();
  const preview=page.getByRole("dialog", {name:"专业需求详情"});
  await preview.getByText("防鸟设施缺失").first().waitFor();
  await preview.getByRole("button", {name:"返回需求选择"}).click();
  await picker.getByRole("button", {name:"关联已选需求（1）"}).click();
  await picker.waitFor({state:"hidden"});
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await confirm();
  await page.getByRole("tab", { name: "立项与变更", exact: true }).click();
  await page.getByRole("button", { name: "编制立项", exact: true }).click();
  await page.getByLabel("批准预算（元）", { exact: true }).fill("1200");
  const approvalDialog=workPage(page);
  for (const name of ["线路", "操作类型", "作业位置", "需求数量", "计量单位", "作业方式", "位置类型", "设备规格"])
    await approvalDialog.getByRole("columnheader", { name, exact:true }).waitFor();
  await approvalDialog.getByText(demand.problem_description, { exact:true }).waitFor();
  await approvalDialog.getByRole("cell", { name:demand.operation_snapshot, exact:true }).first().waitFor();
  await approvalDialog.getByRole("button", { name:"列设置", exact:true }).click();
  await page.locator("label.el-checkbox").filter({ hasText:/^设备规格$/ }).click();
  await approvalDialog.getByRole("columnheader", { name:"设备规格", exact:true }).waitFor({ state:"hidden" });
  await page.getByRole("button", { name:"恢复默认", exact:true }).click();
  await approvalDialog.getByRole("columnheader", { name:"设备规格", exact:true }).waitFor();
  assert.equal(await approvalDialog.getByRole("checkbox", { name:demand.demand_no, exact:true }).isChecked(),true);
  await page.getByRole("button", { name:"完成", exact:true }).click();
  assert.equal(await approvalDialog.locator(".el-table__body-wrapper .el-checkbox").count(),0,
    "full-demand approval must not permit selecting individual locations");
  await approvalDialog.getByRole("button", { name: "保存批准草稿", exact: true }).click();
  await approvalDialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "按承接范围核价", exact: true })
    .click();
  await page.getByText("完整参考价 ¥480.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "确认正式报价", exact: true }).click();
  await page.getByText("已保存正式参考报价", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭报价", exact: true }).click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "审核立项", exact: true }).click();
  await confirmProjectApproval(page);
  await page.getByRole("tab", { name: "费用与结算", exact: true }).click();
  await page.getByRole("button", { name: "打开项目财务工作区", exact: true }).click();
  await page.getByRole("tab", { name:"实际费用", exact:true }).click();
  await page.getByRole("button", { name:"费用科目", exact:true }).click();
  await page.getByRole("button", { name: "新增科目", exact: true }).click();
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByLabel("名称", { exact: true })
    .fill("人工费");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "核定费用", exact: true }).click();
  await page.getByLabel("费用事项", { exact: true }).fill("浏览器真实费用");
  await select("末级费用科目", "人工费");
  await page.getByLabel("实际金额（元）", { exact: true }).fill("1400");
  await page.getByLabel("费用凭据", { exact: true }).fill("合成验收发票记录");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "结算单", exact: true }).click();
  const generatedBills = [];
  for (const [index, resolved] of [2, 3, 0].entries()) {
    await page
      .getByRole("button", { name: "新增结算", exact: true })
      .click();
    await workPage(page).getByText("按子费用", { exact: true }).click();
    await select("费用科目", "人工费");
    await select("关联需求（共同费用可不选）", demand.problem_description);
    await page.getByLabel("本次金额（元）", { exact: true }).fill("400");
    await page.getByLabel("依据", { exact: true }).fill("本期结算依据" + index);
    await fillSettlementPosition(workPage(page),{
      demandNo:demand.demand_no,locationLabel:index===1?"T17":"T15",
      quantity:resolved===0?"0.0":String(resolved),
      evidence:"项目浏览器逐行保存 "+index,
    });
    await workPage(page).getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.getByRole("region", { name: "编制结算草稿", exact: true }).waitFor({ state: "hidden" });
    const createdBill = s.finance
      .allSettlements()
      .find(
        (bill) =>
          bill.draft?.document.items[0].evidence === "本期结算依据" + index,
      );
    assert.equal(createdBill.draft.document.resolutions[0].resolved_quantity_scaled, resolved * 10000,
      "saving a routed editor preserves the user-entered resolved quantity");
    generatedBills.push(createdBill.number);
    const row = page.getByRole("row").filter({ hasText: createdBill.number });
    await submitSettlement(page, row);
    await approveSettlement(page, row);
  }
  await page.getByRole("button", { name: generatedBills[0], exact:true }).click();
  await page.getByRole("button", { name:"逐笔对账", exact:true }).click();
  await page.getByRole("button", { name: "新增正式核对", exact: true }).click();
  await select("实际费用", "浏览器真实费用 · ¥1,400.00");
  const choice = page.locator(".el-form-item").filter({has:page.getByText("已批准结算明细",{exact:true})});
  await choice.locator(".el-select__wrapper").click();
  await choice.getByRole("combobox").fill(generatedBills[0]);
  await page.getByRole("option", {name: "人工费 · ¥400.00 · " + generatedBills[0], exact: true}).click();
  await page.getByLabel("费用份额（元）", { exact: true }).fill("300");
  await page.getByLabel("核定结算额（元）", { exact: true }).fill("400");
  await page.getByLabel("核对依据", { exact: true }).fill("浏览器核对原始依据");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  const reconciliation = page
    .getByRole("row")
    .filter({ hasText: "浏览器核对原始依据" });
  await reconciliation
    .getByRole("button", { name: "更正", exact: true })
    .click();
  await page.getByLabel("费用份额（元）", { exact: true }).fill("200");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  await reconciliation.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await confirm();
  const project = s.projects
    .list()
    .find((p) => p.name === "浏览器完整流程项目");
  assert.equal(s.finance.reconciliations(project.id).length, 0);
  assert.equal(s.finance.reconciliations(project.id, true).length, 1);
  assert.equal(s.finance.summary(project.id).settlement_fen, 120000);
  assert.equal(s.finance.summary(project.id).settlement_progress_percent, 100);
  assert.equal(
    s.finance.summary(project.id).demands[0].resolved_quantity_scaled,
    50000,
  );
  await page.screenshot({
    path: join(output, "project-finance-1500.png"),
    fullPage: true,
  });
  for (const width of [1280, 760]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(async () => {
      scrollTo(0, 0);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `finance overflow ${width}`,
    );
    await page.screenshot({
      path: join(output, `project-finance-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("region", { name: "费用与结算", exact: true }).getByRole("button", { name: "← 返回", exact: true }).click();
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "结项核对", exact: true }).click();
  await page.getByRole("dialog", { name: "结项前业务核对" })
    .getByText("待核对费用").waitFor();
  await page.getByRole("button", { name: "已核对差异，正式结项", exact: true }).click();
  assert.equal(s.projects.get(project.id).status, "closed");
  await page.getByRole("button", { name: "查看结项结果", exact: true }).click();
  await page.getByRole("heading", { name: "结项结果", exact: true }).waitFor();
  await page.getByText("未解决工作量", { exact: true }).waitFor();
  const frozen = s.projects.get(project.id);
  await page.getByRole("tab", { name: "概览", exact: true }).click();
  await page.getByText("结项后档案已冻结", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "编辑档案", exact: true }).count(), 0);
  const blocked = await page.evaluate(async ({ id, version }) => {
    const result = await fetch("/api/projects/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ name: "结项后禁止写入档案", expected_version: version }),
    });
    return { status: result.status, message: (await result.json()).message };
  }, { id: project.id, version: frozen.profile_version });
  assert.deepEqual(blocked, { status: 409, message: "项目已结项，项目档案已冻结" });
  const preserved = s.projects.get(project.id);
  assert.equal(preserved.profile_version, frozen.profile_version);
  assert.equal(preserved.approval.id, frozen.approval.id);
  assert.deepEqual(preserved.funding, frozen.funding);
  assert.deepEqual(errors, []);
  console.log(
    "SCHEMA113_PROJECT_BROWSER_OK project creation, scope5, price300, budget1200, actual1400, 3 settlements, resolved5, financial-only third installment and close",
  );
} catch (error) {
  await page.screenshot({
    path: join(output, "project-browser-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
