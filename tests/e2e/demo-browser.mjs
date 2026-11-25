import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";

test("demo can be explored in the real browser without any manual master-data setup", async t => {
  const root = mkdtempSync(join(tmpdir(), "sd113-demo-browser-"));
  const dir = join(root, "demo");
  ensureDemoDatabase(dir);
  const system = createSystem(dir);
  const server = httpServer(system);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    system.close();
    rmSync(root, { recursive: true, force: true });
  });
  browser = await chromium.launch(existsSync(chromium.executablePath())
    ? { headless: true } : { headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = "http://127.0.0.1:" + server.address().port;
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill(DEMO_ACCOUNT);
  await page.getByLabel("密码", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();

  async function visit(path, text) {
    await page.goto(base + "/#/" + path);
    await page.locator("main h1").waitFor();
    if (text) await page.getByText(text, { exact: false }).first().waitFor();
    else await page.locator(".el-table__body-wrapper tr").first().waitFor();
  }
  await visit("ledger/lines", "【演示】220kV青峰线");
  await visit("ledger/towers", null); // expanded catalog is paginated; no fixed tower row
  await visit("demands", null); // 24 varied demand samples; row order is not fixed
  await visit("projects", null); // 16 projects in several workflow states
  await visit("standards/operations", "安装防鸟装置");
  await visit("pricing/prices", "【演示】防鸟安装—常规施工");
  const output = join(process.cwd(), "test-results/schema113");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "demo-experience-1280.png"), fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(inspect(system).integrity().foreignKeys.length, 0);
});
