import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, framework, user, project } = approvedFixture({ after: action => cleanup.push(action) });
const agreement = s.funding.save(user, "agreements", {
  name: "安全测试协议", framework_id: framework.id, limit_fen: 80000,
  contract_number: "BROWSER-2026", effective_from: "2026-01-01", effective_to: "2027-01-01",
});
s.projects.fund(user, project.id, {
  agreement_id: agreement.id, expected_version: project.funding?.version_no ?? 0,
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const out = join(process.cwd(), "test-results/schema113/funding-workspace");
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${server.address().port}`;
const detail = page.locator(".business-detail-dialog:visible");
const editor = page.locator(".el-dialog:not(.business-detail-dialog):visible");
async function openRowAction(row, name) {
  await row.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
try {
  await page.goto(base + "/#/frameworks");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "年度框架", exact: true }).waitFor();
  assert.equal(await page.locator("main").getByText("基础数据管理", { exact: true }).count(), 0);
  assert.equal(await page.getByPlaceholder("搜索名称或真实属性").count(), 0);
  const frameworkRow = page.getByRole("row").filter({ hasText: framework.name }).last();
  await frameworkRow.locator(".cell-link:visible").first().click();
  await detail.getByRole("heading", { name: framework.name, exact: true }).waitFor();
  await detail.getByRole("heading", { name: "资金概览" }).waitFor();
  assert.ok(await detail.getByText("¥1,000.00", { exact: true }).count() >= 1);
  assert.ok(await detail.getByText("¥1,200.00", { exact: true }).count() >= 1);
  assert.ok(await detail.getByRole("heading", { name: "关联执行协议（1）" }).count());
  assert.ok(await detail.getByRole("heading", { name: "关联子项目（1）" }).count());
  await page.screenshot({ path: join(out, "framework-detail.png"), fullPage: true });
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await detail.waitFor({ state: "hidden" });

  await page.goto(base + "/#/agreements");
  await page.getByRole("heading", { name: "执行协议", exact: true }).waitFor();
  assert.equal(await page.locator("main").getByText("统一维护业务定义", { exact: false }).count(), 0);
  assert.ok(await page.getByPlaceholder("搜索协议名称、合同编号或合同对方").isVisible());
  const agreementRow = page.getByRole("row").filter({ hasText: agreement.name });
  await agreementRow.locator(".cell-link:visible").first().click();
  await detail.getByRole("heading", { name: agreement.name, exact: true }).waitFor();
  await detail.getByText("BROWSER-2026").first().waitFor();
  await detail.getByRole("heading", { name: "关联子项目（1）" }).waitFor();
  await page.screenshot({ path: join(out, "agreement-detail.png"), fullPage: true });
  await detail.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.getByLabel("协议名称", { exact: true }).fill("安全测试协议正式变更");
  await editor.getByRole("button", { name: "保存正式版本", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.funding.get("agreements", agreement.id).version_no, 2);
  assert.equal(s.funding.history("agreements", agreement.id).length, 2);
  await detail.getByRole("button", { name: "完整历史" }).click();
  await detail.getByRole("heading", { name: "正式版本与审计历史" }).waitFor();
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await detail.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "新增执行协议", exact: true }).click();
  await editor.getByLabel("协议名称", { exact: true }).fill("浏览器创建协议");
  await editor.getByLabel("所属年度框架", { exact: true }).click();
  await page.getByRole("option", { name: new RegExp(framework.name) }).first().click();
  await editor.getByRole("button", { name: "保存正式版本" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.ok(s.funding.list("agreements").some(row => row.name === "浏览器创建协议"));
  await page.screenshot({ path: join(out, "agreement-list.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("FUNDING_WORKSPACE_BROWSER_OK two dedicated business pages, related facts, version history, edit and create");
} catch (error) {
  console.error("FUNDING_WORKSPACE_FAILURE", page.url(), errors);
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
