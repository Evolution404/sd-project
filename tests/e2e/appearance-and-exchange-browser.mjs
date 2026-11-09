import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";
import { makeWorkbook } from "../../server/exchange/workbook.mjs";

const cleanup = [], { s, user } = fixture({ after: action => cleanup.push(action) });
s.catalog.save(user, "voltages", { name: "220kV" });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const context = await browser.newContext({
  viewport: { width: 1450, height: 1000 }, colorScheme: "light",
});
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });
async function chooseAppearance(label) {
  await page.getByRole("button", { name: "外观设置" }).click();
  await page.getByText(label, { exact: true }).click();
}
async function darkIs(expected) {
  await page.waitForFunction((dark) =>
    document.documentElement.classList.contains("dark") === dark, expected);
}

try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await chooseAppearance("深色");
  await darkIs(true);
  assert.equal(await page.evaluate(() => localStorage.getItem("sd-appearance")), "dark");
  assert.equal(await page.locator(".navigation").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(24, 35, 55)");
  await page.screenshot({ path: join(output, "appearance-dark-dashboard.png"), fullPage: true });

  await page.reload();
  await darkIs(true);
  await page.getByRole("heading", { name: "工作台" }).waitFor();
  await chooseAppearance("浅色");
  await darkIs(false);
  assert.equal(await page.evaluate(() => localStorage.getItem("sd-appearance")), "light");
  await chooseAppearance("跟随系统");
  await page.emulateMedia({ colorScheme: "dark" });
  await darkIs(true);
  await page.emulateMedia({ colorScheme: "light" });
  await darkIs(false);
  assert.equal(await page.evaluate(() => localStorage.getItem("sd-appearance")), "system");

  await page.getByRole("menuitem", { name: "输电设备台账", exact: true }).click();
  await page.getByRole("heading", { name: "输电设备台账" }).waitFor();
  await page.getByRole("button", { name: "Excel 批量处理", exact: true }).click();
  const workbook = await makeWorkbook("assets", {
    documents: Array.from({ length: 45 }, (_, i) => ({
      name: "预检筛选" + String(i).padStart(3, "0"),
      voltage_name: "220kV",
    })),
  });
  await page.locator(".el-upload input[type=file]").setInputFiles({
    name: "台账预检45.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook,
  });
  const dialog = page.getByRole("dialog", { name: /设备台账 Excel/ });
  await dialog.getByText("新增 45", { exact: true }).waitFor();
  assert.ok(await dialog.getByRole("cell", { name: "预检筛选000", exact: true }).count());
  assert.equal(await dialog.getByRole("cell", { name: "预检筛选044", exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "筛选业务编号" }).click();
  await page.getByPlaceholder("筛选业务编号").fill("预检筛选044");
  await page.getByPlaceholder("筛选业务编号").press("Enter");
  await dialog.getByRole("cell", { name: "预检筛选044", exact: true }).waitFor();
  assert.equal(await dialog.getByRole("cell", { name: "预检筛选000", exact: true }).count(), 0);
  assert.equal(s.catalog.list("lines").filter(x => x.name.startsWith("预检筛选")).length, 0,
    "preview and client-side filtering must never mutate authoritative catalog");
  await page.screenshot({ path: join(output, "exchange-global-filter.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("APPEARANCE_EXCHANGE_BROWSER_OK persisted light/dark/system, 45-document global Excel preflight filtering, zero writes");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
