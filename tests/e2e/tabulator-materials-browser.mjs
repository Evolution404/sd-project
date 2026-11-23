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
  assert.equal(await page.locator(".tabulator-header-filter").count(),0,
    "PMS reference uses a single header row with its own menu button");
  assert.equal(await page.locator(".grid-column-heading").count(),6);
  const modelButton=page.locator('[data-grid-filter="model"]');
  await modelButton.click();
  const dialog=page.getByRole("dialog",{name:"型号筛选与排序"});
  await dialog.waitFor();
  await dialog.getByText("A型",{exact:true}).waitFor();
  assert.equal(await dialog.locator(".excel-filter-item").count(),3,
    "database facets cover all 65 records rather than current 30 row page");
  assert.ok((await dialog.textContent()).includes("25"));
  assert.ok((await dialog.textContent()).includes("20"));
  await dialog.getByRole("textbox",{name:"搜索型号候选值"}).fill("C");
  await dialog.getByText("C型",{exact:true}).waitFor();
  assert.equal(await dialog.locator(".excel-filter-item").count(),1,
    "PMS-like candidate search filters values without filtering business rows until Apply");
  await dialog.getByRole("textbox",{name:"搜索型号候选值"}).fill("");
  await dialog.getByText("A型",{exact:true}).waitFor();
  assert.equal(await dialog.locator(".excel-filter-item").count(),3);
  await dialog.locator(".excel-filter-all .el-checkbox").click();
  await dialog.locator(".excel-filter-item").filter({hasText:"A型"}).locator(".el-checkbox").click();
  await dialog.locator(".excel-filter-item").filter({hasText:"B型"}).locator(".el-checkbox").click();
  assert.match(await dialog.locator(".excel-filter-summary").innerText(),/已选 2 项/);
  await dialog.getByRole("button",{name:"确定",exact:true}).click();
  await dialog.waitFor({state:"hidden"});
  await page.getByText("共 45 条").waitFor();
  assert.equal(await page.locator(".tabulator-row").count(),30);
  assert.equal(await page.locator(".tabulator-row").filter({hasText:"C型"}).count(),0);
  assert.match((await modelButton.getAttribute("aria-label"))??"",/已筛选/,
    "the header must display persistent active filter status");
  await modelButton.click();
  await dialog.getByRole("button",{name:"↑ 升序排列"}).click();
  await dialog.waitFor({state:"hidden"});
  await page.getByText("共 45 条").waitFor();
  assert.match((await modelButton.getAttribute("aria-label"))??"",/升序/,
    "the header must display persistent sorting status");
  await page.screenshot({path:join(output,"pms-model-multiselect-and-sort.png")});
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
  await modelButton.click();
  await dialog.getByRole("button",{name:"清除此列筛选"}).click();
  await dialog.waitFor({state:"hidden"});
  await page.getByText("共 65 条").waitFor();
  assert.doesNotMatch((await modelButton.getAttribute("aria-label"))??"",/已筛选/);
  assert.match((await modelButton.getAttribute("aria-label"))??"",/升序/);
  await modelButton.click();
  await dialog.getByRole("button",{name:"清除排序"}).click();
  await dialog.waitFor({state:"hidden"});
  assert.doesNotMatch((await modelButton.getAttribute("aria-label"))??"",/升序|降序/);
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
  console.log("TABULATOR_PMS_REFERENCE_BROWSER_OK 65 rows/30 page, user-source styled checkbox menu, remote filtering and Tabulator sorting, visible states, clear, settings, detail");
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  console.log("TABULATOR_MATERIALS_ERRORS", errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
