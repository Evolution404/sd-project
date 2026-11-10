import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [], { s, user } = fixture({ after: action => cleanup.push(action) });
const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
s.catalog.save(user, "lines", { name: "测试可拖动侧栏和列宽", voltage_level_id: voltage.id });
for (let i = 0; i < 35; i++)
  s.catalog.save(user, "lines", { name: "分页测试线路" + String(i).padStart(2, "0"), voltage_level_id: voltage.id });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" },
);
const context = await browser.newContext({ viewport: { width: 1500, height: 960 } });
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });
async function stableTableLayout(table) {
  await table.evaluate(async element => {
    await document.fonts.ready;
    let previous = '', stable = 0;
    while (stable < 5) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const geometry = JSON.stringify([...element.querySelectorAll('th')].map(header => {
        const rect = header.getBoundingClientRect();
        return [rect.x, rect.y, rect.width];
      }));
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
    }
  });
}
async function sidebarWidth() {
  return (await page.locator(".navigation").boundingBox()).width;
}
async function waitWidth(value) {
  await page.waitForFunction(expected => {
    const navigation = document.querySelector(".navigation");
    return navigation && Math.abs(navigation.getBoundingClientRect().width - expected) < 2;
  }, value);
}
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();

  assert.equal(await page.getByRole("button", { name: "调整侧栏宽度" }).count(), 0);
  const splitter = page.getByRole("separator", { name: "拖动调整侧栏宽度" });
  await splitter.waitFor();
  assert.equal(Math.round(await sidebarWidth()), 240);
  const rect = await splitter.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 160);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 96, rect.y + 160, { steps: 8 });
  await page.mouse.up();
  await waitWidth(336);
  assert.equal(await page.evaluate(() => localStorage.getItem("sd-sidebar-width")), "336");
  await page.reload();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await waitWidth(336);
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  await waitWidth(328);
  await page.keyboard.press("Home");
  await waitWidth(208);
  await page.keyboard.press("End");
  await waitWidth(400);
  await splitter.dblclick();
  await waitWidth(240);
  await page.getByRole("button", { name: "折叠导航" }).click();
  await page.locator(".navigation.is-collapsed").waitFor();
  assert.equal(await splitter.count(), 0);
  await page.getByRole("button", { name: "展开导航" }).click();
  await waitWidth(240);

  await selectNavigation(page, "输电设备台账");
  await page.getByRole("heading", { name: "输电设备台账", exact: true }).waitFor();
  const table = page.locator(".business-table-grid").first();
  await table.locator(".el-loading-mask").waitFor({ state: "hidden" });
  await table.locator(".el-table__body-wrapper .el-table__row").first().waitFor();
  const name = table.getByRole("columnheader", { name: /线路名称/ });
  await stableTableLayout(table);
  const initial = await name.boundingBox();
  const headers = await table.locator(".el-table__header-wrapper th .business-column-title").evaluateAll(items =>
    items.map(el => ({
      text: el.textContent,
      wrapping: getComputedStyle(el).whiteSpace,
      clipped: el.scrollWidth > el.clientWidth + 2,
    })));
  assert.ok(headers.length >= 4);
  assert.ok(headers.every(h => h.wrapping === "nowrap" && !h.clipped), JSON.stringify(headers));

  // Element Plus native resize is activated only on tables with border enabled.
  const x = initial.x + initial.width - 2;
  const y = initial.y + initial.height / 2;
  await page.mouse.move(x, y);
  await page.waitForFunction(() => document.body.style.cursor === "col-resize");
  await page.mouse.down();
  await page.mouse.move(x + 84, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("sd-columns:catalog:lines") || "{}");
    return saved.widths?.name > 220;
  });
  const resized = await name.boundingBox();
  assert.ok(resized.width > initial.width + 48, "dragging table column boundary must increase width");
  const savedWidth = await page.evaluate(() => JSON.parse(localStorage.getItem("sd-columns:catalog:lines")).widths.name);
  await page.reload();
  await selectNavigation(page, "输电设备台账");
  await page.getByRole("heading", { name: "输电设备台账", exact: true }).waitFor();
  const restored = await page.locator(".business-table-grid").first().getByRole("columnheader", { name: /线路名称/ }).boundingBox();
  assert.ok(Math.abs(restored.width - savedWidth) <= 3, JSON.stringify({ restored: restored.width, savedWidth }));
  // The final fixed action column must be resizable and saved as well.
  const lastTable = page.locator(".business-table-grid").first();
  await lastTable.locator(".el-loading-mask").waitFor({ state: "hidden" });
  const actionsHeader = lastTable.getByRole("columnheader", { name: "操作", exact: true });
  await stableTableLayout(lastTable);
  const actionsBefore = await actionsHeader.boundingBox();
  const ax = actionsBefore.x + actionsBefore.width - 2;
  const ay = actionsBefore.y + actionsBefore.height / 2;
  await page.mouse.move(ax, ay);
  await page.waitForFunction(() => document.body.style.cursor === "col-resize");
  await page.mouse.down();
  await page.mouse.move(ax - 46, ay, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("sd-columns:catalog:lines") || "{}");
    return saved.widths?.__actions > 80 && saved.widths.__actions < 295;
  });
  const actionsSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("sd-columns:catalog:lines")).widths.__actions);
  await page.reload();
  await selectNavigation(page, "输电设备台账");
  const actionsRestored = await page.locator(".business-table-grid").first().getByRole("columnheader", { name: "操作", exact: true }).boundingBox();
  assert.ok(Math.abs(actionsRestored.width - actionsSaved) < 3);

  // Changing the query from page 2 must display page 1 of the NEW result set.
  await page.locator(".el-pagination .btn-next").first().click();
  await page.waitForFunction(() => document.querySelector(".el-pagination .el-pager .is-active")?.textContent?.trim() === "2");
  const search = page.getByPlaceholder("搜索名称或真实属性");
  await search.fill("测试可拖动侧栏和列宽");
  await search.press("Enter");
  await table.getByRole("cell", { name: "测试可拖动侧栏和列宽", exact: true }).waitFor();
  assert.equal((await page.locator(".el-pagination .el-pager .is-active").first().textContent()).trim(), "1");

  for (const width of [1500, 900, 760]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(120);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "table/side navigation should not overflow viewport at " + width);
    await page.screenshot({ path: join(output, "resizable-layout-" + width + ".png"), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("RESIZE_BROWSER_OK sidebar pointer+keyboard+restore+collapse and real header edge-drag+nowrap+persist, 3 widths");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
