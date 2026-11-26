import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { pickDemandPositions, selectWorksheetCell, waitForWorksheetFullscreen, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { copySettlementSelection, pasteSettlementCells } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, save, user, demandInput } = fixture({ after: fn => cleanup.push(fn) });
const [a, b, c, d] = ["A", "B", "C", "D"].map(n => save("physical", { asset_no: "ENTRY-HISTORY-" + n }));
const demand = s.demands.save(user, {
  ...demandInput, problem_description: "工作表稳定身份专项",
  work_locations: [a, b, c].map((tower, i) => ({
    location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: (i + 1) * 10000,
  })),
});
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const out = resolve("test-results/youlai-worksheet-row-history");
mkdirSync(out, { recursive: true });
const widths = [180, 145, 125, 170, 125, 150];
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
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/business/demands/edit/" + demand.id);
  const tab = n => page.getByRole("tab", { name: "作业位置（" + n + "）", exact: true });
  await tab(3).click();
  const work = page.locator('[data-grid-key="demands:positions"]');
  const canvas = await worksheetCanvas(work);
  const canvasId = await canvas.getAttribute("id");
  const edit = async (row, value) => {
    await selectWorksheetCell(canvas, row, 0, widths);
    await selectWorksheetCell(canvas, row, 2, widths);
    await pasteSettlementCells(page, value);
  };
  const read = async (row, column) => {
    await selectWorksheetCell(canvas, row, column, widths);
    return (await copySettlementSelection(page)).trim();
  };
  const checkRows = async expected => {
    await tab(expected.length).waitFor();
    assert.equal(await canvas.getAttribute("id"), canvasId);
    for (const [index, [letter, quantity]] of expected.entries()) {
      assert.equal(await read(index + 1, 0), "ENTRY-HISTORY-" + letter);
      assert.equal(await read(index + 1, 2), String(quantity));
    }
  };
  const button = name => work.getByRole("button", { name, exact: true });
  const remove = async row => {
    await selectWorksheetCell(canvas, row, 2, widths);
    await canvas.click({ button: "right", position: { x: 390, y: 63 + (row - 0.5) * 34 } });
    await page.getByText("删除选中行", { exact: true }).last().click();
  };

  await checkRows([["A", 1], ["B", 2], ["C", 3]]);
  await selectWorksheetCell(canvas, 1, 0, widths);
  await selectWorksheetCell(canvas, 1, 2, widths);
  await page.keyboard.press("4");
  await button("全屏编辑").click();
  await waitForWorksheetFullscreen(page);
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  assert.equal(await canvas.getAttribute("id"), canvasId);
  await page.waitForFunction(() => document.activeElement?.matches('[contenteditable][data-u-comp="editor"]'));
  assert.equal((await copySettlementSelection(page)).trim(), "4");
  const pageScroll = page.locator(".demand-scroll");
  const position = await canvas.boundingBox();
  const scrollBeforeWheel = await pageScroll.evaluate(node => node.scrollTop);
  await page.mouse.move(position.x + position.width - 80, position.y + 90);
  await page.mouse.wheel(0, 220);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await pageScroll.evaluate(node => node.scrollTop), scrollBeforeWheel);
  await page.screenshot({ path: join(out, "fullscreen-dark.png"), animations: "disabled" });
  await selectWorksheetCell(canvas, 2, 2, widths);
  await canvas.click({ position: { x: 36 + 180 + 145 + 125 - 12, y: 44 } });
  await page.getByText("降序", { exact: true }).click();
  await work.getByText("已按 需求数量 降序 排列", { exact: true }).waitFor();
  assert.equal((await copySettlementSelection(page)).trim(), "2");
  await checkRows([["A", 4], ["C", 3], ["B", 2]]);
  await edit(3, "5");
  await remove(2);
  await checkRows([["B", 5], ["A", 4]]);
  await page.evaluate(() => document.exitFullscreen());
  await button("全屏编辑").waitFor();
  assert.equal(await canvas.getAttribute("id"), canvasId);
  await button("撤销").click();
  await checkRows([["B", 5], ["A", 4], ["C", 3]]);
  // Keyboard undo uses the same history as the visible toolbar.
  await page.keyboard.press("ControlOrMeta+Z");
  await checkRows([["B", 2], ["A", 4], ["C", 3]]);
  await button("撤销").click();
  await checkRows([["B", 2], ["A", 1], ["C", 3]]);
  assert.equal(await button("撤销").isDisabled(), true);
  await button("重做").click();
  await checkRows([["B", 2], ["A", 4], ["C", 3]]);
  await button("重做").click();
  await checkRows([["B", 5], ["A", 4], ["C", 3]]);
  await button("重做").click();
  await checkRows([["B", 5], ["A", 4]]);

  await pickDemandPositions(page, [["ENTRY-HISTORY-D", "ENTRY-HISTORY-D"]]);
  await tab(3).waitFor();
  assert.equal(await read(3, 0), "ENTRY-HISTORY-D");
  const dQuantity = await read(3, 2);
  await button("撤销").click();
  await checkRows([["B", 5], ["A", 4]]);
  await button("重做").click();
  await checkRows([["B", 5], ["A", 4], ["D", dQuantity]]);
  await edit(3, "6");

  // Zero rows remains the same sheet and keeps the complete deletion undo step.
  await canvas.click({ position: { x: 18, y: 80 } });
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await button("移除选中位置").click();
  await checkRows([]);
  await button("撤销").click();
  await checkRows([["D", 6], ["B", 5], ["A", 4]]);
  const quantityFilter = () => canvas.click({ position: { x: 36 + 180 + 145 + 125 - 12, y: 44 } });
  const filterPanel = page.locator('[data-u-comp="sheets-filter-panel"]:visible')
    .filter({ has: page.locator('[data-u-comp="sheets-filter-panel-footer"]') });
  await quantityFilter();
  const values = filterPanel.locator('[data-u-comp="sheets-filter-panel-values-virtual"]');
  await values.getByText("5", { exact: true }).waitFor();
  await values.getByRole("checkbox").nth(1).locator("..").click();
  await filterPanel.getByRole("button", { name: "确认", exact: true }).click();
  await work.getByText("显示 2 行", { exact: true }).waitFor();
  await button("全屏编辑").click();
  await waitForWorksheetFullscreen(page);
  await work.getByText("显示 2 行", { exact: true }).waitFor();
  assert.equal(await read(1, 0), "ENTRY-HISTORY-D");
  assert.equal(await read(2, 0), "ENTRY-HISTORY-A");
  await button("退出全屏").click();
  await work.getByText("显示 2 行", { exact: true }).waitFor();
  await quantityFilter();
  await page.getByText("升序", { exact: true }).click();
  await work.getByText("已按 需求数量 升序 排列", { exact: true }).waitFor();
  await work.getByText("显示 2 行", { exact: true }).waitFor();
  assert.equal(await read(1, 0), "ENTRY-HISTORY-A");
  assert.equal(await read(2, 0), "ENTRY-HISTORY-D");
  await canvas.click({ position: { x: 18, y: 80 } });
  await page.keyboard.press("Shift+ArrowDown");
  await button("移除选中位置").click();
  await tab(1).waitFor();
  await work.getByText("显示 0 行", { exact: true }).waitFor();
  await button("撤销").click();
  await tab(3).waitFor();
  await work.getByText("显示 2 行", { exact: true }).waitFor();
  await button("清除筛选").click();
  await checkRows([["A", 4], ["B", 5], ["D", 6]]);
  await canvas.click({ position: { x: 18, y: 80 } });
  await canvas.click({ position: { x: 18, y: 148 }, modifiers: ["ControlOrMeta"] });
  await button("移除选中位置").click();
  await checkRows([["B", 5]]);
  await button("撤销").click();
  await checkRows([["A", 4], ["B", 5], ["D", 6]]);
  await page.screenshot({ path: join(out, "after-restore-dark.png"), animations: "disabled" });
  await page.getByRole("button", { name: "保存专业需求", exact: true }).click();
  await page.waitForURL(/#\/business\/demands(?:\?|$)/);

  const saved = s.demands.get(demand.id);
  assert.equal(saved.current_version, demand.current_version + 1);
  const quantities = new Map(saved.work_locations.map(row => [row.physical_tower_id, row.quantity_scaled]));
  assert.equal(quantities.size, 3);
  assert.equal(quantities.get(a.id), 40000);
  assert.equal(quantities.get(b.id), 50000);
  assert.equal(quantities.get(d.id), 60000);
  assert.ok(!quantities.has(c.id));
  assert.ok(s.equipment.get("physical", c.id));
  assert.deepEqual(errors, []);
  console.log("WORKSHEET_ROW_HISTORY_OK", JSON.stringify({ rows: quantities.size, version: saved.current_version }));
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const fn of cleanup.reverse()) await fn();
}
