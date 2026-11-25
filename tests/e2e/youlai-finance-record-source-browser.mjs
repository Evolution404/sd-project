import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, project, framework, node, scope, towers } = approvedFixture({ after: done => cleanup.push(done) });
const otherProject = s.projects.save(user, { name: "跨项目归属验收", framework_id: framework.id });
const original = s.finance.saveDraft(user, project.id, {
  mode: "itemized",
  items: [{ cost_node_id: node.id, amount_fen: 10800, evidence: "第一笔正式结算依据" }],
  resolutions: [{ project_scope_id: scope.id, location_item_no: 1, resolved_quantity_scaled: 10000, evidence: "首笔位置完成依据" }],
});
s.finance.submit(user, original.id, { expected_version: 0, expected_edit_version: 1 });
s.finance.review(user, original.id, { expected_version: 1, expected_event_seq: 1, action: "approve" });
// Changing the current equipment master must not rewrite the adopted approval location.
s.catalog.save(user, "physical", { expected_version: towers[0].version, asset_no: "T15-修订后" }, towers[0].id);
const draft = s.finance.saveDraft(user, project.id, {
  mode: "project_total", amount_fen: 16600, basis: "第二笔单独保存的草稿",
});
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const origin = "http://127.0.0.1:" + server.address().port;
const screenshots = resolve("test-results/youlai-y4");
mkdirSync(screenshots, { recursive: true });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const bill = number => page.getByRole("row").filter({ has: page.getByRole("cell", { name: number, exact: true }) });
const details = page.getByRole("dialog", { name: "结算正式事实及草稿", exact: true });
async function close(drawer) {
  await drawer.locator(".el-drawer__close-btn").click();
  await drawer.waitFor({ state: "hidden" });
}
try {
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await button(page, "登录").click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/funding/finance?view=settlements");
  const amount = page.getByPlaceholder("输入本次金额");
  await amount.fill("¥166.00");
  await amount.press("Enter");
  await page.waitForURL(url => url.hash.includes("_list="));
  const portfolio = page.url();
  assert.equal(await bill(original.number).count(), 0);
  await button(bill(draft.number), "查看详情").click();
  await details.getByText(draft.number, { exact: true }).waitFor();
  await details.getByText("¥166.00", { exact: true }).waitFor();
  assert.equal(await details.getByText("审核中", { exact: true }).count(), 0);
  assert.equal(page.url(), portfolio);
  await button(details, "查看所属项目").click();
  await page.waitForURL(url => url.hash.includes("project=" + project.id) && url.hash.includes("record=" + draft.id));
  await details.getByText(draft.number, { exact: true }).waitFor();
  await details.getByText("¥166.00", { exact: true }).waitFor();
  const invalidOwner = await page.request.get(origin + "/api/projects/" + otherProject.id + "/settlements/" + draft.id);
  assert.equal(invalidOwner.status(), 404, await invalidOwner.text());
  await button(details, "返回跨项目结算").click();
  await page.waitForURL(url => url.href === portfolio);
  await details.getByText(draft.number, { exact: true }).waitFor();
  assert.equal(await amount.inputValue(), "¥166.00");
  assert.equal(await bill(original.number).count(), 0);
  await close(details);
  await page.reload();
  await bill(draft.number).waitFor();
  assert.equal(await amount.inputValue(), "¥166.00");
  assert.equal(await details.isVisible(), false);
  await button(page, "重置").click();
  await button(bill(original.number), "查看详情").click();
  await details.getByRole("cell", { name: "套", exact: true }).waitFor();
  await details.getByRole("cell", { name: "首笔位置完成依据", exact: true }).waitFor();
  await details.getByRole("columnheader", { name: "物理杆塔铭牌", exact: true }).waitFor();
  await details.getByRole("cell", { name: "T15", exact: true }).waitFor();
  assert.equal(await details.getByRole("cell", { name: "T15-修订后", exact: true }).count(), 0);
  await details.getByRole("columnheader", { name: "费用科目", exact: true }).waitFor();
  await button(details, "重新读取结算").click();
  await details.getByText("¥108.00", { exact: true }).first().waitFor();
  await button(details, "查看正式历史").click();
  const history = page.getByRole("dialog", { name: "结算正式历史", exact: true });
  await history.getByRole("heading", { name: "结算单 " + original.number, exact: true }).waitFor();
  assert.equal(await history.getByRole("heading", { name: "结算单 " + draft.number, exact: true }).count(), 0);
  await page.screenshot({ path: join(screenshots, "portfolio-direct-settlement-history-1920.png"), animations: "disabled" });
  await button(history, "返回结算详情").click();
  await details.getByText(original.number, { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("YOULAI_FINANCE_RECORD_SOURCE_OK exact yuan filtering, project ownership, restored source drawer and selected immutable history");
} catch (error) {
  await page.screenshot({ path: join(screenshots, "portfolio-direct-settlement-failure-1920.png") }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.shutdown(done));
  for (const done of cleanup.reverse()) await done();
}
