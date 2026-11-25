import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectWorksheetCell, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { copySettlementSelection, pasteSettlementCells } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, user, save, object, unit, demandInput } = fixture({ after: fn => cleanup.push(fn) });
const definitions = [
  { key: "text", label: "现场标记", type: "text" },
  { key: "notes", label: "观察记录", type: "textarea" },
  { key: "date", label: "核对日期", type: "date" },
  { key: "clear", label: "已确认", type: "boolean" },
  { key: "count", label: "独立数量", type: "integer", precision: 0 },
  { key: "spacing", label: "现地间距", type: "decimal", precision: 3 },
  { key: "grade", label: "现场等级", type: "select", options: [{ value: "high", label: "高" }, { value: "low", label: "低" }] },
  { key: "measures", label: "防护措施", type: "multiselect", options: [{ value: "film", label: "覆膜" }, { value: "band", label: "绑带" }] },
  { key: "asset", label: "杆塔材质", type: "select", options: [], source: "asset", asset_field: "tower_material" },
].map((field, i) => ({
  scope: "location", source: "manual", enabled: true, requirement: "optional",
  pricing: false, sort_order: i + 1, hint: "", ...field,
}));
const operation = save("operations", {
  name: "属性工作表专项", work_object_id: object.id, default_unit_id: unit.id,
  completion_standard: "合成夹具验收", attributes_schema_json: definitions,
});
const demand = s.demands.save(user, {
  ...demandInput, operation_id: operation.id, problem_description: "属性工作表验证",
  work_locations: demandInput.work_locations.slice(0, 1),
});
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const out = resolve("test-results/youlai-demand-attribute-sheet");
mkdirSync(out, { recursive: true });
let browser, page;

try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/business/demands/edit/" + demand.id);
  await page.getByRole("tab", { name: "作业位置（1）", exact: true }).click();
  const work = page.locator('[data-grid-key="demands:positions"]');
  const canvas = await worksheetCanvas(work);
  const widths = [180, 145, 125, 170, 125, 160];
  const values = ["现场记录", "观察说明", "2026-11-23", "是", "8", "0.625", "高", "覆膜/绑带"];
  await selectWorksheetCell(canvas, 1, 6, widths);
  await pasteSettlementCells(page, values.join("\t"));
  await work.getByRole("button", { name: "撤销", exact: true }).click();
  await work.getByText("未修改", { exact: true }).waitFor();
  await work.getByRole("button", { name: "重做", exact: true }).click();
  await selectWorksheetCell(canvas, 1, 5, widths);
  assert.equal((await copySettlementSelection(page)).trim(), "角钢塔");
  await pasteSettlementCells(page, "试图覆盖台账属性");
  await page.getByText("该范围已被保护", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "确定", exact: true }).last().click();
  await selectWorksheetCell(canvas, 1, 5, widths);
  assert.equal((await copySettlementSelection(page)).trim(), "角钢塔");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(out, "asset-projection-light.png"), animations: "disabled" });
  await page.getByRole("tab", { name: "需求来源", exact: true }).click();
  const sources = page.locator('[data-grid-key="demands:sources"]');
  const sourceCanvas = await worksheetCanvas(sources);
  await selectWorksheetCell(sourceCanvas, 1, 0, [420, 150]);
  await sources.getByRole("button", { name: "移除选中来源", exact: true }).click();
  await sources.getByText("共 1 行", { exact: true }).waitFor();
  assert.equal(s.demands.get(demand.id).sources[0].description, "现场巡视记录");
  await page.getByRole("button", { name: "保存专业需求", exact: true }).click();
  await page.waitForURL(/#\/business\/demands(?:\?|$)/);
  assert.deepEqual(s.demands.get(demand.id).work_locations[0].attributes, {
    text: "现场记录", notes: "观察说明", date: "2026-11-23", clear: true, count: 8, spacing: "0.625",
    grade: "high", measures: ["film", "band"], asset: "angle",
  });
  assert.deepEqual(errors, []);
  console.log("YOULAI_DEMAND_ATTRIBUTE_SHEET_OK eight types and locked frozen equipment attribute");
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const fn of cleanup.reverse()) await fn();
}
