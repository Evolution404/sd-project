import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [];
const { s, user, project, node } = approvedFixture({ after: fn => cleanup.push(fn) });
const c = s.finance.cost(user, project.id, {
  cost_node_id: node.id, title: "删除状态审计费用",
  occurred_on: "2026-11-09", amount_fen: 25000, evidence: "验收",
});
s.finance.removeCost(user, project.id, c.entry_id, { expected_version: 1 });
s.finance.removeNode(user, project.id, node.id, { expected_version: 1 });
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 760, height: 820 } });
const out = join(process.cwd(), "test-results/schema113/finance-deleted");
mkdirSync(out, { recursive: true });
try {
  const base = "http://127.0.0.1:" + server.address().port;
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
  await page.goto(base + "/#/finance");
  await page.locator("main h1").waitFor();
  await page.getByRole("tab", { name: "项目办理", exact: true }).click();
  await page.getByRole("button", { name: "进入项目" }).first().click();
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.waitFor();
  await detail.getByText("包含已删除科目", { exact: true }).click();
  const deletedNode = detail.getByRole("row").filter({ hasText: "人工费" });
  await deletedNode.getByText("已删除", { exact: true }).waitFor();
  assert.equal(await deletedNode.getByRole("button", { name: "编辑版本" }).isDisabled(), true);
  await deletedNode.getByRole("button", { name: "更多操作" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "删除", exact: true }).last().isDisabled(), true);
  await page.keyboard.press("Escape");
  await detail.getByText("包含已删除费用", { exact: true }).click();
  const deletedCost = detail.getByRole("row").filter({ hasText: "删除状态审计费用" });
  await deletedCost.getByText("已删除", { exact: true }).waitFor();
  const statusBounds = await deletedCost.getByText("已删除", { exact: true }).boundingBox();
  const actionsBounds = await deletedCost.getByRole("button", { name: "附件" }).boundingBox();
  assert.ok(statusBounds && actionsBounds &&
    statusBounds.x + statusBounds.width <= actionsBounds.x,
    "the deleted badge must not be covered by the fixed operation column");
  assert.equal(await deletedCost.getByRole("button", { name: "附件" }).isDisabled(), false);
  await deletedCost.getByRole("button", { name: "更多操作" }).click();
  for (const action of ["更正", "撤销", "删除"])
    assert.equal(await page.getByRole("menuitem", { name: action, exact: true }).last().isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(out, "deleted-finance-760.png"), fullPage: true });
  console.log("FINANCE_DELETED_BROWSER_OK");
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const action of cleanup.reverse()) await action();
}
