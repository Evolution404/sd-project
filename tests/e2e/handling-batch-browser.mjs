import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, operation } = fixture({ after: action => cleanup.push(action) });
const framework = save("frameworks", { name: "批量办理框架", fiscal_year: 2026, limit_fen: 100000 });
const projects = ["批量项目甲", "批量项目乙", "候选外对照项目"].map(name =>
  s.projects.save(user, { name, framework_id: framework.id }));
for (let index = 1; index <= 32; index++) {
  const tower = save("physical", { asset_no: "批量-" + index });
  s.demands.save(user, { operation_id: operation.id, problem_description: "清单批量验收 " + index,
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
  });
}
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = "http://127.0.0.1:" + server.address().port;
const out = join(process.cwd(), "test-results/schema113/handling-batch");
mkdirSync(out, { recursive: true });
const demandBatch = page.getByLabel("专业需求批量操作");
const projectBatch = page.getByLabel("子项目批量操作");
const bodyRows = page.locator(".business-table-grid .el-table__body-wrapper tbody tr:visible");
async function selectRow(row) {
  await row.locator("label.el-checkbox").first().click();
}
async function downloadSelected(toolbar, kind) {
  const pending = page.waitForEvent("download");
  const request = page.waitForRequest(item => item.url().includes(`/api/exchange/${kind}/export`));
  await toolbar.getByRole("button", { name: "导出所选", exact: true }).click();
  const outgoing = await request;
  assert.equal(outgoing.method(), "POST");
  assert.equal(outgoing.postDataJSON().ids.length, 2);
  const file = await pending;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  return workbook;
}
try {
  await page.goto(base + "/#/demands");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("tab", { name: "待确认", exact: true }).click();
  await bodyRows.first().waitFor();
  const first = await bodyRows.first().getByRole("cell").nth(1).innerText();
  await selectRow(bodyRows.first());
  await page.locator(".el-pagination").getByText("2", { exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll(".business-table-grid .el-table__body-wrapper tbody tr").length === 2);
  await selectRow(bodyRows.first());
  await demandBatch.getByText("已选 2 条", { exact: true }).waitFor();
  await page.locator(".el-pagination").getByText("1", { exact: true }).click();
  await page.getByRole("cell", { name: first, exact: true }).first().waitFor();
  assert.equal(await bodyRows.first().getByRole("checkbox").isChecked(), true);
  const workbook = await downloadSelected(demandBatch, "demands");
  const selectedDemands = workbook.getWorksheet("专业需求报表");
  assert.equal(selectedDemands.actualRowCount, 5);
  assert.match(selectedDemands.getCell("A1").text, /勾选的记录，共 2 条/);
  const checkPath = "**/api/demands/confirm-batch/preview";
  await page.route(checkPath, route => route.abort(), { times: 1 });
  await demandBatch.getByRole("button", { name: "批量确认", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "核对批量确认" });
  await confirmation.getByRole("button", { name: "重新核对", exact: true }).click();
  await confirmation.getByText(/可办理 2 条，暂不可办理 0 条/).waitFor();
  assert.equal(s.demands.list().filter(row => row.status === "active").length, 0);
  const submissions = [];
  const commitPath = "**/api/demands/confirm-batch";
  await page.route(commitPath, async route => {
    submissions.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    if (submissions.length === 1) {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort();
    } else await route.continue();
  });
  await confirmation.getByRole("button", { name: "确认办理 2 条", exact: true }).click();
  const retry = confirmation.getByRole("button", { name: "重试提交", exact: true });
  await retry.waitFor();
  assert.equal(s.demands.list().filter(row => row.status === "active").length, 2);
  await retry.click();
  await confirmation.waitFor({ state: "hidden" });
  await page.unroute(commitPath);
  assert.ok(submissions[0].key);
  assert.deepEqual(submissions, [submissions[0], submissions[0]]);
  assert.equal(s.demands.list().filter(row => row.status === "active").length, 2);

  await page.getByRole("tab", { name: "待承接", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /^共 2 条$/ }).waitFor();
  await page.locator(".business-table-grid thead label.el-checkbox").first().click();
  await demandBatch.getByRole("button", { name: "批量关联子项目", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择子项目承接需求" });
  await picker.getByRole("row").filter({ hasText: projects[0].name }).getByRole("button", { name: "选择", exact: true }).click();
  await picker.getByRole("button", { name: "核对承接清单", exact: true }).click();
  const linkReview = page.getByRole("dialog", { name: "核对批量关联" });
  await linkReview.getByText(/可办理 2 条，暂不可办理 0 条/).waitFor();
  await linkReview.getByRole("button", { name: "确认办理 2 条", exact: true }).click();
  await linkReview.waitFor({ state: "hidden" });
  assert.equal(s.projects.get(projects[0].id).scopes.filter(row => row.binding).length, 2);

  await page.getByRole("tab", { name: "已承接", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /^共 2 条$/ }).waitFor();
  const beforeFilter = await bodyRows.first().locator(".cell-link:visible").first().innerText();
  await page.getByRole("button", { name: "筛选问题描述", exact: true }).click();
  const filter = page.getByPlaceholder("筛选问题描述", { exact: true });
  await filter.fill(beforeFilter);
  await filter.press("Enter");
  await page.getByRole("status").filter({ hasText: /^共 1 条$/ }).waitFor();
  const filtered = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Excel", exact: true }).click();
  const subset = new ExcelJS.Workbook();
  await subset.xlsx.readFile(await (await filtered).path());
  const filteredReport = subset.getWorksheet("专业需求报表");
  assert.equal(filteredReport.actualRowCount, 4);
  assert.match(filteredReport.getCell("A1").text, /已承接.*共 1 条/);
  assert.equal(filteredReport.getRow(4).getCell(4).value, beforeFilter);
  assert.equal(subset.worksheets[0].name, "专业需求报表");
  assert.equal(subset.getWorksheet("报表标记").state, "veryHidden");

  await page.goto(base + "/#/projects");
  for (const project of projects.slice(0, 2)) await selectRow(bodyRows.filter({ hasText: project.name }));
  await projectBatch.getByText("已选 2 条", { exact: true }).waitFor();
  const stateBeforeReset = page.url();
  await projectBatch.getByRole("button", { name: "列设置", exact: true }).click();
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(page.url(), stateBeforeReset);
  await projectBatch.getByText("已选 2 条", { exact: true }).waitFor();
  const report = await downloadSelected(projectBatch, "projects");
  assert.equal(report.getWorksheet("子项目清单").actualRowCount, 5);
  const selectedEndpoint = base + "/api/exchange/projects/export";
  const emptySelection = await page.request.post(selectedEndpoint, { data: { ids: [] } });
  assert.equal(emptySelection.status(), 422, "an empty selection must never broaden to all projects");
  const largeSelection = { ids: Array(5000).fill(projects[0].id) };
  assert.ok(JSON.stringify(largeSelection).length > 16384);
  const largeResponse = await page.request.post(selectedEndpoint, { data: largeSelection });
  assert.equal(largeResponse.status(), 200);
  const largeReport = new ExcelJS.Workbook();
  await largeReport.xlsx.load(await largeResponse.body());
  assert.equal(largeReport.getWorksheet("子项目清单").actualRowCount, 4);
  await page.screenshot({ path: join(out, "项目所选和批量入口.png") });
  await projectBatch.getByRole("button", { name: "批量入库", exact: true }).click();
  const stock = page.getByRole("dialog", { name: "核对批量入库" });
  await stock.getByText(/可办理 2 条，暂不可办理 0 条/).waitFor();
  await stock.getByRole("button", { name: "确认办理 2 条", exact: true }).click();
  await stock.waitFor({ state: "hidden" });
  assert.deepEqual(projects.map(row => s.projects.get(row.id).status), ["stocked", "stocked", "reserve"]);

  await page.getByRole("tab", { name: "已入库", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /^共 2 条$/ }).waitFor();
  const row = bodyRows.filter({ hasText: projects[0].name });
  await page.route(/\/api\/projects\?/, route => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("当前显示上次成功读取的结果。", { exact: true }).waitFor();
  assert.equal(await row.isVisible(), true);
  const projectExport = page.getByRole("button", { name: "导出 Excel", exact: true });
  assert.equal(await projectExport.isEnabled(), false);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("当前显示上次成功读取的结果。", { exact: true }).waitFor({ state: "hidden" });
  const [projectFile] = await Promise.all([page.waitForEvent("download"), projectExport.click()]);
  const stockedReport = new ExcelJS.Workbook();
  await stockedReport.xlsx.readFile(await projectFile.path());
  const stockedRows = stockedReport.getWorksheet("子项目清单").getSheetValues().flat();
  assert.ok(stockedRows.includes(projects[0].name) && stockedRows.includes(projects[1].name));
  assert.ok(!stockedRows.includes(projects[2].name));
  await selectRow(row);
  const listUrl = page.url();
  await row.locator(".cell-link:visible").first().click();
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("button", { name: "编制立项", exact: true }).click();
  const editor = page.getByRole("region", { name: "编制项目立项" });
  await editor.getByLabel("批准预算（元）", { exact: true }).waitFor();
  assert.equal(await detail.getByRole("button", { name: /其他办理操作|更多管理操作/ }).count(), 0);
  assert.match(page.url(), /\/projects\/[^/]+\/compile/);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  assert.equal(page.url(), listUrl);
  await projectBatch.getByText("已选 1 条", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "储备", exact: true }).click();
  await projectBatch.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("HANDLING_BATCH_BROWSER_OK cross-page selection, scoped exports, retry without duplicate writes, confirm/link/stock and list preservation");
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.shutdown(resolve));
  for (const action of cleanup.reverse()) await action();
}
