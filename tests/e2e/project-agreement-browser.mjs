import {inspect} from "../inspector.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";

const root = mkdtempSync(join(tmpdir(), "sd-funding-browser-"));
const directory = join(root, "demo");
ensureDemoDatabase(directory);
const s = createSystem(directory);
const { user } = s.auth.login(DEMO_ACCOUNT, DEMO_PASSWORD);
const project = s.projects.list().find(x => x.status === "approved");
const framework = s.catalog.list("frameworks")[0];
const agreements = s.catalog.list("agreements");
const original = agreements.find(x => x.id === project.funding.agreement_id);
const other = agreements.find(x => x.id !== original.id);
const foreignFramework = s.catalog.save(user, "frameworks", {
  name: "测试其他框架", fiscal_year: 2027, limit_fen: 2000000,
});
s.catalog.save(user, "agreements", {
  name: "不可跨框架关联的协议", framework_id: foreignFramework.id,
  limit_fen: 300000,
});
s.catalog.save(user, "agreements", {
  name: "已停用测试协议", framework_id: framework.id,
  limit_fen: 300000, status: "inactive",
});
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", err => errors.push(err.message));
const out = join(process.cwd(), "test-results/schema113/agreements");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:" + server.address().port;
const editor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
try {
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill(DEMO_ACCOUNT);
  await page.getByLabel("密码", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
  await page.goto(base + "/#/projects?project=" + project.id);
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.waitFor();
  async function openProfileEditor() {
    await detail.getByRole("button", { name: "更多管理操作" }).click();
    await page.getByRole("menuitem", { name: "修订档案" }).click();
    await editor.getByLabel("执行协议（选填）", { exact: true }).waitFor();
  }
  assert.equal(await detail.getByRole("button", { name: "资金归属" }).count(), 0,
    "standalone funding attribution action must be removed");
  await openProfileEditor();
  await editor.getByLabel("执行协议（选填）", { exact: true }).click();
  const originalOption = page.getByRole("option", { name: new RegExp(original.name) });
  await originalOption.waitFor();
  const alternative = page.getByRole("option", { name: new RegExp(other.name) });
  await alternative.waitFor();
  assert.equal(await page.getByRole("option", { name: /不可跨框架关联的协议/ }).count(), 0);
  assert.equal(await page.getByRole("option", { name: /已停用测试协议/ }).count(), 0);
  await alternative.click();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const revised = s.projects.get(project.id);
  assert.equal(revised.funding.agreement_id, other.id);
  assert.equal(revised.funding.version_no, project.funding.version_no + 1);
  assert.equal(inspect(s).where("project_funding_versions", { project_id: project.id }).length, 2);

  await openProfileEditor();
  await editor.getByLabel("执行协议（选填）", { exact: true }).click();
  await page.getByRole("option", { name: new RegExp(other.name) }).waitFor();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(out, "same-framework-budget-1000.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PROJECT_PROFILE_AGREEMENT_BROWSER_OK: no standalone attribution action, same-framework active agreements, immutable funding revisions");
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  s.close();
  rmSync(root, { recursive: true, force: true });
}
