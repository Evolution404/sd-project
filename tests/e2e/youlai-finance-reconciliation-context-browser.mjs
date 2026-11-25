import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
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
  resolutions: [{ project_scope_id: scope.id, location_item_no: 1,
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
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const out = join(process.cwd(), "test-results/schema113/finance-context");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:" + server.address().port;
const detail = page.getByRole("dialog", { name: "正式费用核对记录", exact: true });
try {
  await page.goto(base + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(base + "/#/funding/finance?view=reconciliations");
  const list = s.finance.search("reconciliations", {
    page: 1, page_size: 30, q: "", deleted: false,
    filters: {}, sort: "created_at", direction: "desc",
  });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].project_id, project.id);
  const keyword = page.getByPlaceholder("费用事项或项目编号");
  await keyword.fill(cost.title);
  await keyword.press("Enter");
  await page.waitForURL(url => url.hash.includes("_list="));
  const portfolio = page.url();
  await page.getByRole("button", { name: list.items[0].label, exact: true }).click();
  await detail.waitFor();
  await detail.getByText("三类财务定位专项核对依据").first().waitFor();
  await page.screenshot({ path: join(out, "reconciliation-direct.png") });
  await detail.getByRole("button", { name: /查看所属项目/ }).click();
  await page.waitForURL(url => url.hash.includes("work=reconciliations") && url.hash.includes("project=" + project.id) &&
    url.hash.includes("record=" + rec.record_id));
  await detail.getByText("三类财务定位专项核对依据").first().waitFor();
  await detail.getByText("确认费用核对", { exact: true }).first().waitFor();
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

  await detail.getByRole("button", { name: "返回跨项目核对", exact: true }).click();
  await page.waitForURL(url => url.href === portfolio);
  await detail.getByText("三类财务定位专项核对依据").first().waitFor();
  assert.equal(await keyword.inputValue(), cost.title);
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await detail.waitFor({ state: "hidden" });
  // Nonexistent record: no previous fact remains on screen.
  await page.goto(base + "/#/funding/finance?project=" + project.id +
    "&work=reconciliations&record=missing-identity");
  await detail.getByText("核对记录不存在", { exact: true }).waitFor();
  assert.equal(await detail.getByText("三类财务定位专项核对依据").count(), 0);
  assert.deepEqual(errors, []);
  console.log("YOULAI_FINANCE_RECONCILIATION_CONTEXT_OK direct review, version history, linked project, scoped ownership for three kinds, missing records");
} catch (error) {
  console.error("FINANCE_RECONCILIATION_FAILURE", page.url(), errors);
  await page.screenshot({ path: join(out, "failure.png") });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.shutdown(resolve));
  for (const action of cleanup.reverse()) await action();
}
