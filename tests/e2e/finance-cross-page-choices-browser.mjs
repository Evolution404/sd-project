import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { selectFormChoice } from "./field-helper.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { memoryPage } from "../../dist/server/platform/http/memory-page.js";

const cleanup = [];
const { s, user, project, node, scope, approval, demand } =
  approvedFixture({ after: done => cleanup.push(done) });
const costs = [];
for (let n = 0; n < 35; n++)
  costs.push(s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "跨页费用" + n, occurred_on: "2026-11-12",
    amount_fen: 15000 + n, evidence: "真实费用依据",
  }));
const bills = [];
for (let n = 0; n < 35; n++) {
  let bill = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id,
      amount_fen: 24000 + n, quantity_scaled: 10000, evidence: "结算依据" + n }],
    resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 0, evidence: "不新增解决量" }],
  });
  bill = s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: 1 });
  bills.push(s.finance.review(user, bill.id, {
    expected_version: 1, expected_event_seq: 1, action: "approve",
  }));
}
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
try {
  await page.goto("http://127.0.0.1:" + server.address().port
    + "/#/projects/" + project.id + "/finance");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "新增正式核对", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "正式费用核对" });
  const params = new URLSearchParams("page=1&page_size=30&sort=created_at&direction=desc");
  const costVisible = new Set(memoryPage(s.finance.costs(project.id), params).items.map(item => item.id));
  const billVisible = new Set(memoryPage(s.finance.settlements(project.id), params).items.map(item => item.id));
  const cost = costs.find(item => !costVisible.has(item.id));
  const bill = bills.find(item => !billVisible.has(item.id));
  assert.ok(cost && bill, "both selections must be absent from the first 30-row list page");
  await selectFormChoice(page, "实际费用", cost.title + " ¥" + (cost.amount_fen / 100).toFixed(2), editor);
  await selectFormChoice(page, "已批准结算明细", bill.number + " ¥" + (bill.items[0].amount_fen / 100).toFixed(2) + " · 人工费 · " + demand.demand_no, editor);
  await editor.getByLabel("费用份额（元）").fill("50");
  await editor.getByLabel("核定结算额（元）").fill("50");
  await editor.getByLabel("核对依据").fill("跨页核对验收");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.ok(s.finance.reconciliations(project.id).some(item =>
    item.cost_version_id === cost.id && item.settlement_item_version_id === bill.items[0].id));
  console.log("FINANCE_CROSS_PAGE_CHOICES_OK 35 costs and 35 settlements");
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const done of cleanup.reverse()) await done();
}
