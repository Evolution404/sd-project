import { selectNavigation } from "./navigation-helper.mjs";
import { columnIndex } from "../workbook-helpers.mjs";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.mjs";

// A normal LAN HTTP origin has getRandomValues() but no randomUUID().
// Emulate that API shape before any application JS runs.
const cleanup = [];
const { s } = fixture({ after: (callback) => cleanup.push(callback) });
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  Object.defineProperty(Crypto.prototype, "randomUUID", {
    configurable: true,
    value: undefined,
  });
});
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  const context = await page.evaluate(() => ({
    randomUUID: typeof crypto.randomUUID,
    getRandomValues: typeof crypto.getRandomValues,
  }));
  assert.equal(context.randomUUID, "undefined");
  assert.equal(context.getRandomValues, "function");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await selectNavigation(page, "专业需求");
  await page
    .getByRole("button", { name: "Excel 批量处理", exact: true })
    .click();
  const buffer = await makeWorkbook("demands", {
    documents: [
      {
        demand_no: "HTTP-LAN-001",
        operation_name: "安装防鸟装置",
        problem_description: "内网HTTP浏览器批量录入",
        completion_standard: "安装牢固",
      },
    ],
    work_locations: [
      {
        demand_no: "HTTP-LAN-001",
        location_kind: "physical_tower",
        asset_no: "T15",
        quantity_scaled: 10000,
      },
    ],
  });
  await page.locator(".el-upload input[type=file]").setInputFiles({
    name: "http-lan.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByText("新增 1", { exact: false }).waitFor();
  await page.getByRole("button", { name: "确认提交有效单据" }).click();
  await page.getByText("已处理 1 张单据，失败 0 项").waitFor();
  assert.equal(s.demands.list().length, 1);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "筛选结果维护导出", exact: true })
    .click();
  const exported = readFileSync(await (await downloaded).path());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported);
  const positions = workbook.getWorksheet("作业位置");
  const quantityColumn = columnIndex(positions, "quantity_scaled");
  assert.ok(quantityColumn > 0);
  positions.getRow(2).getCell(quantityColumn).value = "2.5";
  await page.locator(".el-upload input[type=file]").setInputFiles({
    name: "http-lan-revision.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await page.getByText("更新 1", { exact: false }).waitFor();
  assert.equal(await page.locator(".el-dialog pre").count(), 0);
  await page.getByRole("button", { name: "确认提交有效单据" }).click();
  await page.getByText("已处理 1 张单据，失败 0 项").waitFor();
  const revised = s.demands.list()[0];
  assert.equal(revised.current_version, 2);
  assert.equal(revised.quantity_scaled, 25000);
  assert.deepEqual(errors, []);
  console.log("LAN_HTTP_CRYPTO_API_SHAPE_LOGIN_AND_EXCEL_OK");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const callback of cleanup.reverse()) await callback();
}
