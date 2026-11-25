import { workPage, submitSettlement } from "./work-page-helper.mjs";
import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, project, approval, node, scope, save } = approvedFixture({ after: action => cleanup.push(action) });
const voltage = save("voltages", { name: "220kV" });
save("lines", { name: "操作菜单验收线", voltage_level_id: voltage.id });
s.management.saveUser(user, { username: "reader", password: "Reader-test-password", role: "viewer", status: "active" });
const bill = s.finance.saveDraft(user, project.id, {
  approval_version_id: approval.id,
  items: [{ cost_node_id: node.id, project_scope_id: scope.id, amount_fen: 100, quantity_scaled: 10000, evidence: "菜单验收" }],
  resolutions: [{ project_scope_id: scope.id, location_item_no: 1, resolved_quantity_scaled: 0, evidence: "仅结费用" }],
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/actions");
mkdirSync(output, { recursive: true });
async function login(name, password) {
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function navigate(name) {
  if (await page.getByRole("button", { name: "打开导航" }).isVisible())
    await page.getByRole("button", { name: "打开导航" }).click();
  await selectNavigation(page, name);
  if (name === "费用与结算") assert.ok(await page.getByRole("radio", { name: "按项目办理" }).isChecked(),
    "finance opens in project-first workflow mode");
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await login("admin", "Schema113-test-password");
  await navigate("输电设备台账");
  const row = page.getByRole("row").filter({ hasText: "操作菜单验收线" });
  await row.locator(".cell-link:visible").first().waitFor();
  assert.equal(await row.getByRole("button", { name: "查看", exact: true }).count(), 0);
  assert.equal(await row.getByRole("button", { name: "操作菜单验收线", exact: true }).count(), 1);
  for (const theme of ["light", "dark"]) {
    const currentDark = await page.locator("html").evaluate(element => element.classList.contains("dark"));
    if (currentDark !== (theme === "dark")) await page.getByRole("button", { name: theme === "dark" ? "切换为深色" : "切换为浅色", exact: true }).click();
    for (const width of [1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await row.locator(".cell-link:visible").first().click();
      const detail = page.locator(".business-detail-dialog:visible");
      for (const label of ["编辑", "完整历史", "删除"]) await detail.getByRole("button", { name: label, exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `ledger-${theme}-${width}.png`), fullPage: true });
      await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
    }
  }
  await row.locator(".cell-link:visible").first().click();
  const ledger = page.locator(".business-detail-dialog:visible");
  await ledger.getByRole("button", { name: "删除", exact: true }).click();
  const preview = page.locator(".el-message-box:visible");
  await preview.getByText(/当前关联线路 0 条/).waitFor();
  await preview.getByRole("button", { name: "取消", exact: true }).click();
  await ledger.getByRole("button", { name: "关闭详情", exact: true }).click();
  assert.equal(s.catalog.list("lines").length, 1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await navigate("费用与结算");
  await page.locator(".cell-link:visible").first().click();
  await page.getByRole("tab", { name: "结算单", exact: true }).click();
  const billRow = page.getByRole("row").filter({ hasText: bill.number });
  await submitSettlement(page, billRow);
  await billRow.getByRole("button", { name: "审核结算", exact: true }).click();
  const reviewForm = page.getByRole("region", { name: "审核结算", exact: true });
  assert.ok(await reviewForm.getByRole("button", { name: "确认退回", exact: true }).isDisabled());
  await reviewForm.getByLabel("退回原因（选择退回时必填）").fill("补充结算凭据");
  assert.ok(await reviewForm.getByRole("button", { name: "确认退回", exact: true }).isEnabled());
  await page.screenshot({ path: join(output, "settlement-pending.png"), fullPage: true });
  await reviewForm.getByRole("button", { name: "取消", exact: true }).click();
  await workPage(page).getByRole("button", { name: "← 返回", exact: true }).click();
  await page.getByRole("button", { name: /^账号设置/ }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await login("reader", "Reader-test-password");
  await navigate("输电设备台账");
  await row.locator(".cell-link:visible").first().click();
  for (const label of ["编辑", "删除"]) assert.equal(await ledger.getByRole("button", { name: label, exact: true }).count(), 0);
  assert.ok(await ledger.getByRole("button", { name: "完整历史", exact: true }).isEnabled());
  await ledger.getByRole("button", { name: "关闭详情", exact: true }).click();
  await navigate("费用与结算");
  await page.locator(".cell-link:visible").first().click();
  await page.getByRole("tab", { name: "结算单", exact: true }).click();
  await billRow.getByRole("button", { name: "附件", exact: true }).waitFor();
  await billRow.getByRole("button", { name: "更多操作" }).click();
  assert.equal(await billRow.getByRole("button", { name: "审核结算", exact: true }).count(), 0);
  for (const label of ["审核中（禁止修订）", "删除"]) assert.ok(await page.getByRole("menuitem", { name: label, exact: true }).isDisabled());
  assert.deepEqual(errors, []);
  console.log("ROW_ACTIONS_BROWSER_OK standard desktop layouts in both themes, cancel, state priority and viewer restrictions");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
