import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { alignmentAudit } from "./youlai-alignment-helpers.mjs";
import { selectWorksheetCell, waitForWorksheetFullscreen, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { pasteSettlementCells } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, save, towers, unit } = fixture({ after: fn => cleanup.push(fn) });
const voltage = save("voltages", { name: "220kV" });
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const out = resolve("test-results/youlai-catalog-create-worksheet");
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
  async function start(label, count, trigger = "批量新增") {
    await button(trigger).click();
    const scope = dialog("批量新增" + label);
    await scope.getByRole("spinbutton", { name: "新增行数" }).fill(String(count));
    await button("新增明细行", scope).click();
    return { scope, sheet: await worksheetCanvas(scope.getByRole("region", { name: label + "新增明细", exact: true })) };
  }
  async function preview(scope, count) {
    await button("预检明细", scope).click();
    await scope.getByText("已预检 " + count + " 条明细", { exact: true }).waitFor();
  }
  async function commit(scope, label) {
    await button("整批保存", scope).click();
    await button("确认提交", page.locator(".el-message-box:visible")).click();
    await dialog("批量新增" + label).and(page.locator(".el-overlay-dialog")).waitFor({ state: "hidden" });
  }
  async function pick(scope, label, query, exact) {
    await button("设置引用", scope).click();
    await page.getByRole("menuitem", { name: "选择" + label, exact: true }).click();
    const picker = dialog("选择" + label);
    await picker.getByPlaceholder("搜索设备").fill(query);
    await button("查询", picker).click();
    const row = picker.getByRole("row").filter({ has: page.getByRole("cell", { name: exact, exact: true }) });
    await button("选择", row).click();
    await button("确认选择（1）", picker).click();
    await picker.waitFor({ state: "hidden" });
  }

  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await button("登录").click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/assets/ledger");
  const line = await start("输电线路", 2);
  await selectWorksheetCell(line.sheet, 1, 0, [145, 120, 125, 165, 165]);
  await pasteSettlementCells(page, "工作表输电甲\t" + voltage.name + "\n工作表输电乙\t" + voltage.name);
  await preview(line.scope, 2);
  assert.equal(s.equipment.list("lines").length, 0);
  await commit(line.scope, "输电线路");
  const selectedLine = s.equipment.list("lines").find(item => item.name === "工作表输电甲");

  await page.getByRole("tab", { name: "物理杆塔", exact: true }).click();
  const physical = await start("物理杆塔", 2);
  await selectWorksheetCell(physical.sheet, 1, 0, [145]);
  await pasteSettlementCells(page, "新工作表铭牌甲\n新工作表铭牌乙");
  await preview(physical.scope, 2);
  await commit(physical.scope, "物理杆塔");
  assert.equal(s.equipment.list("physical").filter(item => item.asset_no?.startsWith("新工作表")).length, 2);

  await page.getByRole("tab", { name: "逻辑杆塔", exact: true }).click();
  const tower = await start("逻辑杆塔", 2);
  const towerWidths = [165, 165, 145, 145, 145, 145, 145];
  const towerCanvasId = await tower.sheet.getAttribute("id");
  await page.evaluate(() => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false }));
  await button("全屏编辑", tower.scope).click();
  await waitForWorksheetFullscreen(page);
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  await page.locator(".el-message:visible").first().waitFor({ state: "hidden" });
  await page.screenshot({ path: join(out, "tower-fullscreen-light.png"), animations: "disabled" });
  await selectWorksheetCell(tower.sheet, 1, 0, towerWidths);
  await page.keyboard.press("Shift+ArrowDown");
  await pick(tower.scope, "所属线路", "工作表输电甲", "工作表输电甲");
  await selectWorksheetCell(tower.sheet, 1, 1, towerWidths);
  await pick(tower.scope, "共用物理杆塔", towers[0].asset_no, towers[0].asset_no);
  await selectWorksheetCell(tower.sheet, 1, 2, towerWidths);
  await pasteSettlementCells(page, "Z-001\nZ-002");
  await tower.sheet.click({ position: { x: 36 + towerWidths.slice(0, 3).reduce((sum, width) => sum + width, 0) - 12, y: 44 } });
  const filterMenu = page.locator('[data-u-comp="rect-popup"]').filter({ has: button("降序") });
  await button("升序", filterMenu).click();
  await filterMenu.waitFor({ state: "hidden" });
  await tower.scope.getByText("已按 杆塔号 升序 排列", { exact: true }).waitFor();
  await button("退出全屏", tower.scope).click();
  assert.equal(await tower.sheet.getAttribute("id"), towerCanvasId);
  await page.evaluate(() => Reflect.deleteProperty(document, "fullscreenEnabled"));
  await preview(tower.scope, 2);
  await commit(tower.scope, "逻辑杆塔");
  const importedTowers = s.equipment.list("towers").filter(item => item.line_id === selectedLine.id);
  const shared = importedTowers.find(item => item.tower_no === "Z-001");
  const separate = importedTowers.find(item => item.tower_no === "Z-002");
  assert.equal(shared.physical_tower_id, towers[0].id);
  assert.notEqual(separate.physical_tower_id, towers[0].id);

  await page.getByRole("tab", { name: "档距", exact: true }).click();
  const span = await start("档距", 1);
  await pick(span.scope, "所属线路", "工作表输电甲", "工作表输电甲");
  await pick(span.scope, "起点逻辑杆塔", "Z-001", "Z-001");
  await pick(span.scope, "终点逻辑杆塔", "Z-002", "Z-002");
  await selectWorksheetCell(span.sheet, 1, 3, [165, 165, 165, 145]);
  await pasteSettlementCells(page, "145.237");
  await preview(span.scope, 1);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  assert.deepEqual((await alignmentAudit(page, ".el-dialog")).violations, []);
  await span.scope.screenshot({ path: join(out, "span-dark.png"), animations: "disabled" });
  await commit(span.scope, "档距");
  const spanRecord = s.equipment.list("spans").find(item => item.line_id === selectedLine.id);
  assert.equal(spanRecord.start_tower_id, shared.id);
  assert.equal(spanRecord.end_tower_id, separate.id);
  assert.equal(spanRecord.transmission_center_length_mm, 145237);

  await page.goto(origin + "/#/assets/materials");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  const supplies = await start("物资", 2, "批量新增物资");
  await selectWorksheetCell(supplies.sheet, 1, 0, [220, 125, 220, 220, 220]);
  await pasteSettlementCells(page, "工作表紧固物资\t" + unit.name + "\tT1\t甲规格\n工作表防护物资\t" + unit.name + "\tT2\t乙规格");
  await preview(supplies.scope, 2);
  assert.equal(s.materials.list().length, 0);
  assert.deepEqual((await alignmentAudit(page, ".el-dialog")).violations, []);
  await supplies.scope.screenshot({ path: join(out, "materials-light.png"), animations: "disabled" });
  await commit(supplies.scope, "物资");
  assert.deepEqual(new Set(s.materials.list().map(row => row.unit_id)), new Set([unit.id]));
  assert.equal(s.materials.list().length, 2);
  assert.deepEqual(errors, []);
  console.log("YOULAI_CATALOG_CREATE_WORKSHEET_OK lines, physical and logical towers, spans and materials");
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const fn of cleanup.reverse()) await fn();
}
