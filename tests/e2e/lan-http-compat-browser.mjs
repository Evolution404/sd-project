import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";
import { makeWorkbook } from "../../server/exchange/workbook.mjs";

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
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "专业需求", exact: true }).click();
  await page.getByRole("button", { name: "Excel 批量处理", exact: true }).click();
  const buffer = await makeWorkbook("demands", {
    documents: [{
      demand_no: "HTTP-LAN-001",
      operation_code: "install",
      problem_description: "内网HTTP浏览器批量录入",
      completion_standard: "安装牢固",
    }],
    work_locations: [{
      demand_no: "HTTP-LAN-001",
      location_kind: "physical_tower",
      location_code: "T15",
      quantity_scaled: 10000,
    }],
  });
  await page.locator(".el-upload input[type=file]").setInputFiles({
    name: "http-lan.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByText("新增 1", { exact: false }).waitFor();
  await page.getByRole("button", { name: "确认提交有效单据" }).click();
  await page.getByText("已处理 1 张单据，失败 0 项").waitFor();
  assert.equal(s.demands.list().filter((x) => x.demand_no === "HTTP-LAN-001").length, 1);
  assert.deepEqual(errors, []);
  console.log("LAN_HTTP_CRYPTO_API_SHAPE_LOGIN_AND_EXCEL_OK");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const callback of cleanup.reverse()) await callback();
}
