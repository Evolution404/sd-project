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
async function downloadSelected(toolbar) {
  const pending = page.waitForEvent("download");
  await toolbar.getByRole("button", { name: "导出所选", exact: true }).click();
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
  await page.getByText("本页 2 条", { exact: true }).filter({ visible: true }).first().waitFor();
  await selectRow(bodyRows.first());
  await demandBatch.getByText("已选 2 条", { exact: true }).waitFor();
  await page.locator(".el-pagination").getByText("1", { exact: true }).click();
  await page.getByRole("cell", { name: first, exact: true }).first().waitFor();
  assert.equal(await bodyRows.first().getByRole("checkbox").isChecked(), true);
  const workbook = await downloadSelected(demandBatch);
  assert.equal(workbook.getWorksheet("需求清单").actualRowCount, 3);
  await demandBatch.getByRole("button", { name: "批量确认", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "核对批量确认" });
  await confirmation.getByText(/可办理 2 条，暂不可办理 0 条/).waitFor();
  assert.equal(s.demands.list().filter(row => row.status === "active").length, 0);
  await confirmation.getByRole("button", { name: "确认办理 2 条", exact: true }).click();
  await confirmation.waitFor({ state: "hidden" });
  assert.equal(s.demands.list().filter(row => row.status === "active").length, 2);

  await page.getByRole("tab", { name: "待承接", exact: true }).click();
  await page.getByText("本页 2 条", { exact: true }).filter({ visible: true }).first().waitFor();
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

  await page.goto(base + "/#/projects");
  await page.getByRole("tab", { name: "储备", exact: true }).click();
  for (const project of projects.slice(0, 2)) await selectRow(bodyRows.filter({ hasText: project.name }));
  await projectBatch.getByText("已选 2 条", { exact: true }).waitFor();
  const report = await downloadSelected(projectBatch);
  assert.equal(report.getWorksheet("子项目清单").actualRowCount, 3);
  await page.screenshot({ path: join(out, "项目所选和批量入口.png") });
  await projectBatch.getByRole("button", { name: "批量入库", exact: true }).click();
  const stock = page.getByRole("dialog", { name: "核对批量入库" });
  await stock.getByText(/可办理 2 条，暂不可办理 0 条/).waitFor();
  await stock.getByRole("button", { name: "确认办理 2 条", exact: true }).click();
  await stock.waitFor({ state: "hidden" });
  assert.deepEqual(projects.map(row => s.projects.get(row.id).status), ["stocked", "stocked", "reserve"]);

  await page.getByRole("tab", { name: "已入库", exact: true }).click();
  const row = bodyRows.filter({ hasText: projects[0].name });
  await selectRow(row);
  const listUrl = page.url();
  await row.getByRole("button", { name: "进入项目", exact: true }).click();
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
  console.log("HANDLING_BATCH_BROWSER_OK cross-page selection, read-only export, confirm/link/stock, modal direct action and list preservation");
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.shutdown(resolve));
  for (const action of cleanup.reverse()) await action();
}
