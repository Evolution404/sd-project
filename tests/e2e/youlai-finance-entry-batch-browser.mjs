import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { alignmentAudit } from "./youlai-alignment-helpers.mjs";
import { selectWorksheetCell, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { pasteSettlementCells } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, user, project, node } = approvedFixture({ after: fn => cleanup.push(fn) });
const settlement = s.finance.saveAndSubmit(user, project.id, {
  approval_version_id: project.approval.id, basis: "批量核对浏览器结算", mode: "itemized",
  items: [{ cost_node_id: node.id, amount_fen: 15000, evidence: "凭据" }],
});
s.finance.review(user, settlement.id, {
  action: "approve", expected_version: settlement.version.version_no, expected_event_seq: settlement.review.event_seq,
});
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const out = resolve("test-results/youlai-finance-entry-batch");
mkdirSync(out, { recursive: true });
let browser, page;

try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("vea:ui:theme", "auto"));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  const dialog = name => page.getByRole("dialog", { name, exact: true });
  const canvas = (scope, name) => worksheetCanvas(scope.getByRole("region", { name: name + "明细", exact: true }));
  const preflight = async (scope, count) => {
    await button("预检明细", scope).click();
    await scope.getByText("已预检 " + count + " 条明细", { exact: true }).waitFor();
  };
  async function commit(scope, action) {
    await button(action, scope).click();
    const response = page.waitForResponse(reply => reply.url().endsWith("/finance-entry-batch/commit"));
    await button("确认提交", dialog(action)).click();
    const result = await response;
    assert.ok(result.ok());
    await scope.waitFor({ state: "hidden" });
    return result;
  }
  async function addRows(scope, count) {
    await scope.getByRole("spinbutton", { name: "新增行数" }).fill(String(count));
    await button("新增录入行", scope).click();
  }
  async function chooseRows(title, names, confirm) {
    const picker = dialog(title);
    for (const name of names)
      await picker.getByRole("row").filter({ hasText: name }).locator("label.el-checkbox").click();
    await button(confirm + "（" + names.length + "）", picker).click();
    await picker.waitFor({ state: "hidden" });
  }
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await button("登录").click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/funding/finance?project=" + project.id + "&work=costs");

  await page.getByRole("tab", { name: "费用科目", exact: true }).click();
  const titleNodes = "批量新增费用科目";
  await button(titleNodes).click();
  const nodes = dialog(titleNodes);
  await addRows(nodes, 2);
  await selectWorksheetCell(await canvas(nodes, titleNodes), 1, 1, [220, 250, 300]);
  await pasteSettlementCells(page, "工作表交通费\t新建甲\n工作表物资费\t新建乙");
  await preflight(nodes, 2);
  assert.equal(s.finance.costTree(user, project.id).length, 1);
  await commit(nodes, "整批保存");
  assert.equal(s.finance.costTree(user, project.id).length, 3);

  await page.getByRole("tab", { name: "实际费用", exact: true }).click();
  const titleCosts = "批量登记实际费用";
  await button(titleCosts).click();
  const costs = dialog(titleCosts);
  await addRows(costs, 2);
  const costGrid = await canvas(costs, titleCosts);
  const costWidths = [150, 195, 145, 136, 145, 230, 205];
  await selectWorksheetCell(costGrid, 1, 0, costWidths);
  await page.keyboard.press("Shift+ArrowDown");
  await button("选择费用科目", costs).click();
  const categories = dialog("选择费用科目");
  await button("选择", categories.getByRole("row").filter({ hasText: node.name })).click();
  await button("确认选择（1）", categories).click();
  await selectWorksheetCell(costGrid, 1, 1, costWidths);
  await pasteSettlementCells(page, "工作表费用甲\t25.31\t2026-11-21\tQA-1\t费用甲凭证\n工作表费用乙\t50.65\t2026-11-22\tQA-2\t费用乙凭证");
  await preflight(costs, 2);
  assert.equal(s.finance.costs(project.id).length, 0);
  assert.deepEqual((await alignmentAudit(page, ".el-dialog")).violations, []);
  await costs.screenshot({ path: join(out, "costs-light.png"), animations: "disabled" });
  const response = await commit(costs, "整批核定费用");
  const write = response.request();
  const repeated = await page.request.post(write.url(), {
    headers: { "Idempotency-Key": (await write.allHeaders())["idempotency-key"], "Content-Type": "application/json" },
    data: write.postData(),
  });
  assert.deepEqual(await repeated.json(), await response.json());
  assert.equal(s.finance.summary(project.id).actual_cost_fen, 7596);

  const reviseTitle = "批量修订实际费用";
  await button(reviseTitle).click();
  const revise = dialog(reviseTitle);
  await button("选择待修订实际费用", revise).click();
  await chooseRows("选择待修订实际费用", ["工作表费用乙"], "添加所选记录");
  await selectWorksheetCell(await canvas(revise, reviseTitle), 1, 2, costWidths);
  await pasteSettlementCells(page, "52.65");
  await preflight(revise, 1);
  await commit(revise, "整批核定费用");
  assert.equal(s.finance.summary(project.id).actual_cost_fen, 7796);

  await page.getByRole("tab", { name: "费用核对", exact: true }).click();
  const titleReconcile = "批量新增费用核对";
  await button(titleReconcile).click();
  const recon = dialog(titleReconcile);
  await button("选择实际费用", recon).click();
  await chooseRows("选择实际费用", ["工作表费用甲", "工作表费用乙"], "添加所选记录");
  const reconGrid = await canvas(recon, titleReconcile);
  const reconcileWidths = [185, 97, 135, 135, 145, 145, 108, 230];
  await selectWorksheetCell(reconGrid, 1, 0, reconcileWidths);
  await page.keyboard.press("Shift+ArrowDown");
  await button("选择生效结算明细", recon).click();
  const items = dialog("选择生效结算明细");
  await button("选择", items.getByRole("row").filter({ hasText: settlement.number })).click();
  await button("确认选择（1）", items).click();
  await selectWorksheetCell(reconGrid, 1, 4, reconcileWidths);
  await pasteSettlementCells(page, "10.00\t20.00\t否\t第一份核对凭据\n20.00\t40.00\t是\t第二份核对凭据");
  await preflight(recon, 2);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  assert.deepEqual((await alignmentAudit(page, ".el-dialog")).violations, []);
  await recon.screenshot({ path: join(out, "reconciliation-dark.png"), animations: "disabled" });
  await commit(recon, "整批保存");
  assert.equal(s.finance.reconciliations(project.id).length, 2);
  assert.equal(s.finance.summary(project.id).reconciled_cost_fen, 3000);
  assert.deepEqual(errors, []);
  console.log("YOULAI_FINANCE_ENTRY_BATCH_OK atomic cost categories, registration, revision and reconciliation");
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const fn of cleanup.reverse()) await fn();
}
