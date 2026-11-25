import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { selectFormChoice } from "./field-helper.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, save, unit } = fixture({ after: (fn) => cleanup.push(fn) });
const voltage = save("voltages", { name: "110kV" });
const lineA = save("lines", { name: "多分页选择甲线", voltage_level_id: voltage.id });
const lineB = save("lines", { name: "跨线路选择乙线", voltage_level_id: voltage.id });
for (let index = 1; index <= 125; index++)
  save("towers", { line_id: index <= 122 ? lineA.id : lineB.id, tower_no: String(index) });
const object = save("objects", { name: "作业设备", object_position: "body", attribution_unit: "logical_tower" });
const operation = save("operations", {
  name: "全选交互专项作业", work_object_id: object.id,
  default_unit_id: unit.id, completion_standard: "选定作业范围准确",
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/dux/location-selection");
mkdirSync(output, { recursive: true });
const base = "http://127.0.0.1:" + server.address().port;
const editor = page.getByRole("region", { name: "新增专业需求", exact: true });
const picker = page.getByRole("dialog", { name: "添加作业位置", exact: true });
async function expectCount(count) {
  await picker.getByText("已选择 " + count + " 处，可切换线路继续选择。", { exact: true }).waitFor();
}
async function selectLine(label, expectEmpty = false) {
  const lineInput = picker.locator(".picker-filters .el-select").first();
  await lineInput.click();
  await page.getByRole("option", { name: new RegExp(label) }).last().click();
  if (expectEmpty) await picker.getByText("暂无记录",{exact:true}).waitFor();
  else await picker.locator(".el-table__body-wrapper tr").first().waitFor();
}
async function openPicker() {
  await editor.getByRole("button", { name: "添加作业位置", exact: true }).click();
  await picker.waitFor();
}
try {
  await page.goto(base + "/#/demands");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await selectFormChoice(page, "操作类型", operation.name, editor);
  await openPicker();
  assert.equal(await picker.getByRole("button", { name: "全选本页", exact: true }).count(), 0,
    "Page-wide selection must be in checkbox table header, not a toolbar button");
  await selectLine("多分页选择甲线");
  const header = () => picker.locator(".el-table__header-wrapper .el-checkbox").first();
  await header().waitFor();
  assert.ok(await picker.getByRole("checkbox", { name: "全选本页", exact: true }).count());
  await header().click();
  await expectCount(100);
  await page.screenshot({ path: join(output, "page-all-100.png"), fullPage: true });
  assert.ok(await picker.getByRole("checkbox", { name: "取消全选本页", exact: true }).count());
  await picker.locator(".el-table__body-wrapper .el-checkbox").first().click();
  await expectCount(99);
  assert.ok(await picker.locator(".el-table__header-wrapper .is-indeterminate").count(),
    "Header must be indeterminate when some current-page rows are selected");
  await page.screenshot({ path: join(output, "page-partial-99.png"), fullPage: true });
  await header().click();
  await expectCount(100);
  await header().click();
  await expectCount(0);
  await header().click();
  await expectCount(100);

  await picker.locator(".el-pagination .btn-next").click();
  await picker.locator(".el-table__body-wrapper tr").nth(22).waitFor({state:"detached"});
  await expectCount(100);
  assert.equal(await picker.locator(".el-table__body-wrapper tr").count(),22);
  assert.ok(await picker.getByRole("checkbox", { name: "全选本页", exact: true }).count());
  await header().click();
  await expectCount(122);
  await picker.getByRole("button", { name: "取消筛选结果", exact: true }).click();
  await expectCount(0);
  await picker.getByRole("button", { name: "全选筛选结果", exact: true }).click();
  await expectCount(122);

  await selectLine("跨线路选择乙线");
  await expectCount(122); // cross-line selection must persist
  await picker.getByRole("button", { name: "全选筛选结果", exact: true }).click();
  await expectCount(125);
  await selectLine("多分页选择甲线");
  await picker.getByRole("button", { name: "取消筛选结果", exact: true }).click();
  await expectCount(3); // only A was removed; B remains selected
  await picker.getByRole("button", { name: "清空全部已选", exact: true }).click();
  await expectCount(0);

  await selectLine("跨线路选择乙线");
  await picker.getByRole("button", { name: "全选筛选结果", exact: true }).click();
  await expectCount(3);
  await picker.getByRole("button", { name: "添加已选位置", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await editor.getByRole("tab", { name: "作业位置与工作量", exact: true }).click();
  assert.equal(await editor.locator("#demand-section-locations .el-table__body-wrapper tr").count(), 3);
  await editor.getByText("3处，已选0处", { exact: true }).waitFor();
  await openPicker();
  await selectLine("跨线路选择乙线", true);
  await picker.getByRole("button", { name: "全选筛选结果", exact: true }).click();
  await expectCount(0); // already-added positions cannot be selected twice
  assert.equal(await header().locator("input").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("LOCATION_SELECTION_BROWSER_OK header page all/deselect/mixed, 100+22 pages, filtered select/cancel, other-line persistence, clear all, existing dedupe");
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  console.error("LOCATION_SELECTION_BROWSER_FAILURE", error.message, errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const fn of cleanup.reverse()) await fn();
}


// Keep location entity columns, remote natural sorting, physical deduplication
// and per-kind preferences in the normal browser acceptance command.
await import("./location-schema-sort-browser.mjs");
