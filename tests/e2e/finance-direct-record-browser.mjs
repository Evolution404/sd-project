import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";
const root = mkdtempSync(join(tmpdir(), "sd-finance-journey-"));
const dir = join(root, "demo");
ensureDemoDatabase(dir);
const s = createSystem(dir);
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const out = join(process.cwd(), "test-results/schema113/user-journey");
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  await page.goto(base + "/#/finance");
  await page.getByLabel("用户名", { exact: true }).fill(DEMO_ACCOUNT);
  await page.getByLabel("密码", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // A valid read token cannot read another project's cost by tampering
  // with the nested project identifier; this must fail in the API itself.
  const firstCost = s.finance.search("costs", {
    page: 1, page_size: 1, q: "", filters: {}, sort: "created_at",
    direction: "desc", deleted: false,
  }).items[0];
  const anotherProject = s.projects.list().find(record => record.id !== firstCost.project_id);
  assert.ok(firstCost && anotherProject);
  const tampered = await page.evaluate(async ({ projectId, costId }) => {
    const response = await fetch(
      "/api/projects/" + projectId + "/costs/" + costId,
      { credentials: "include" },
    );
    return { status: response.status, text: await response.text() };
  }, { projectId: anotherProject.id, costId: firstCost.id });
  assert.equal(tampered.status, 404,
    "nested cost history must enforce project ownership even when the viewer has login access");
  await page.getByRole("radio", { name: "按项目办理", exact: true }).waitFor();
  assert.equal(await page.getByRole("radio", { name: "按项目办理" }).isChecked(), true);
  await page.locator(".el-radio-button").filter({ hasText: "跨项目查询" }).click();
  await page.getByRole("tab", { name: "真实费用", exact: true }).waitFor();
  const costRow = page.getByRole("row").filter({ hasText: "【演示】防鸟装置安装实际发生费用" });
  await costRow.getByRole("button", { name: "查看记录" }).click();
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("heading", { name: "【演示】防鸟装置安装实际发生费用" }).waitFor();
  await detail.getByText("真实费用记录", { exact: true }).waitFor();
  await detail.getByRole("button", { name: /查看所属项目/ }).waitFor();
  await page.screenshot({ path: join(out, "cross-cost-detail.png") });
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await detail.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "结算单", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "JS-" }).first()
    .getByRole("button", { name: "查看记录" }).click();
  await detail.getByRole("heading", { name: "本次结算明细" }).waitFor();
  await page.screenshot({ path: join(out, "cross-settlement-detail.png") });
  await detail.getByRole("button", { name: /查看所属项目/ }).click();
  await page.waitForURL(url => url.hash.includes("#/projects") && url.hash.includes("focus=settlement"));
  await page.getByRole("tab", { name: "费用与结算" }).waitFor();
  await page.getByRole("tab", { name: "费用与结算" }).click();
  await page.getByRole("heading", { name: "定位独立结算单", exact: true }).waitFor();
  await page.getByText(/JS-2026/, { exact: false }).first().waitFor();
  await page.screenshot({ path: join(out, "settlement-target-inside-project.png") });
  assert.deepEqual(errors, []);
  console.log("FINANCE_DIRECT_RECORD_BROWSER_OK project-first, direct cost/settlement view, target-project finance context");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  s.close();
  rmSync(root, { recursive: true, force: true });
}
