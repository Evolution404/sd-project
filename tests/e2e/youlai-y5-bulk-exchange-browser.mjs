import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";

const staticDirectory = resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web");
assert.ok(existsSync(join(staticDirectory, "index.html")), "Build the pinned production frontend first");
const cleanup = [];
const { s, user, operation } = fixture({ after: action => cleanup.push(action) });
const count = 5000;
const detailCount = count * 5;
const inspection = inspect(s);
const documentedAt = new Date().toISOString();
inspection.transaction(() => {
  for (let i = 1; i <= detailCount; i++) {
    inspection.insert("physical_towers", {
      id: "browser-bulk-tower-" + i, tower_code: "XL-BULK-" + i, asset_no: "BULK-T" + i,
      created_by: user.id, created_at: documentedAt, updated_at: documentedAt,
    });
  }
});
const documents = Array.from({ length: count }, (_, index) => ({
  import_ref: "BROWSER-" + (index + 1),
  operation_name: operation.name,
  problem_description: "批量浏览器验收需求 " + (index + 1),
  completion_standard: "安装牢固",
}));
const workLocations = Array.from({ length: detailCount }, (_, index) => ({
  import_ref: documents[Math.floor(index / 5)].import_ref,
  location_kind: "physical_tower", asset_no: "BULK-T" + (index + 1), quantity_scaled: 10000,
}));
const invalidLocations = [...workLocations.slice(0, -1), { ...workLocations.at(-1), quantity_scaled: 15000 }];
const invalid = await makeWorkbook("demands", { documents, work_locations: invalidLocations });
const valid = await makeWorkbook("demands", { documents, work_locations: workLocations });
// A synchronous SQLite import should not hold the test driver's event loop.
const backend = new Worker(new URL("./browser-server-worker.mjs", import.meta.url), {
  workerData: { dataDirectory: s.dataDirectory, staticDirectory },
});
let backendError;
backend.on("error", error => { backendError = error; });
const backendExited = new Promise(done => backend.once("exit", done));
const screenshots = resolve("test-results/youlai-y5");
mkdirSync(screenshots, { recursive: true });
let browser;
try {
  const [port] = await Promise.race([
    once(backend, "message"),
    backendExited.then(code => { throw backendError ?? Error("Browser backend exited before listening: " + code); }),
  ]);
  const origin = "http://127.0.0.1:" + port;
  browser = await chromium.launch(existsSync(chromium.executablePath())
    ? { headless: true } : { headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  page.on("response", response => {
    if (response.url().startsWith(origin + "/api/") && response.status() >= 400)
      errors.push(response.status() + " " + new URL(response.url()).pathname);
  });
  await page.goto(origin + "/#/business/demands");
  await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入 Excel" });
  async function upload(buffer) {
    const [response] = await Promise.all([
      page.waitForResponse(row => row.url().includes("/api/exchange/demands/preview?"), { timeout: 120000 }),
      dialog.locator(".el-upload input[type=file]").setInputFiles({
        name: "需求规模验收.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer,
      }),
    ]);
    assert.equal(response.status(), 200, response.ok() ? undefined : (await response.json()).message);
    const summary = await response.json();
    assert.equal(summary.documents[0].payload, undefined, "browser previews only transfer fields required by the summary");
    return summary.summary;
  }
  const started = performance.now();
  assert.equal((await upload(invalid)).invalid_documents, 1);
  await dialog.getByText("新增 4999 条，修改 0 条，保持 0 条，1 条需处理", { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(inspection.list("v_demand_current").length, 0);
  assert.equal(inspection.list("demand_version_work_locations").length, 0);
  assert.equal(await dialog.getByRole("button", { name: "保存整批" }).isDisabled(), true);
  await page.screenshot({ path: join(screenshots, "excel-5000-rejected-1920.png") });

  assert.equal((await upload(valid)).created, 5000);
  await dialog.getByText("新增 5000 条，修改 0 条，保持 0 条，0 条需处理", { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(inspection.list("v_demand_current").length, 0);
  await dialog.getByRole("tab", { name: "拟处理单据（5000）" }).click();
  const firstPage = dialog.locator(".el-tab-pane:visible .el-table tbody tr");
  assert.equal(await firstPage.count(), 20);
  const [committed] = await Promise.all([
    page.waitForResponse(row => /\/api\/exchange\/[^/]+\/commit$/.test(new URL(row.url()).pathname)
      && row.request().method() === "POST", { timeout: 180000 }),
    dialog.getByRole("button", { name: "保存整批" }).click(),
  ]);
  assert.equal(committed.status(), 200, committed.ok() ? undefined : await committed.text());
  await dialog.getByText("已处理 5000 条，0 项需处理", { exact: true }).waitFor({ timeout: 180000 });
  await page.screenshot({ path: join(screenshots, "excel-5000-committed-1920.png") });
  assert.equal(inspection.list("v_demand_current").length, count);
  assert.equal(inspection.list("demand_version_work_locations").length, detailCount);
  const written = s.demands.search({ page: 1, page_size: 20, q: "批量浏览器验收需求 5000", filters: {} });
  assert.equal(written.total, 1);
  const last = s.demands.get(written.items[0].id);
  assert.equal(last.work_locations.length, 5);
  assert.ok(last.work_locations.every(row => row.quantity_scaled === 10000));
  assert.equal(last.work_locations.at(-1).physical_tower_id, "browser-bulk-tower-25000");
  assert.equal(inspection.integrity().foreignKeys.length, 0);
  assert.deepEqual(errors, []);
  console.log("YOULAI_Y5_BULK_EXCHANGE_OK", count, detailCount, Math.round(performance.now() - started) + "ms");
} catch (cause) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({
    path: join(screenshots, "excel-5000-failure.png"),
  }).catch(() => {});
  throw cause;
} finally {
  try {
    await browser?.close();
  } finally {
    backend.postMessage("shutdown");
    const code = await backendExited;
    for (const action of cleanup.reverse()) await action();
    if (code !== 0) throw backendError ?? Error("Browser backend exited unsuccessfully: " + code);
  }
}
