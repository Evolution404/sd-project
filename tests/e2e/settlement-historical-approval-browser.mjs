import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const f = approvedFixture({ after: fn => cleanup.push(fn) });
const input = { approval_version_id: f.approval.id,
  items: [{ cost_node_id: f.node.id, project_scope_id: f.scope.id, amount_fen: 10000, evidence: "历史范围测试" }],
  resolutions: [{ project_scope_id: f.scope.id, location_item_no: 1, resolved_quantity_scaled: 10000 }] };
let bill = f.s.finance.saveDraft(f.user, f.project.id, input);
bill = f.s.finance.submit(f.user, bill.id, { expected_version: 0, expected_edit_version: 1 });
f.s.finance.review(f.user, bill.id, { expected_version: 1, expected_event_seq: 1, action: "approve" });
let project = f.s.projects.approvalDraft(f.user, f.project.id, {
  expected_version: f.project.version, expected_approval_version_id: f.approval.id,
  approved_budget_fen: 120001, confirm_changes: true,
  scopes: [{ project_scope_id: f.scope.id, demand_version: 1,
    locations: f.demand.work_locations.map(loc => ({ location_item_no: loc.item_no, approved_quantity_scaled: loc.quantity_scaled })) }],
});
project = f.s.projects.approve(f.user, project.id, project.approvals.find(ap => ap.status === "draft").id,
  { expected_version: project.version });
const server = httpServer(f.s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/projects/${project.id}/finance`);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const detail = page.locator(".business-detail-page:visible");
  await detail.getByRole("tab", { name: "结算单", exact: true }).click();
  const row = detail.getByRole("row").filter({ hasText: bill.number }).first();
  await row.getByRole("button", { name: "发起新修订", exact: true }).click();
  const editor = page.getByRole("region", { name: "修订结算草稿", exact: true });
  const worksheet=editor.locator('[data-grid-key="finance:settlement-work"]');
  await worksheet.locator('.tabulator-row').first().waitFor({timeout:6000});
  assert.equal(await worksheet.locator('.tabulator-row').count(),3,
    "historical settlement revision must show all frozen positions");
  assert.deepEqual(await worksheet.locator('.tabulator-cell[tabulator-field="quantity_text"]').allTextContents(),
    ["1","0","0"],"old nonzero detail and zero defaults must be restored correctly");
  assert.deepEqual(await worksheet.locator('.tabulator-cell[tabulator-field="prior_text"]').allTextContents(),
    ["0","0","0"],"prior effective total excludes the same settlement being revised");
  assert.equal(Number(await editor.getByLabel("本次金额（元）", { exact: true }).first().inputValue()), 100);
  await editor.locator(".el-form-item").filter({ has: page.getByText("修订动作", { exact: true }) })
    .getByText("完整修订", { exact: true }).waitFor();
  const adopted = editor.locator(".el-form-item").filter({ has: page.getByText("采用批准版本", { exact: true }) });
  await adopted.locator(".el-select").click();
  await page.getByRole("option", { name: "批准第2", exact: true }).click();
  const switchDialog=page.locator('.el-message-box:visible');
  await switchDialog.getByText("切换正式批准版本", { exact: true }).waitFor();
  await switchDialog.getByRole("button",{name:"保持当前版本",exact:true}).click();
  await switchDialog.waitFor({state:"hidden"});
  assert.match(await adopted.locator('.el-select').innerText(),/批准第1/,
    "cancelling approval switch must preserve the historic adopted version and current draft cells");
  await adopted.locator(".el-select").click();
  await page.getByRole("option", { name: "批准第1", exact: true }).waitFor({ timeout: 3000 });
  await page.getByRole("option", { name: "批准第1", exact: true }).click();
  await editor.getByLabel("结算依据", { exact: true }).fill("项目变更后仍修订原批准范围的结算");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden", timeout: 7000 });
  const draft = f.s.finance.settlement(bill.id).draft.document;
  assert.equal(draft.approval_version_id, f.approval.id);
  assert.equal(draft.change_type, "revision");
  assert.equal(f.s.finance.summary(project.id).settlement_fen, 10000);
  assert.deepEqual(errors, []);
  console.log("SETTLEMENT_HISTORICAL_APPROVAL_BROWSER_OK");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const fn of cleanup) await fn();
}
