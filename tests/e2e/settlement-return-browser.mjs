import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, project, approval, scope, node } =
  approvedFixture({ after: fn => cleanup.push(fn) });
const draft = s.finance.saveDraft(user, project.id, {
  approval_version_id: approval.id,
  items: [{ cost_node_id: node.id, project_scope_id: scope.id,
    amount_fen: 12000, quantity_scaled: 10000, evidence: "结算交接" }],
  resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 10000,
    evidence: "验收凭据" }],
});
const original = s.finance.submit(user, draft.id, {
  expected_version: 0, expected_edit_version: 1,
});
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1450, height: 1040 } });
const out = join(process.cwd(), "test-results/schema113/settlement-return");
mkdirSync(out, { recursive: true });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
async function clickAction(row, name) {
  const primary = row.getByRole("button", { name, exact: true });
  if (await primary.count()) {
    await primary.click();
  } else {
    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}
try {
  const base = "http://127.0.0.1:" + server.address().port;
  await page.goto(base + "/#/projects?project=" + project.id + "&tab=finance");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("heading", { name: project.name, exact: true }).waitFor();
  const row = detail.getByRole("row").filter({ hasText: draft.number }).first();
  await row.waitFor();
  await row.getByRole("button", { name: "更多操作" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "审核中（禁止修订）", exact: true }).isDisabled(), true,
    "submitted settlement must be locked during review");
  await page.keyboard.press("Escape");
  await clickAction(row, "退回");
  const prompt = page.locator(".el-message-box:visible");
  await prompt.locator(".el-button--primary").click();
  await prompt.waitFor();
  await prompt.locator("textarea").fill("发票编号需要补全");
  await prompt.locator(".el-button--primary").click();
  await row.getByText("退回原因：发票编号需要补全", { exact: false }).waitFor();
  assert.equal(s.finance.settlement(draft.id).review.action, "return");
  assert.equal(s.finance.settlement(draft.id).review.reason, "发票编号需要补全");
  assert.equal(s.finance.settlement(draft.id).version.id, original.version.id);
  await clickAction(row, "原版重新提交");
  await page.locator(".el-message-box:visible .el-button--primary").click();
  await row.getByText(/待审核/).waitFor();
  const resubmitted = s.finance.settlement(draft.id);
  assert.equal(resubmitted.review.action, "submit");
  assert.equal(resubmitted.version.id, original.version.id);
  assert.equal(resubmitted.review.event_seq, 3);
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(out, "resubmitted.png"), fullPage: true });
  console.log("SETTLEMENT_RETURN_BROWSER_OK return reason, review lock, same immutable version resubmission");
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const fn of cleanup.reverse()) await fn();
}
