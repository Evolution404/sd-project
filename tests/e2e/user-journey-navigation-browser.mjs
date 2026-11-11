import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, project, framework, demandInput } = approvedFixture({ after: action => cleanup.push(action) });
function newDemand(no, assetNo) {
  const tower = save("physical", { asset_no: assetNo, tower_type: "angle" });
  return s.demands.save(user, {
    ...demandInput, demand_no: no, problem_description: "新发现的" + no + "问题",
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
  });
}
const waiting = newDemand("BROWSER-PENDING", "T88");
const another = newDemand("BROWSER-TO-CREATE", "T89");
s.demands.transition(user, another.id, {
  expected_version: another.current_version, expected_event_seq: 1, status: "active",
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const output = join(process.cwd(), "test-results/schema113/user-journey");
mkdirSync(output, { recursive: true });
const base = `http://127.0.0.1:${server.address().port}`;
const detail = page.locator(".business-detail-dialog:visible");
const editor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
try {
  await page.goto(base + "/#/demands?demand=" + waiting.id);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await detail.getByText(waiting.demand_no).waitFor();
  assert.ok(await detail.getByRole("button", { name: "确认需求有效", exact: true }).isVisible());
  await page.screenshot({ path: join(output, "demand-pending.png") });
  await detail.getByRole("button", { name: "确认需求有效" }).click();
  await page.locator(".el-message-box:visible .el-button--primary").click();
  await detail.getByRole("button", { name: "关联子项目", exact: true }).waitFor();
  await detail.getByRole("button", { name: "关联子项目", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择子项目承接需求" });
  await picker.getByRole("row").filter({ hasText: project.name })
    .getByRole("button", { name: "选择", exact: true }).click();
  await picker.getByRole("button", { name: "承接该需求" }).click();
  await detail.getByRole("button", { name: "进入承接项目", exact: true }).waitFor();
  assert.equal(s.demands.get(waiting.id).binding.project_id, project.id);
  await detail.getByRole("button", { name: "进入承接项目" }).click();
  await page.waitForURL(url => url.hash.includes("#/projects") && url.hash.includes("focus=demand"));
  await detail.getByRole("heading", { name: project.name, exact: true }).waitFor();
  await page.getByRole("tab", { name: "需求与范围" }).waitFor();
  await page.getByRole("tab", { name: "需求与范围" }).click();
  await detail.getByText("当前定位").waitFor();
  await page.screenshot({ path: join(output, "project-linked-scope.png") });

  // A second active demand starts another project and links atomically.
  await page.goto(base + "/#/demands?demand=" + another.id);
  await detail.getByRole("button", { name: "关联子项目" }).waitFor();
  await detail.getByRole("button", { name: "关联子项目" }).click();
  await page.getByRole("dialog", { name: "选择子项目承接需求" })
    .getByRole("button", { name: "创建子项目并承接" }).click();
  await page.waitForURL(url => url.hash.includes("action=create") && url.hash.includes("demand="));
  await editor.getByText(another.demand_no, { exact: false }).waitFor();
  await editor.getByLabel("项目名称", { exact: true }).fill("旅程新建并承接项目");
  await editor.getByLabel("年度框架", { exact: true }).click();
  await page.getByRole("option", { name: new RegExp(framework.name) }).first().click();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await detail.getByRole("heading", { name: "旅程新建并承接项目", exact: true }).waitFor();
  const created = s.projects.list().find(p => p.name === "旅程新建并承接项目");
  assert.ok(created);
  assert.equal(created.scopes.filter(scope => scope.binding).length, 1);
  assert.equal(s.demands.get(another.id).binding.project_id, created.id);
  assert.equal(await detail.getByRole("tab").count(), 5);
  await page.screenshot({ path: join(output, "project-created-and-linked.png") });
  assert.deepEqual(errors, []);
  console.log("USER_JOURNEY_NAVIGATION_OK pending=>confirmed=>linked=>context, create+link atomic, 5-section project workspace");
} catch (e) {
  console.error("JOURNEY_FAILURE", page.url(), errors);
  await page.screenshot({ path: join(output, "failure.png") });
  throw e;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
