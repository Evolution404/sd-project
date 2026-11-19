import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, project, framework, scope, approval, node } =
  approvedFixture({ after: action => cleanup.push(action) });
const second = s.projects.save(user, {
  name: "禁止冒充他人项目读取财务",
  framework_id: framework.id,
});
const cost = s.finance.cost(user, project.id, {
  cost_node_id: node.id, title: "高压线路费用",
  occurred_on: "2026-11-11", amount_fen: 8000,
  evidence: "巡线人员核定",
});
let bill = s.finance.saveDraft(user, project.id, {
  approval_version_id: approval.id,
  items: [{ cost_node_id: node.id, project_scope_id: scope.id,
    quantity_scaled: 10000, amount_fen: 5000, evidence: "阶段结算" }],
  resolutions: [{ project_scope_id: scope.id,
    resolved_quantity_scaled: 10000, evidence: "完成量依据" }],
});
bill = s.finance.submit(user, bill.id, {
  expected_version: 0, expected_edit_version: 1,
});
bill = s.finance.review(user, bill.id, {
  expected_version: 1, expected_event_seq: 1, action: "approve",
});
const rec = s.finance.reconciliation(user, {
  expected_version: 0, cost_version_id: cost.id,
  settlement_item_version_id: bill.items[0].id,
  reconciled_cost_fen: 4000, reconciled_settlement_fen: 5000,
  evidence: "三类财务定位专项核对依据", is_final: true,
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const out = join(process.cwd(), "test-results/schema113/finance-context");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:" + server.address().port;
const detail = page.locator(".business-detail-dialog:visible");
try {
  await page.goto(base + "/#/finance/reconciliations");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("tab", { name: "费用核对", exact: true }).waitFor();
  const list = s.finance.search("reconciliations", {
    page: 1, page_size: 30, q: "", deleted: false,
    filters: {}, sort: "created_at", direction: "desc",
  });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].project_id, project.id);
  await page.locator(".cell-link:visible").first().click();
  await detail.getByText("正式费用核对记录", { exact: true }).waitFor();
  await detail.getByText("三类财务定位专项核对依据").first().waitFor();
  await page.screenshot({ path: join(out, "reconciliation-direct.png") });
  await detail.getByRole("button", { name: /查看所属项目/ }).click();
  await page.waitForURL(url => url.hash.includes("focus=reconciliation") &&
    url.hash.includes("record=" + rec.record_id));
  await page.getByRole("heading", { name: "定位正式费用核对", exact: true }).waitFor();
  await page.getByText("三类财务定位专项核对依据").first().waitFor();
  await page.getByRole("button", { name: "查看正式历史", exact: true }).click();
  await page.screenshot({ path: join(out, "reconciliation-in-project.png") });

  // Server-side scope check protects all three financial facts.
  for (const [kind, identity] of [
    ["settlements", bill.id], ["reconciliations", rec.record_id],
    ["costs", cost.entry_id],
  ]) {
    const response = await page.evaluate(async ({ projectId, kind, identity }) => {
      const value = await fetch("/api/projects/" + projectId + "/" + kind + "/" + identity,
        { credentials: "include" });
      return value.status;
    }, { projectId: second.id, kind, identity });
    assert.equal(response, 404, "cross-project " + kind + " leak");
  }

  // Nonexistent record: no previous fact remains on screen.
  await page.goto(base + "/#/projects/" + project.id +
    "/finance?focus=reconciliation&record=missing-identity");
  await page.getByRole("heading", { name: "定位正式费用核对" }).waitFor();
  const focusedPanel = page.locator(".panel").filter({ has:
    page.getByRole("heading", { name: "定位正式费用核对", exact: true }) }).first();
  await focusedPanel.getByText("核对记录不存在").waitFor();
  assert.equal(await focusedPanel.getByText("三类财务定位专项核对依据").count(), 0);
  assert.deepEqual(errors, []);
  console.log("FINANCE_RECONCILIATION_CONTEXT_BROWSER_OK direct review, version history, linked project, scoped ownership for three kinds, missing records");
} catch (error) {
  console.error("FINANCE_RECONCILIATION_FAILURE", page.url(), errors);
  await page.screenshot({ path: join(out, "failure.png") });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
