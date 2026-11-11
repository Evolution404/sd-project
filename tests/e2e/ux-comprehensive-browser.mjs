import {inspect} from "../inspector.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, operation } = fixture({ after: fn => cleanup.push(fn) });
const voltage = save("voltages", { name: "220kV" });
save("lines", { name: "体验审计线路", voltage_level_id: voltage.id });
const framework = save("frameworks", {
  name: "交互测试框架", fiscal_year: 2026, limit_fen: 500000,
});
const existingProject = s.projects.save(user, {
  name: "交互保护测试项目", framework_id: framework.id,
});
s.auth.saveUser(user, {
  username: "ux_readonly", password: "viewerReadOnly123",
  role: "viewer", status: "active",
});
const factor = save("factors", {
  name: "现场施工难度",
  fields_json: { kind: "enum", values: ["普通", "困难"] },
});
s.catalog.save(user, "operations", {
  expected_version: 1,
  pricing_features_json: [
    { factor_id: factor.id, factor_version: 1, source: "manual", required: false },
  ],
}, operation.id);
const oldRule = save("prices", {
  title: "需要停用的历史参考价",
  operation_id: operation.id,
  pricing_mode: "fixed",
  unit_price_fen: 3200,
  price_source: "2026年工程价格依据",
  price_date: "2026-01-01",
  effective_on: "2026-01-01",
  basis: "现场定额核验",
  additional_conditions_json: {
    [factor.code]: { factor_version: 1, op: "eq", value: "普通" },
  },
});
s.catalog.save(user, "factors", {
  name: "新版施工难度", expected_version: 1,
}, factor.id);
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 960, height: 860 } });
const errors = [];
page.on("pageerror", err => errors.push(err.message));
const out = join(process.cwd(), "test-results/schema113/ux-comprehensive");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:" + server.address().port;
const editor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
try {
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(base + "/#/pricing/prices");
  await page.getByRole("row").filter({ hasText: oldRule.title }).waitFor();
  assert.ok(await page.getByRole("row").filter({ hasText: oldRule.title })
    .getByText("安装防鸟装置").count(), "operation reference must show the readable name");
  const priceRow = page.getByRole("row").filter({ hasText: oldRule.title });
  await priceRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).last().click();
  await editor.getByLabel("价格来源", { exact: true }).waitFor();
  assert.equal(await editor.getByLabel("价格来源", { exact: true }).inputValue(), "2026年工程价格依据");
  assert.equal(await editor.getByLabel("计价依据", { exact: true }).inputValue(), "现场定额核验");
  assert.equal(await editor.getByLabel("价格日期", { exact: true }).inputValue(), "2026-01-01");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "hidden" });

  // Modifying a draft cannot be lost through Cancel or the dialog close icon.
  await priceRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).last().click();
  await editor.getByLabel("规则名称", { exact: true }).fill("临时调整但不保存");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放弃未保存的修改？" });
  await discard.waitFor();
  await discard.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(await editor.getByLabel("规则名称", { exact: true }).inputValue(), "临时调整但不保存");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await discard.getByRole("button", { name: "放弃修改" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.catalog.get("prices", oldRule.id).title, oldRule.title);

  // A status-only retirement is possible after the feature version advances.
  await priceRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "停用", exact: true }).last().click();
  await page.getByRole("button", { name: "确认停用", exact: true }).click();
  await page.getByRole("row").filter({ hasText: oldRule.title }).getByText("停用", { exact: true }).waitFor();
  const stopped = s.catalog.get("prices", oldRule.id);
  assert.equal(stopped.status, "inactive");
  assert.equal(stopped.version_no, 2);
  assert.equal(stopped.additional_conditions_json, oldRule.additional_conditions_json);
  assert.equal(s.catalog.history("prices", oldRule.id).length, 2);
  await page.screenshot({ path: join(out, "inactive-price-960.png"), fullPage: true });
  // Saving on another tab must locate a required error in its correct tab.
  await page.getByRole("button", { name: "新增参考价格规则", exact: true }).click();
  await editor.getByRole("tab", { name: "计价方式" }).click();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByRole("tab", { name: "基本信息" }).getAttribute("aria-selected")
    .then(value => assert.equal(value, "true"));
  await editor.getByText("请填写规则名称").waitFor();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "hidden" });


  // A long table must tell the user how to clear filters with one action.
  await page.goto(base + "/#/ledger/lines");
  await page.getByRole("columnheader", { name: /线路名称/ }).waitFor();
  await page.getByRole("button", { name: "筛选线路名称" }).click();
  const filter = page.getByPlaceholder("筛选线路名称");
  await filter.fill("必然不存在的线路");
  await filter.press("Enter");
  await page.getByText("没有符合筛选条件的记录").waitFor();
  await page.getByRole("button", { name: /已筛选 1 列 · 清除/ }).click();
  await page.getByRole("cell", { name: "体验审计线路", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /已筛选 1 列 · 清除/ }).count(), 0);

  // System management requires inline validation and an unsaved draft guard.
  await page.goto(base + "/#/system/users");
  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.getByText("请填写用户名", { exact: false }).waitFor();
  await editor.getByLabel("用户名", { exact: true }).fill("预览用户");
  await editor.getByLabel("初始密码", { exact: true }).fill("temporaryPassword123");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByRole("button", { name: "放弃修改" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(inspect(s).list("users").some(row => row.username === "预览用户"), false);
  await page.screenshot({ path: join(out, "system-960.png"), fullPage: true });
  // Demand, project and finance editors share the exact same exit decision.
  await page.goto(base + "/#/demands");
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await editor.getByLabel("问题描述", { exact: true }).fill("尚未提交的巡检描述");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByRole("button", { name: "放弃修改" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.demands.list().some(row => row.problem_description === "尚未提交的巡检描述"), false);

  await page.goto(base + "/#/projects");
  await page.getByRole("button", { name: "新增子项目", exact: true }).click();
  await editor.getByLabel("项目名称", { exact: true }).fill("临时新增项目");
  await editor.locator(".el-dialog__headerbtn").click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByRole("button", { name: "放弃修改" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.projects.list().some(row => row.name === "临时新增项目"), false);

  await page.goto(base + "/#/finance");
  assert.ok(await page.getByRole("radio", { name: "按项目办理" }).isChecked(),
    "finance opens in project-first workflow mode");
  await page.getByRole("row").filter({ hasText: existingProject.name })
    .getByRole("button", { name: "进入项目办理" }).click();
  const projectDetail = page.locator(".business-detail-dialog:visible");
  await projectDetail.getByRole("tab", { name: "费用与结算" }).click();
  await projectDetail.getByRole("button", { name: "新增科目" }).click();
  await editor.getByLabel("名称", { exact: true }).fill("尚未保存的费用科目");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByRole("button", { name: "放弃修改" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.projects.get(existingProject.id).cost_nodes.some(
    row => row.name === "尚未保存的费用科目"), false);
  await page.screenshot({ path: join(out, "finance-960.png"), fullPage: true });
  // A read-only account must see non-actionable system controls.
  const reader = await browser.newPage({ viewport: { width: 960, height: 860 } });
  try {
    await reader.goto(base);
    await reader.getByLabel("用户名", { exact: true }).fill("ux_readonly");
    await reader.getByLabel("密码", { exact: true }).fill("viewerReadOnly123");
    await reader.getByRole("button", { name: "登录", exact: true }).click();
    await reader.getByRole("heading", { name: "工作台" }).waitFor();
    assert.equal(await reader.getByRole("menuitem", { name: "系统管理" }).count(), 0);
    await reader.goto(base + "/#/system/users");
    await reader.waitForURL(/#\/dashboard$/, { timeout: 10000 });
    assert.equal(await reader.getByRole("button", { name: "新增用户" }).count(), 0);
  } finally {
    await reader.close();
  }


  assert.deepEqual(errors, []);
  console.log("UX_COMPREHENSIVE_BROWSER_OK price lifecycle, restored reference labels/source, cross-tab validation, table filters, system/demand/project/finance draft safety, readonly permissions");
} catch (error) {
  console.log("UX_COMPREHENSIVE_BROWSER_ERRORS", errors);
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const fn of cleanup.reverse()) await fn();
}
