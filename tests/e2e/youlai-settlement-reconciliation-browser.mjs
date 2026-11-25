import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, project, node } = approvedFixture({ after: done => cleanup.push(done) });
const otherCategory = s.finance.node(user, project.id, { name: "其他费用科目" });
function addCost(title, category = node) {
  return s.finance.cost(user, project.id, {
    cost_node_id: category.id, title, amount_fen: 10000, occurred_on: "2026-11-23", evidence: "合成专用凭证",
  });
}
const costs = Array.from({ length: 35 }, (_, index) => addCost("可核对实际费用 " + String(index).padStart(2, "0")));
addCost("不属于同一科目的费用", otherCategory);
const archived = addCost("已删除实际费用");
s.finance.removeCost(user, project.id, archived.entry_id, { expected_version: 1 });
function approvedSettlement(evidence) {
  const draft = s.finance.saveDraft(user, project.id, {
    mode: "itemized", items: [{ cost_node_id: node.id, amount_fen: 15000, evidence }],
  });
  s.finance.submit(user, draft.id, { expected_version: 0, expected_edit_version: 1 });
  s.finance.review(user, draft.id, { expected_version: 1, expected_event_seq: 1, action: "approve" });
  return s.finance.settlement(draft.id);
}
const selected = approvedSettlement("目标结算凭据");
const unrelated = approvedSettlement("另一笔结算凭据");
for (let index = 0; index < 33; index++) approvedSettlement("跨页结算凭据 " + index);
s.finance.reconciliation(user, {
  cost_version_id: costs[0].id, settlement_item_version_id: unrelated.items[0].id,
  reconciled_cost_fen: 1000, reconciled_settlement_fen: 1000, expected_version: 0, evidence: "另一结算核对证据",
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
async function openFinance(browserPage) {
  await browserPage.goto(origin + "/#/login");
  await browserPage.getByPlaceholder("用户名").fill("admin");
  await browserPage.getByPlaceholder("密码").fill("Schema113-test-password");
  await button(browserPage, "登录").click();
  await browserPage.waitForURL(/#\/dashboard/);
  await browserPage.goto(origin + "/#/funding/finance?project=" + project.id);
}
try {
  await openFinance(page);
  await page.getByRole("tab", { name: "结算单", exact: true }).waitFor();
  const billSearch = page.getByPlaceholder("结算编号 / 项目名称 / 项目编号");
  await billSearch.fill(selected.number);
  await billSearch.press("Enter");
  const selectedRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: selected.number, exact: true }) });
  await button(selectedRow, "查看详情").click();
  const details = page.getByRole("dialog", { name: "结算正式事实及草稿", exact: true });
  await details.getByText("目标结算凭据", { exact: true }).waitFor();
  await button(details, "逐笔对账").click();
  const scoped = page.getByRole("dialog", { name: "结算逐笔对账", exact: true });
  await scoped.getByText(selected.number, { exact: true }).waitFor();
  assert.equal(await scoped.getByText("另一结算核对证据").count(), 0);
  await button(scoped, "新增正式核对").click();
  const form = page.getByRole("dialog", { name: "核对实际费用与结算明细", exact: true });
  assert.equal(await button(form, "选择实际费用").isDisabled(), true);
  await button(form, "选择生效结算明细").click();
  const items = page.getByRole("dialog", { name: "选择生效结算明细", exact: true });
  const itemRow = items.getByRole("row").filter({ has: page.getByRole("cell", { name: selected.number, exact: true }) });
  await itemRow.waitFor();
  assert.equal(await items.getByRole("cell", { name: unrelated.number, exact: true }).count(), 0);
  await button(itemRow, "选择").click();
  await button(items, "确认选择（1）").click();
  await button(form, "选择实际费用").click();
  const picker = page.getByRole("dialog", { name: "选择实际费用", exact: true });
  await picker.getByText("共 35 条", { exact: true }).waitFor();
  assert.equal(await picker.getByText("不属于同一科目的费用", { exact: true }).count(), 0);
  assert.equal(await picker.getByText("已删除实际费用", { exact: true }).count(), 0);
  const next = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/costs") &&
    new URL(response.url()).searchParams.get("page") === "2");
  await picker.locator(".el-pagination .btn-next").click();
  const secondPage = await (await next).json();
  assert.equal(secondPage.items.length, 15);
  const cost = secondPage.items[0];
  assert.ok(costs.some(row => row.id === cost.id));
  const costRow = picker.getByRole("row").filter({ has: page.getByRole("cell", { name: cost.title, exact: true }) });
  await button(costRow, "选择").click();
  await button(picker, "确认费用（1）").click();
  await form.getByRole("textbox", { name: "核对实际费用（元）" }).fill("10");
  await form.getByRole("textbox", { name: "核对结算金额（元）" }).fill("10");
  await form.getByRole("textbox", { name: "核对依据" }).fill("目标结算跨页核对证据");
  await button(form, "保存核对").click();
  await form.waitFor({ state: "hidden" });
  await scoped.getByText("目标结算跨页核对证据", { exact: true }).waitFor();
  assert.equal(await scoped.getByText("另一结算核对证据").count(), 0);
  const persisted = s.finance.reconciliations(project.id).find(row => row.evidence === "目标结算跨页核对证据");
  assert.deepEqual([persisted.cost_version_id, persisted.settlement_item_version_id], [cost.id, selected.items[0].id]);
  await page.screenshot({ path: join(screenshots, "settlement-scoped-reconciliation-1920-light.png"), animations: "disabled" });
  await button(scoped, "返回结算详情").click();
  await details.getByText("目标结算凭据", { exact: true }).waitFor();
  await details.locator(".el-drawer__close-btn").click();
  await details.waitFor({ state: "hidden" });

  await page.getByRole("tab", { name: "费用科目、费用及核对", exact: true }).click();
  const costSearch = page.getByPlaceholder("费用事项、发票号或费用科目");
  await costSearch.fill(cost.title);
  await costSearch.press("Enter");
  const focusedCost = page.getByRole("row").filter({ has: page.getByRole("cell", { name: cost.title, exact: true }) });
  await button(focusedCost, "费用核对").click();
  await button(form, "选择生效结算明细").click();
  await items.getByText("共 35 条", { exact: true }).waitFor();
  const nextBills = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reconciliation-items") &&
    new URL(response.url()).searchParams.get("page") === "2");
  await items.locator(".el-pagination .btn-next").click();
  const secondBillPage = await (await nextBills).json();
  assert.equal(secondBillPage.items.length, 15);
  const differentBill = secondBillPage.items.find(row => row.settlement_id !== selected.id);
  assert.ok(differentBill);
  const differentBillRow = items.getByRole("row").filter({ has: page.getByRole("cell", { name: differentBill.number, exact: true }) });
  await button(differentBillRow, "选择").click();
  await button(items, "确认选择（1）").click();
  await form.getByRole("textbox", { name: "核对实际费用（元）" }).fill("10");
  await form.getByRole("textbox", { name: "核对结算金额（元）" }).fill("10");
  await form.getByRole("textbox", { name: "核对依据" }).fill("实际费用起始的跨页核对");
  await button(form, "保存核对").click();
  await page.getByText("实际费用起始的跨页核对", { exact: true }).waitFor();
  const portfolio = s.finance.reconciliations(project.id).find(row => row.evidence === "实际费用起始的跨页核对");
  assert.deepEqual([portfolio.cost_version_id, portfolio.settlement_item_version_id], [cost.id, differentBill.id]);
  const dark = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  dark.on("pageerror", error => errors.push(error.message));
  await openFinance(dark);
  await dark.waitForFunction(() => document.documentElement.classList.contains("dark"));
  const filter = dark.getByPlaceholder("结算编号 / 项目名称 / 项目编号");
  await filter.fill(selected.number);
  await filter.press("Enter");
  const darkRow = dark.getByRole("row").filter({ has: dark.getByRole("cell", { name: selected.number, exact: true }) });
  await button(darkRow, "查看详情").click();
  await button(dark.getByRole("dialog", { name: "结算正式事实及草稿", exact: true }), "逐笔对账").click();
  const darkDrawer = dark.getByRole("dialog", { name: "结算逐笔对账", exact: true });
  await darkDrawer.getByText("目标结算跨页核对证据", { exact: true }).waitFor();
  assert.equal(await darkDrawer.getByText("实际费用起始的跨页核对", { exact: true }).count(), 0);
  await dark.screenshot({ path: join(screenshots, "settlement-scoped-reconciliation-1920-dark.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("YOULAI_SCOPED_RECONCILIATION_OK independent bill scope, 35 matching costs and 35 approved settlements, stable cross-page selection in both directions");
} catch (error) {
  await page.screenshot({ path: join(screenshots, "settlement-scoped-reconciliation-failure.png") }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.shutdown(done));
  for (const done of cleanup.reverse()) await done();
}
