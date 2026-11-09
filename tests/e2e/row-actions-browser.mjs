import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";

const cleanup = [];
const { s, user, project, approval, node, scope, save } = approvedFixture({ after: action => cleanup.push(action) });
const voltage = save("voltages", { name: "220kV" });
save("lines", { name: "操作菜单验收线", voltage_level_id: voltage.id });
s.management.saveUser(user, { username: "reader", password: "Reader-test-password", role: "viewer", status: "active" });
const bill = s.finance.saveDraft(user, project.id, {
  approval_version_id: approval.id,
  items: [{ cost_node_id: node.id, project_scope_id: scope.id, amount_fen: 100, quantity_scaled: 10000, evidence: "菜单验收" }],
  resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 0, evidence: "仅结费用" }],
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
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
  await page.getByRole("menuitem", { name, exact: true }).last().click();
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await login("admin", "Schema113-test-password");
  await navigate("输电设备台账");
  const row = page.getByRole("row").filter({ hasText: "操作菜单验收线" });
  await row.getByRole("button", { name: "查看", exact: true }).waitFor();
  assert.equal(await row.getByRole("button").count(), 2);
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "外观设置" }).click();
    await page.locator(".el-radio-button").filter({ hasText: theme === "dark" ? "深色" : "浅色" }).click();
    await page.getByRole("heading", { name: "输电设备台账", exact: true }).click();
    for (const width of [1500, 1280, 960, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      await row.getByRole("button", { name: "更多操作" }).click();
      const menu = page.getByRole("menu").filter({ has: page.getByRole("menuitem", { name: "编辑", exact: true }) });
      await menu.waitFor();
      await page.waitForTimeout(200);
      for (const label of ["编辑", "历史", "删除"]) assert.ok(await menu.getByRole("menuitem", { name: label, exact: true }).isEnabled());
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `ledger-${theme}-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
    }
  }
  await row.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(s.catalog.list("lines").length, 1);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await navigate("实际费用与结算");
  await page.getByRole("button", { name: "进入项目" }).click();
  const billRow = page.getByRole("row").filter({ hasText: bill.number });
  await billRow.getByRole("button", { name: "正式提交", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await billRow.getByRole("button", { name: "批准", exact: true }).waitFor();
  await billRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "退回", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "settlement-pending.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "退出登录" }).click();
  await login("reader", "Reader-test-password");
  await navigate("输电设备台账");
  await row.getByRole("button", { name: "更多操作" }).click();
  for (const label of ["编辑", "删除"]) assert.ok(await page.getByRole("menuitem", { name: label, exact: true }).isDisabled());
  assert.ok(await page.getByRole("menuitem", { name: "历史", exact: true }).isEnabled());
  await page.keyboard.press("Escape");
  await navigate("实际费用与结算");
  await page.getByRole("button", { name: "进入项目" }).click();
  await billRow.getByRole("button", { name: "附件", exact: true }).waitFor();
  await billRow.getByRole("button", { name: "更多操作" }).click();
  for (const label of ["批准", "退回", "编制 / 修订", "删除"]) assert.ok(await page.getByRole("menuitem", { name: label, exact: true }).isDisabled());
  assert.deepEqual(errors, []);
  console.log("ROW_ACTIONS_BROWSER_OK 8 layouts, cancel, state priority and viewer restrictions");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
