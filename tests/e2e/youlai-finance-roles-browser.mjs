import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user: admin, project, approval, node, scope, demand } =
  approvedFixture({ after: done => cleanup.push(done) });
const passwords = { admin: "Schema113-test-password" };
const actors = { admin };
for (const role of ["editor", "viewer", "verifier"]) {
  passwords[role] = "Finance-UI-" + role + "-Password";
  s.auth.saveUser(admin, { username: role, password: passwords[role], role, status: "active" });
  actors[role] = s.auth.login(role, passwords[role]).user;
}
const cost = s.finance.cost(admin, project.id, {
  cost_node_id: node.id, title: "验收实际费用", occurred_on: "2026-11-20", amount_fen: 25000, evidence: "真实费用验收",
});
const draft = s.finance.saveDraft(actors.editor, project.id, {
  approval_version_id: approval.id,
  mode: "itemized",
  items: [{ cost_node_id: node.id, amount_fen: 12500, evidence: "审批交接账单" }],
  resolutions: [{ project_scope_id: scope.id, location_item_no: 1, resolved_quantity_scaled: 10000, evidence: "已核查完成范围" }],
});
s.finance.submit(actors.editor, draft.id, { expected_version: 0, expected_edit_version: 1 });
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const errors = [];
const output = resolve("test-results/youlai-y4");
mkdirSync(output, { recursive: true });
const financeUrl = origin + "/#/funding/finance?project=" + project.id;
const reviewUrl = origin + "/#/funding/settlements/" + draft.id + "/review?project=" + project.id;
const endpoint = origin + "/api/settlements/" + draft.id + "/review";
const approvalInput = { expected_version: 1, expected_event_seq: 1, action: "approve" };
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
let page;
async function openFinance(role) {
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", error => errors.push(role + ": " + error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill(role);
  await page.getByPlaceholder("密码").fill(passwords[role]);
  await button(page, "登录").click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(financeUrl);
  const bill = page.getByRole("row").filter({ has: page.getByRole("cell", { name: draft.number, exact: true }) });
  await bill.waitFor();
  return bill;
}
async function openCost() {
  await page.getByRole("tab", { name: "费用科目、费用及核对", exact: true }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: cost.title, exact: true }) });
  await row.waitFor();
  return row;
}
try {
  for (const role of ["admin", "editor", "viewer", "verifier"]) {
    const bill = await openFinance(role);
    const canCompile = role === "admin" || role === "editor";
    const canVerify = role === "admin" || role === "verifier";
    assert.equal(await button(page, "新增结算草稿").count(), canCompile ? 1 : 0);
    assert.equal(await button(bill, "编辑草稿").count(), 0);
    await bill.getByText("审核中", { exact: true }).waitFor();
    await button(bill, "查看详情").click();
    const details = page.getByRole("dialog", { name: "结算正式事实及草稿", exact: true });
    await details.getByRole("cell", { name: demand.demand_no, exact: true }).waitFor();
    assert.equal(await button(details, "进入结算审核办理").count(), canVerify ? 1 : 0);
    await details.locator(".el-drawer__close-btn").click();
    await details.waitFor({ state: "hidden" });
    const costRow = await openCost();
    assert.equal(await button(page, "登记实际费用").count(), canVerify ? 1 : 0);
    assert.equal(await button(costRow, "费用核对").count(), canVerify ? 1 : 0);
    assert.equal(await button(costRow, "查看历史").count(), 1);
    await page.screenshot({ path: join(output, "finance-permissions-" + role + "-1920.png"), animations: "disabled" });
    if (!canVerify) {
      const response = await page.request.post(endpoint, {
        data: approvalInput, headers: { "Idempotency-Key": "finance-unapproved-" + role },
      });
      assert.equal(response.status(), 403, await response.text());
      assert.equal(s.finance.settlement(draft.id).review.action, "submit");
    }
    if (role === "editor") {
      await page.goto(reviewUrl);
      const readonly = page.getByRole("region", { name: "结算审核办理", exact: true });
      await readonly.getByText("当前账号没有结算审核权限，可查看正式结算事实。", { exact: true }).waitFor();
      assert.equal(await button(readonly, "审核通过").count(), 0);
    }
    if (role === "verifier") {
      const detailUrl = origin + "/api/settlements/" + draft.id;
      await page.route(detailUrl, route => route.abort(), { times: 1 });
      await page.goto(reviewUrl);
      const review = page.getByRole("region", { name: "结算审核办理", exact: true });
      await button(review, "重新读取").waitFor();
      assert.equal(await button(review, "审核通过").count(), 0);
      await button(review, "重新读取").click();
      await review.getByRole("cell", { name: node.name, exact: true }).waitFor();
      await review.getByRole("cell", { name: demand.demand_no, exact: true }).waitFor();
      const description = review.getByRole("cell", { name: demand.problem_description, exact: true });
      await description.waitFor();
      assert.equal(await description.locator(".cell").evaluate(cell => getComputedStyle(cell).whiteSpace), "normal");
      await review.getByRole("cell", { name: "套", exact: true }).waitFor();
      await button(review, "审核通过").click();
      await button(page.getByRole("dialog", { name: "审核结算", exact: true }), "确定").click();
      await review.getByText("已审核", { exact: true }).waitFor();
      assert.equal(await button(review, "审核通过").count(), 0);
      const approved = s.finance.settlement(draft.id);
      assert.equal(approved.review.actor_id, actors.verifier.id);
      assert.equal(approved.review.action, "approve");
      assert.equal(s.finance.summary(project.id).settlement_fen, 12500);
      await page.reload();
      await review.getByText("已审核", { exact: true }).waitFor();
      assert.equal(await button(review, "审核通过").count(), 0);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("YOULAI_FINANCE_ROLES_OK four actual actors, review recovery, immutable quantities and single authorized approval");
} catch (error) {
  await page?.screenshot({ path: join(output, "finance-roles-failure-1920.png") }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.shutdown(done));
  for (const done of cleanup.reverse()) await done();
}
