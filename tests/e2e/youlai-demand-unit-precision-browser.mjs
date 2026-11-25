import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { pickDemandPositions, selectWorksheetCell, typeWorksheetCell, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { copySettlementSelection } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, save, user, unit, operation, demandInput } = fixture({ after: done => cleanup.push(done) });
const original = s.demands.save(user, { ...demandInput, work_locations: [demandInput.work_locations[0]] });
s.dictionaries.saveDictionary(user, "units", { expected_version: 1, quantity_precision: 2 }, unit.id);
const revised = s.catalog.save(user, "operations", { expected_version: 1, adopt_current_unit: true }, operation.id);
assert.equal(revised.default_unit_version, 2);
const integer = save("units", { name: "个", quantity_precision: 0 });
const alternate = save("operations", {
  name: "安装单个设备", work_object_id: operation.work_object_id, default_unit_id: integer.id, completion_standard: "安装完好",
});
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const origin = "http://127.0.0.1:" + server.address().port;
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const screenshots = resolve("test-results/youlai-demand-precision");
mkdirSync(screenshots, { recursive: true });
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (request.method() === "POST" && /^\/api\/demands(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
});
const button = (name) => page.getByRole("button", { name, exact: true });
const positions = page.getByRole("tab", { name: "作业位置（1）", exact: true });
const sheet = page.locator('[data-grid-key="demands:positions"]');
const widths = [180, 145, 125, 170];
const invalid = sheet.getByText(/符合正式计量单位精度/).first();
const unitUrl = origin + "/api/catalog/units/" + unit.id + "?history=true";
const alternateUnitUrl = origin + "/api/catalog/units/" + integer.id + "?history=true";
let releaseAlternateLookup;
try {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await button("登录").click();
  await page.waitForURL(/#\/dashboard/);
  const url = origin + "/#/business/demands/edit/" + original.id;
  await page.route(unitUrl, route => route.fulfill({ status: 503,
    json: { message: "模拟正式单位读取失败" } }), { times: 1 });
  await page.goto(url);
  await page.getByText("模拟正式单位读取失败", { exact: true }).waitFor();
  assert.equal(await button("保存专业需求").isDisabled(), true);
  assert.deepEqual(writes, []);
  await page.screenshot({ path: join(screenshots, "failed-unit-1920.png"), animations: "disabled" });
  await button("重新读取专业需求").click();
  await page.getByText("0 位小数", { exact: true }).waitFor();
  await positions.click();
  let canvas = await worksheetCanvas(sheet);
  await typeWorksheetCell(page, canvas, 1, 2, widths, "1.5");
  await button("保存专业需求").click();
  await invalid.waitFor();
  assert.deepEqual(writes, []);
  const stored = s.demands.get(original.id);
  assert.deepEqual([stored.operation_version, stored.unit_version, stored.work_locations[0].quantity_scaled], [1, 1, 30000]);

  await button("返回专业需求").click();
  await page.getByRole("dialog", { name: "离开需求编辑", exact: true }).getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.getByRole("button", { name: "新增专业需求", exact: true }).click();
  async function selectOperation(name) {
    await page.getByRole("combobox", { name: "操作类型" }).fill(name);
    await page.getByRole("option", { name, exact: true }).click();
  }
  await selectOperation(operation.name);
  await page.getByText("2 位小数", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "作业位置（0）", exact: true }).click();
  await pickDemandPositions(page, [["T16", /T16/]]);
  canvas = await worksheetCanvas(sheet);
  await typeWorksheetCell(page, canvas, 1, 2, widths, "0.25");
  await selectWorksheetCell(canvas, 1, 2, widths);
  assert.equal((await copySettlementSelection(page)).trim(), "0.25");
  await typeWorksheetCell(page, canvas, 1, 2, widths, "0.2501");
  await button("保存专业需求").click();
  await invalid.waitFor();
  assert.deepEqual(writes, []);

  await page.getByRole("tab", { name: "基本信息", exact: true }).click();
  const lookupHeld = new Promise(done => { releaseAlternateLookup = done; });
  await page.route(alternateUnitUrl, async route => { await lookupHeld; await route.continue(); }, { times: 1 });
  await selectOperation(alternate.name);
  const alternateRequest = page.waitForRequest(alternateUnitUrl);
  await page.getByRole("dialog", { name: "切换操作类型", exact: true }).getByRole("button", { name: "确定", exact: true }).click();
  await alternateRequest;
  assert.equal(await page.getByRole("combobox", { name: "操作类型" }).isDisabled(), true);
  assert.equal(await button("保存专业需求").isDisabled(), true);
  releaseAlternateLookup();
  await page.getByText("0 位小数", { exact: true }).waitFor();
  assert.equal(await page.getByText("2 位小数", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("YOULAI_DEMAND_PRECISION_OK frozen unit, zero-write failure and retry, exact fractional inputs and adopted operation switch");
} catch (error) {
  await page.screenshot({ path: join(screenshots, "failure-1920.png"), animations: "disabled" }).catch(() => undefined);
  throw error;
} finally {
  releaseAlternateLookup?.();
  await browser.close();
  await new Promise(done => server.shutdown(done));
  for (const done of cleanup.reverse()) await done();
}
