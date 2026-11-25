import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectWorksheetCell, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { alignmentAudit } from "./youlai-alignment-helpers.mjs";
import { pasteSettlementCells } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, operation, towers } = fixture({ after: fn => cleanup.push(fn) });
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const out = resolve("test-results/youlai-online-demand-entry");
mkdirSync(out, { recursive: true });
let browser, page;

try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  const button = name => page.getByRole("button", { name, exact: true });
  const tab = name => page.getByRole("tab", { name, exact: true });
  const region = name => page.getByRole("region", { name, exact: true });
  await button("登录").click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/business/demands");
  await button("批量新增需求").click();
  await page.getByRole("combobox", { name: "本批操作类型" }).fill(operation.name);
  await page.getByRole("option", { name: operation.name, exact: true }).click();
  await button("新增需求行").click();
  const documents = region("需求清单");
  const documentCanvas = await worksheetCanvas(documents);
  await button("新增需求行").click();
  await documents.getByText("共 2 行", { exact: true }).waitFor();
  const docWidths = [135, 185, 295, 240, 180, 145];
  await selectWorksheetCell(documentCanvas, 1, 2, docWidths);
  await pasteSettlementCells(page, "网页录入专项甲\n网页录入专项乙");
  for (const [i, tower] of towers.slice(0, 2).entries()) {
    await tab("需求清单").click();
    await selectWorksheetCell(documentCanvas, i + 1, 0, docWidths);
    await button("为选中需求添加位置").click();
    const dialog = page.getByRole("dialog", { name: "选择批量作业设备", exact: true });
    await dialog.getByPlaceholder("搜索杆塔、线路或档距").fill(tower.asset_no);
    await dialog.getByRole("button", { name: "查询", exact: true }).click();
    await dialog.getByRole("row").filter({ hasText: tower.asset_no }).locator("label.el-checkbox").click();
    await dialog.getByRole("button", { name: "添加所选位置（1）", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  const locationCanvas = await worksheetCanvas(region("作业位置"));
  const locationWidths = [135, 155, 160, 110, 110, 120, 120, 170];
  await selectWorksheetCell(locationCanvas, 1, 5, locationWidths);
  await pasteSettlementCells(page, "2\n1.5");
  await button("预检").click();
  await page.getByText(/问题 [1-9]\d* 项/).waitFor();
  assert.equal(await button("整批提交").isDisabled(), true);
  assert.equal(s.demands.search({ q: "网页录入专项", page: 1, page_size: 20, filters: {} }).total, 0);
  await selectWorksheetCell(locationCanvas, 2, 5, locationWidths);
  await pasteSettlementCells(page, "3");
  await button("预检").click();
  await page.getByText(/预检 2 条，新增 2 条.*问题 0 项/).waitFor();
  assert.deepEqual((await alignmentAudit(page)).violations, []);
  await page.screenshot({ path: join(out, "create-dark.png"), animations: "disabled" });
  await button("整批提交").click();
  await button("确认提交").click();
  await page.getByRole("heading", { name: "批量新增专业需求", exact: true }).waitFor({ state: "hidden" });

  const created = s.demands.search({ q: "网页录入专项", page: 1, page_size: 20, filters: {} }).items;
  assert.equal(created.length, 2);
  const byName = new Map(created.map(row => [row.problem_description, s.demands.get(row.id)]));
  assert.equal(byName.get("网页录入专项甲").work_locations[0].physical_tower_id, towers[0].id);
  assert.equal(byName.get("网页录入专项甲").work_locations[0].quantity_scaled, 20000);
  assert.equal(byName.get("网页录入专项乙").work_locations[0].physical_tower_id, towers[1].id);
  assert.equal(byName.get("网页录入专项乙").work_locations[0].quantity_scaled, 30000);

  await page.emulateMedia({ colorScheme: "light" });
  for (const name of byName.keys()) await page.getByRole("row").filter({ hasText: name }).locator("label.el-checkbox").click();
  await button("批量修订资料").click();
  const editCanvas = await worksheetCanvas(region("需求清单"));
  await selectWorksheetCell(editCanvas, 1, 4, docWidths);
  await pasteSettlementCells(page, "批量修订部位\n批量修订部位");
  await button("预检").click();
  await page.getByText(/预检 2 条，新增 0 条，修订 2 条，问题 0 项/).waitFor();
  assert.deepEqual((await alignmentAudit(page)).violations, []);
  await page.screenshot({ path: join(out, "revision-light.png"), animations: "disabled" });
  await button("整批提交").click();
  await button("确认提交").click();
  await page.getByRole("heading", { name: "批量修订需求资料", exact: true }).waitFor({ state: "hidden" });
  for (const original of byName.values()) {
    const saved = s.demands.get(original.id);
    assert.equal(saved.target_object, "批量修订部位");
    assert.equal(saved.current_version, original.current_version + 1);
    assert.deepEqual(saved.work_locations, original.work_locations);
  }
  assert.deepEqual(errors, []);
  console.log("YOULAI_ONLINE_DEMAND_ENTRY_OK create and revise two independent formal identities");
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const fn of cleanup.reverse()) await fn();
}
