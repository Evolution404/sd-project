import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [], { s, save } = fixture({ after: fn => cleanup.push(fn) });
const voltage = save("voltages", { name: "110kV" });
const line = save("lines", { name: "米制管辖长度验收线路", voltage_level_id: voltage.id });
const a = save("towers", { line_id: line.id, tower_no: "01" });
const b = save("towers", { line_id: line.id, tower_no: "02" });
const span = save("spans", {
  line_id: line.id, start_tower_id: a.id, end_tower_id: b.id,
  transmission_center_length_mm: 125750, status: "active",
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/span-metres");
mkdirSync(output, { recursive: true });
const detail = page.locator(".business-detail-dialog:visible");
const editor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
const label = "输电中心管辖长度（米）";
try {
  await page.goto("http://127.0.0.1:" + server.address().port + "/#/ledger/spans");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("tab", { name: "档距", exact: true }).waitFor();
  await page.getByRole("columnheader", { name: /中心管辖长度（米）/ }).waitFor();
  await page.getByRole("cell", { name: "125.75", exact: true }).waitFor();
  await page.getByRole("row").filter({ hasText: "125.75" })
    .getByRole("button", { name: "查看", exact: true }).click();
  await detail.getByText(label, { exact: true }).waitFor();
  await detail.getByText("125.75", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "编辑", exact: true }).click();
  const input = editor.getByLabel(label, { exact: true });
  await input.waitFor();
  assert.equal(Number(await input.inputValue()), 125.75, "form must show metres, not raw millimetres");
  await input.fill("130.125");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.catalog.get("spans", span.id).transmission_center_length_mm, 130125,
    "metres entry must become integer mm exactly");
  await detail.getByText("130.125", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "完整历史", exact: true }).click();
  const history = detail.getByRole("heading", { name: "完整版本与审计历史", exact: true });
  await history.waitFor();
  await detail.locator(".el-collapse-item__header").first().click();
  await detail.getByText("130.125 米", { exact: true }).first().waitFor();
  await page.screenshot({ path: join(output, "detail-metres.png"), fullPage: true });
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await detail.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "筛选中心管辖长度（米）", exact: true }).click();
  const filter = page.getByPlaceholder("筛选中心管辖长度（米）", { exact: true });
  await filter.fill("130.125");
  await filter.press("Enter");
  await page.getByRole("cell", { name: "130.125", exact: true }).waitFor();
  await filter.fill("130125");
  await filter.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("main .el-table__body-wrapper .el-table__row").length === 0);
  assert.deepEqual(errors, []);
  console.log("SPAN_METRES_BROWSER_OK list/detail/form/history/filter display in metres; metres input -> precise mm storage");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const fn of cleanup.reverse()) await fn();
}
