import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import {
  settlementCanvas, selectSettlementCell, enterSettlementQuantity,
  pasteSettlementCells, copySettlementSelection,
} from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, user, save, demandInput } = fixture({ after: fn => cleanup.push(fn) });
const positions = [
  ...demandInput.work_locations.map(position => ({ ...position, quantity_scaled: 10000 })),
  ...Array.from({ length: 17 }, (_, i) => ({
    location_kind: "physical_tower",
    physical_tower_id: save("physical", { asset_no: "PROBE-T" + (i + 20), tower_material: "angle" }).id,
    quantity_scaled: 10000,
  })),
];
const demand = s.demands.save(user, { ...demandInput, work_locations: positions });
s.demands.transition(user, demand.id, { expected_version: 1, expected_event_seq: 1, status: "active" });
const framework = save("frameworks", { fiscal_year: 2026, name: "专项验收框架", limit_fen: 100000 });
let project = s.projects.save(user, { name: "专项验收项目", framework_id: framework.id });
project = s.projects.link(user, project.id, { demand_id: demand.id, expected_version: 1 });
project = s.projects.stock(user, project.id, { expected_version: 1 });
project = s.projects.approvalDraft(user, project.id, {
  expected_version: 2, approved_budget_fen: 120000,
  scopes: [{
    project_scope_id: project.scopes[0].id, demand_version: 1,
    locations: demand.work_locations.map((loc, i) => ({
      location_item_no: i + 1, approved_quantity_scaled: loc.quantity_scaled,
    })),
  }],
});
project = s.projects.approve(user, project.id, project.approvals[0].id, { expected_version: 2 });

const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = "http://127.0.0.1:" + server.address().port;
const out = resolve("test-results/youlai-settlement-worksheet");
mkdirSync(out, { recursive: true });
let browser, page;
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(url => url.hash.startsWith("#/dashboard"));
  await page.goto(base + "/#/funding/finance");
  await page.evaluate(() => {
    window.__worksheetDoubleLoading = false;
    const watch = new MutationObserver(() => {
      const worksheet = document.querySelector(".settlement-worksheet");
      const skeleton = worksheet?.querySelector(".el-skeleton");
      const canvas = worksheet?.querySelector("canvas");
      if (skeleton?.getBoundingClientRect().height && canvas?.getBoundingClientRect().height)
        window.__worksheetDoubleLoading = true;
    });
    watch.observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:["class","style"]});
  });
  await page.getByRole("button", { name: "新增结算草稿" }).click();
  await page.getByRole("row").filter({ hasText: "专项验收项目" })
    .getByRole("button", { name: "选择项目" }).click();
  const editor = page.getByRole("region", { name: "编制结算草稿" });
  const grid = await settlementCanvas(editor);
  assert.equal(await page.evaluate(() => window.__worksheetDoubleLoading), false, "loading skeleton and actual sheet must never coexist");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await selectSettlementCell(grid, 1, 3);
  assert.equal((await copySettlementSelection(page)).trim(), "1");
  await page.keyboard.press("Escape");
  const raw = Array.from({ length: 20 }, (_, i) => i === 0 ? "2" : i === 1 ? "0.5" : i === 15 ? "oops" : "1");
  await selectSettlementCell(grid, 1);
  await pasteSettlementCells(page, raw.map((quantity, i) => quantity + "\t依据" + (i + 1)).join("\n"));
  await editor.getByTestId("settlement-filled-count").locator("strong").getByText("20", { exact: true }).waitFor();
  await editor.getByPlaceholder("如 1200.00").fill("500.00");
  await editor.getByPlaceholder("请填写本次结算依据").fill("专项验收");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  const panel = editor.getByRole("alert").filter({ hasText: "请修正 3 个数量单元格后保存" });
  await panel.getByRole("button", { name: "E2（T15）" }).waitFor();
  await panel.getByText("超出批准余量 1 套").waitFor();
  await panel.getByRole("button", { name: "E3（T16）" }).waitFor();
  await panel.getByText("单位为套，请填写整数").waitFor();
  await panel.getByRole("button", { name: "E17（PROBE-T32）" }).waitFor();
  await panel.getByText("请填写有效的非负数量").waitFor();
  assert.equal(s.finance.allSettlements().length, 0);
  await page.screenshot({ path: join(out, "invalid-1920.png") });

  async function fixViaIssue(region, name, location, value, screenshot) {
    await region.getByRole("button", { name, exact: true }).click();
    await region.locator(".settlement-work-status").getByText(new RegExp(location + ".*批准余量")).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[contenteditable][data-u-comp="editor"]')), true,
      "validation link must return keyboard focus to the Univer editor");
    if (screenshot) await page.screenshot({ path: join(out, screenshot) });
    await page.keyboard.press(value);
    await page.keyboard.press("Enter");
  }
  await fixViaIssue(editor, "E17（PROBE-T32）", "PROBE-T32", "1", "located-1920.png");
  await editor.getByText("请修正 2 个数量单元格后保存", { exact: true }).waitFor();
  await fixViaIssue(editor, "E3（T16）", "T16", "1");
  await editor.getByText("请修正 1 个数量单元格后保存", { exact: true }).waitFor();

  const workspace = page.locator(".layout-content");
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  assert.ok(box);
  const x = box.x + Math.min(box.width - 20, 550), y = Math.max(box.y + 85, 100);
  const before = await workspace.evaluate(node => node.scrollTop);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 2200);
  await page.mouse.wheel(0, 2200);
  await page.mouse.click(x, y);
  await editor.locator(".settlement-work-status").getByText(/PROBE-T/).waitFor();
  assert.equal(await workspace.evaluate(node => node.scrollTop), before, "bottom edge must not scroll page");
  await page.mouse.wheel(0, -2200);
  await page.mouse.wheel(0, -2200);
  await page.mouse.click(x, y);
  await editor.locator(".settlement-work-status").getByText(/T15.*批准余量为 1 套.*超出 1 套/).waitFor();
  assert.equal(await workspace.evaluate(node => node.scrollTop), before, "top edge must not scroll page");
  await page.screenshot({ path: join(out, "excess-cell-1920.png") });
  await page.mouse.move(box.x - 8, y);
  await page.mouse.wheel(0, before > 0 ? -350 : 350);
  await page.waitForFunction(value => document.querySelector(".layout-content").scrollTop !== value, before);
  await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  await editor.getByText("超出批准余量 1 套").waitFor();
  assert.equal(s.finance.allSettlements().length, 0);
  assert.equal(await page.getByRole("dialog", { name: "提交结算审核" }).count(), 0);
  await fixViaIssue(editor, "E2（T15）", "T15", "1");
  await editor.locator(".settlement-work-validation").waitFor({ state: "hidden" });
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const bill = s.finance.allSettlements()[0];
  assert.equal(bill.draft.document.resolutions.length, 20);
  assert.deepEqual(bill.draft.document.resolutions.map(row => row.resolved_quantity_scaled), Array(20).fill(10000));
  assert.deepEqual(bill.draft.document.resolutions.map(row => row.evidence), Array.from({ length: 20 }, (_, i) => "依据" + (i + 1)));
  await page.screenshot({ path: join(out, "corrected-saved-1920.png") });
  console.log("YOULAI_SETTLEMENT_CREATE_OK 20 rows, three errors, keyboard correction, 1920px wheel boundaries, excess blocked");

  await page.getByRole("row").filter({ hasText: bill.number }).getByRole("button", { name: "编辑草稿" }).click();
  await settlementCanvas(editor);
  assert.equal(await editor.getByPlaceholder("如 1200.00").inputValue(), "500.00");
  await editor.getByRole("button", { name: "提交审核", exact: true }).click();
  await page.getByRole("dialog", { name: "提交结算审核" }).getByRole("button", { name: "确认提交" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(s.finance.settlement(bill.id).review.action, "submit");
  assert.equal(s.finance.settlement(bill.id).draft, null);
  assert.equal(s.finance.allSettlements().length, 1);
  const submittedRow = page.getByRole("row").filter({ hasText: bill.number });
  await submittedRow.getByText("审核中", { exact: true }).waitFor();
  assert.equal(await submittedRow.getByRole("button", { name: "编辑草稿" }).count(), 0);
  await submittedRow.getByRole("button", { name: "查看详情" }).click();
  await page.getByRole("dialog", { name: "结算正式事实及草稿" })
    .getByRole("button", { name: "进入结算审核办理" }).click();
  const review = page.getByRole("region", { name: "结算审核办理" });
  await review.getByRole("button", { name: "审核通过" }).click();
  await page.getByRole("dialog", { name: "审核结算" }).getByRole("button", { name: "确定" }).click();
  await review.getByRole("button", { name: "编制修订", exact: true }).waitFor();
  const original = s.finance.settlement(bill.id);
  assert.equal(original.effective_amount_fen, 50000);
  await review.getByRole("button", { name: "编制修订", exact: true }).click();
  const revision = page.getByRole("region", { name: "编制结算修订" });
  const revisionGrid = await settlementCanvas(revision);
  await selectSettlementCell(revisionGrid, 1);
  assert.equal((await copySettlementSelection(page)).trim(), "1");
  await page.keyboard.press("Escape");
  await enterSettlementQuantity(page, revisionGrid, 2, "0.5");
  await revision.getByPlaceholder("如 1200.00").fill("510.00");
  await revision.getByRole("textbox", { name: "修订说明" }).fill("专项验收修订");
  await revision.getByRole("button", { name: "保存草稿", exact: true }).click();
  await revision.getByText("单位为套，请填写整数").waitFor();
  assert.equal(s.finance.settlement(bill.id).draft, null);
  await fixViaIssue(revision, "E3（T16）", "T16", "1", "revision-located-1920.png");
  await revision.locator(".settlement-work-validation").waitFor({ state: "hidden" });
  await revision.getByRole("button", { name: "提交审核", exact: true }).click();
  await page.getByRole("dialog", { name: "提交结算审核" }).getByRole("button", { name: "确认提交" }).click();
  await revision.waitFor({ state: "hidden" });
  const revised = s.finance.settlement(bill.id);
  assert.equal(revised.version.amount_fen, 51000);
  assert.equal(revised.resolutions.length, 20);
  assert.equal(revised.version.previous_version_id, original.version.id);
  assert.equal(revised.review.action, "submit");
  assert.equal(revised.draft, null);
  assert.equal(revised.effective_amount_fen, 50000);

  // Direct submit a new fee-only settlement, without any prior draft identity.
  await page.getByRole("button", {name:"新增结算草稿"}).click();
  await page.getByRole("row").filter({hasText:"专项验收项目"}).getByRole("button",{name:"选择项目"}).click();
  await settlementCanvas(editor);
  await editor.getByPlaceholder("如 1200.00").fill("20.00");
  await editor.getByPlaceholder("请填写本次结算依据").fill("直接提交费用结算");
  await editor.getByRole("button",{name:"提交审核",exact:true}).click();
  await page.getByRole("dialog",{name:"提交结算审核"}).getByRole("button",{name:"确认提交"}).click();
  await editor.waitFor({state:"hidden"});
  const fresh = s.finance.allSettlements().find(row=>row.id!==bill.id);
  assert.ok(fresh);
  assert.equal(fresh.draft,null);
  assert.equal(fresh.review.action,"submit");
  assert.equal(fresh.version.amount_fen,2000);
  assert.equal(fresh.effective_amount_fen,null);
  assert.equal(await page.evaluate(() => window.__worksheetDoubleLoading),false);
  assert.deepEqual(errors, []);
  console.log("YOULAI_SETTLEMENT_REVISION_OK same worksheet and keyboard correction at 1920px, immutable approved version");
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  for (const fn of cleanup.reverse()) await fn();
}
