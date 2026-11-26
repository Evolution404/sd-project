import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";

const cleanup = [];
const { s, save, user, unit, demandInput } = fixture({ after: done => cleanup.push(done) });
const voltage = save("voltages", { name: "110kV" });
const lineA = save("lines", { name: "多分页选择甲线", voltage_level_id: voltage.id });
const lineB = save("lines", { name: "跨线路选择乙线", voltage_level_id: voltage.id });
const towers = Array.from({ length: 205 }, (_, i) => save("towers", {
  line_id: i < 202 ? lineA.id : lineB.id, tower_no: String(i + 1),
  ...(i === 204 ? { status: "draft" } : {}),
}));
const object = save("objects", { name: "作业设备", object_position: "body", attribution_unit: "logical_tower" });
const operation = save("operations", { name: "全选交互专项作业", work_object_id: object.id,
  default_unit_id: unit.id, default_quantity_scaled: 10000, completion_standard: "选定作业范围准确" });
const demand = s.demands.save(user, { ...demandInput, operation_id: operation.id, work_locations: [{
  location_kind: "logical_tower", logical_tower_id: towers[202].id, quantity_scaled: 10000,
}] });
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await button("登录").click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/business/demands/edit/" + demand.id);
  await page.getByRole("tab", { name: "作业位置（1）", exact: true }).click();
  const sheet = page.locator('[data-grid-key="demands:positions"]');
  const canvas = await worksheetCanvas(sheet);
  const canvasId = await canvas.getAttribute("id");
  const picker = page.getByRole("dialog", { name: "选择作业设备", exact: true });
  const header = picker.locator("thead .el-checkbox");
  const count = picked => picker.getByText(`已选 ${picked} 条`, { exact: true }).waitFor();
  const chooseLine = async line => {
    await picker.getByRole("combobox", { name: "所属线路", exact: true }).fill(line.name);
    await page.getByRole("option", { name: line.name, exact: true }).click();
    await picker.getByRole("cell", { name: line.name, exact: true }).first().waitFor();
  };
  await button("选择作业设备").click();
  await chooseLine(lineA);
  await header.click();
  await count(20);
  assert.ok(await header.getByRole("checkbox").isChecked());
  await picker.locator(".el-table__body .el-checkbox").first().click();
  await count(19);
  assert.ok(await header.locator(".is-indeterminate").count());
  await header.click();
  await count(20);
  const onPageTwo = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/catalog/towers" && url.searchParams.get("page") === "2" &&
      url.searchParams.get("line_id") === lineA.id;
  });
  await picker.locator(".el-pagination .btn-next").click();
  const pageTwoResponse = await onPageTwo;
  assert.ok(pageTwoResponse.ok());
  const pageTwoRows = await pageTwoResponse.json();
  await picker.getByRole("cell", { name: pageTwoRows.items[0].tower_no, exact: true }).waitFor();
  await header.click();
  await count(40);
  await button("取消筛选结果", picker).click();
  await count(0);
  await button("全选筛选结果", picker).click();
  await count(202);
  await chooseLine(lineB);
  await count(202);
  assert.ok(await picker.getByRole("row").filter({ has: page.getByRole("cell", { name: "203", exact: true }) })
    .getByRole("checkbox").isDisabled());
  await button("全选筛选结果", picker).click();
  await count(204);
  await chooseLine(lineA);
  await button("取消筛选结果", picker).click();
  await count(2);
  await button("清空全部已选", picker).click();
  await count(0);
  await chooseLine(lineB);
  await button("全选筛选结果", picker).click();
  await button("添加所选位置（2）", picker).click();
  await picker.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "作业位置（3）", exact: true }).waitFor();
  assert.equal(await canvas.getAttribute("id"), canvasId);
  assert.deepEqual(errors, []);
  console.log("YOULAI_DEMAND_LOCATION_SELECTION_OK native page selection, filtered selection and cancellation, cross-line persistence, excluded existing positions and one worksheet");
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const done of cleanup.reverse()) await done();
}
