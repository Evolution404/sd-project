import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [];
const { s, user, unit } = fixture({ after: action => cleanup.push(action) });
for (let i = 1; i <= 65; i++) {
  s.materials.save(user, {
    name: "组件验收物资" + String(i).padStart(3, "0"),
    unit_id: unit.id,
    model: i <= 25 ? "A型" : i <= 45 ? "B型" : "C型",
    specification: "标准规格",
    status: i % 2 ? "active" : "inactive",
  });
}
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", err => errors.push(err.message));
const output = join(process.cwd(), "test-results/schema113/tabulator-materials");
mkdirSync(output, { recursive: true });
try {
  await page.goto(base + "/#/materials");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "物资管理" }).waitFor();
  await page.locator(".tabulator-row").first().waitFor();
  assert.equal(await page.locator(".tabulator-range").count(),0,"ordinary list never displays Excel selection");
  await page.locator(".tabulator-row").first().locator('.tabulator-cell[tabulator-field="model"]').click();
  assert.equal(await page.locator(".tabulator-range").count(),0,"clicking a normal cell does not activate a spreadsheet range");
  const computedAppearance=await page.evaluate(()=>{
    const head=document.querySelector(".tabulator-col-title");
    const body=document.querySelector(".tabulator-row");
    const first=document.querySelector('.tabulator-cell[tabulator-field="name"]');
    return {header:getComputedStyle(head).color,headerBackground:getComputedStyle(head.closest(".tabulator-header")).backgroundColor,
      row:getComputedStyle(body).color,rowBackground:getComputedStyle(body).backgroundColor,
      cellBackground:getComputedStyle(first).backgroundColor,
      range:document.querySelectorAll(".tabulator-range-selected").length};
  });
  assert.equal(computedAppearance.header,"rgb(66, 83, 107)");
  assert.equal(computedAppearance.headerBackground,"rgb(244, 247, 251)");
  assert.equal(computedAppearance.row,"rgb(23, 34, 52)");
  assert.ok(["rgb(255, 255, 255)","rgb(243, 247, 255)"].includes(computedAppearance.rowBackground),
    "list row only uses normal or hover background, not spreadsheet selection");
  assert.equal(computedAppearance.range,0);
  await page.screenshot({path:join(output,"material-normal-view-light.png")});
  assert.equal(await page.locator(".tabulator-row").count(), 30, "server page contains 30 materials");
  assert.equal(await page.locator(".tabulator-header-filter").count(),6,
    "all six columns use native Tabulator header filters");
  assert.equal(await page.locator(".grid-filter-trigger,.excel-filter-menu").count(),0,
    "custom PMS menus must not appear");
  const modelHeader=page.locator('.tabulator-col[tabulator-field="model"]');
  await modelHeader.locator(".tabulator-col-title").click();
  assert.equal(await modelHeader.getAttribute("aria-sort"),"ascending",
    "native Tabulator sort icon and aria state must persist");
  await modelHeader.locator(".tabulator-header-filter input").click();
  const options=page.locator(".tabulator-edit-list-item");
  await options.filter({hasText:"A型"}).first().waitFor();
  assert.deepEqual((await options.allTextContents()).sort(),["A型","B型","C型"],
    "native option lookup covers all 65 records, not only the current 30-page");
  await options.filter({hasText:"A型"}).first().click();
  await options.filter({hasText:"B型"}).first().click();
  await page.waitForTimeout(175); // allow Tabulator to finish binding its native blur handler
  await page.getByRole("heading",{name:"物资管理"}).click();
  await page.getByText("共 45 条").waitFor();
  assert.equal(await page.locator(".tabulator-row").count(),30);
  assert.equal(await page.locator(".tabulator-row").filter({hasText:"C型"}).count(),0);
  assert.equal(await modelHeader.locator(".tabulator-header-filter input").inputValue(),"A型,B型");
  assert.equal(await modelHeader.getAttribute("aria-sort"),"ascending",
    "native ascending sorting remains visible after server filtering");
  await page.screenshot({path:join(output,"native-model-multiselect-and-sort.png")});
  const data = await page.evaluate(async () => {
    const api = await fetch("/api/catalog/materials?page=2&grid_filters=" +
      encodeURIComponent(JSON.stringify({ model: ["A型", "B型"] })), { credentials: "same-origin" });
    return { status: api.status, json: await api.json() };
  });
  assert.equal(data.status, 200);
  assert.equal(data.json.total, 45);
  assert.ok(data.json.items.every(item => ["A型", "B型"].includes(item.model)));
  const facet = await page.evaluate(async () => {
    const p = new URLSearchParams({
      column: "status", grid_filters: JSON.stringify({ model: ["A型"] }), filters: "{}",
    });
    const response = await fetch("/api/catalog/materials/filter-values?" + p, { credentials: "same-origin" });
    return { status: response.status, json: await response.json() };
  });
  assert.equal(facet.status, 200);
  assert.deepEqual(facet.json.items.map(item => item.count).sort((a,b)=>a-b), [12,13]);
  await page.getByRole("button",{name:"清除检索与列筛选"}).click();
  await page.getByText("共 65 条").waitFor();
  assert.equal(await modelHeader.locator(".tabulator-header-filter input").inputValue(),"",
    "clearing server filters must reset native Tabulator filter controls too");
  const empty = await page.evaluate(async () => {
    const p = new URLSearchParams({ grid_filters: '{"unsupported":["X"]}' });
    const response = await fetch("/api/catalog/materials?" + p, { credentials: "same-origin" });
    return response.status;
  });
  assert.equal(empty, 400, "unsupported columns must fail closed, not silently return all data");
  await page.getByRole("button", { name: "列设置" }).click();
  const settings = page.getByRole("dialog", { name: "自定义表格列" });
  await settings.waitFor();
  await settings.locator(".grid-column-setting").filter({hasText:"规格"}).locator("label.el-checkbox").first().click();
  await settings.getByRole("button", { name: "完成" }).click();
  await settings.waitFor({ state: "hidden" });
  await page.screenshot({ path: join(output, "1280-materials-grid.png") });
  await page.locator(".tabulator-row").first().locator(".cell-link").click();
  await page.getByRole("dialog", { name: "物资详情" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("TABULATOR_NATIVE_MATERIALS_BROWSER_OK 65 records/30 page, native remote header sorting and multiselect filtering, strict invalid filter, column settings, details");
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  console.log("TABULATOR_MATERIALS_ERRORS", errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
