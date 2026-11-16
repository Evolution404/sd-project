import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const f = approvedFixture({ after: action => cleanup.push(action) });
const tower = f.save("physical", { asset_no: "变更候选浏览器验收" });
const candidate = f.s.demands.save(f.user, {
  operation_id: f.operation.id, expected_on: "2027-02-28", problem_description: "正式变更新增需求",
  work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
  sources: [{ description: "隔离浏览器业务验收" }],
});
f.s.demands.transition(f.user, candidate.id, { expected_version: 1, expected_event_seq: 1, status: "active" });
const server = httpServer(f.s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const out = join(process.cwd(), "test-results/schema113/project-lifecycle-integrity");
mkdirSync(out, { recursive: true });
async function confirm() {
  await page.locator(".el-message-box:visible .el-button--primary").click();
  await page.locator(".el-message-box:visible").waitFor({ state: "hidden" });
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/projects?project=${f.project.id}&tab=scope`);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const workspace = page.locator(".business-detail-dialog:visible");
  await workspace.waitFor();
  await workspace.getByRole("tab", { name: "需求与范围", exact: true }).click();
  assert.equal(await workspace.getByRole("button", { name: "关联需求", exact: true }).isDisabled(), true);
  await workspace.getByRole("tab", { name: "批准与变更", exact: true }).click();
  await workspace.getByRole("button", { name: "编制正式变更", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编制完整批准范围" });
  await editor.getByRole("button", { name: "新增候选需求", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择变更新增需求" });
  await picker.getByLabel("选择需求：" + candidate.demand_no).check();
  await picker.getByRole("button", { name: "加入变更草稿（1）", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await editor.locator("label.el-checkbox").filter({ hasText: f.demand.demand_no }).click();
  assert.equal(await editor.getByRole("checkbox", { name: f.demand.demand_no, exact: true }).isChecked(), false);
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await confirm();
  await editor.waitFor({ state: "hidden" });
  assert.equal(f.s.demands.get(candidate.id).binding, null);
  assert.equal(f.s.projects.get(f.project.id).approval.id, f.approval.id);
  await workspace.getByRole("heading", { name: "新增候选需求", exact: true }).waitFor();
  await workspace.getByRole("button", { name: "正式批准", exact: true }).click();
  await confirm();
  await page.getByText("确认正式批准成功，正在刷新业务状态", { exact: true }).waitFor();
  assert.equal(f.s.demands.get(candidate.id).binding.project_id, f.project.id);
  assert.equal(f.s.demands.get(f.demand.id).binding, null);
  const approved = f.s.projects.get(f.project.id);
  assert.equal(approved.approvals.find(ap => ap.id === f.approval.id).scopes.length, 1);
  f.s.finance.close(f.user, approved.id, { expected_version: approved.version });
  await page.reload();
  await workspace.waitFor();
  await workspace.getByRole("tab", { name: "费用与结算", exact: true }).click();
  await workspace.getByText("项目已结项，普通费用、科目、结算及核对写入已冻结", { exact: true }).waitFor();
  for (const name of ["新增科目", "核定费用", "编制结算", "新增核对", "上传并预检"]) {
    const button = workspace.getByRole("button", { name, exact: true });
    if (await button.count()) assert.equal(await button.isDisabled(), true, name);
  }
  await workspace.screenshot({ path: join(out, "结项财务冻结.png") });
  assert.deepEqual(errors, []);
  console.log("PROJECT_LIFECYCLE_INTEGRITY_BROWSER_OK candidate proposal, atomic add/release, frozen closed finance and immutable history");
} catch (error) {
  await page.screenshot({path:join(out,"failure.png")});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
