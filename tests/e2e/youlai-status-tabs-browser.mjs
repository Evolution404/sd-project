import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, framework, project, approval, demand, demandInput } = approvedFixture({ after: fn => cleanup.push(fn) });
const createProject = state => s.projects.save(user, { name: "状态验收" + state, framework_id: framework.id });
const reserve = createProject("储备");
const stock = entry => s.projects.stock(user, entry.id, { expected_version: entry.version });
const stocked = stock(createProject("已入库"));
const createDemand = (text, status) => {
  const tower = save("physical", { asset_no: "状态验收" + text, tower_material: "angle" });
  const entry = s.demands.save(user, { ...demandInput, problem_description: text,
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }] });
  return status ? s.demands.transition(user, entry.id, { expected_version: 1, expected_event_seq: 1, status }) : entry;
};
const pending = createDemand("待确认独立项目需求");
const returned = createDemand("退回专项需求", "returned");
const available = createDemand("待承接专项需求", "active");
const cancelled = createDemand("取消专项需求", "cancelled");
const initialDemand = createDemand("立项中的项目需求", "active");
let initial = createProject("立项中");
initial = stock(s.projects.link(user, initial.id, { demand_id: initialDemand.id, expected_version: initial.version }));
initial = s.projects.approvalDraft(user, initial.id, { expected_version: initial.version, approved_budget_fen: 32000,
  scopes: [{ project_scope_id: initial.scopes[0].id, demand_version: 1,
    locations: [{ location_item_no: 1, approved_quantity_scaled: 10000 }] }] });
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const base = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  const table = page.locator('.el-table[data-guide-action="common.table"]');
  const selectStatus = async (resource, status, rowName, excluded = []) => {
    const tab = page.getByRole("tab", { name: status, exact: true });
    const response = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/" + resource &&
        JSON.parse(url.searchParams.get("grid_filters") ?? "{}").display_status?.[0] === status;
    });
    await tab.click();
    assert.equal((await response).status(), 200);
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    const row = table.getByRole("row").filter({ hasText: rowName });
    await row.getByRole("cell", { name: status, exact: true }).waitFor();
    for (const name of excluded) await table.getByRole("row").filter({ hasText: name }).waitFor({ state: "hidden" });
  };
  const go = endpoint => page.goto(base + "/#/business/" + endpoint);
  await go("projects");
  const projectStates = [["储备", reserve.name], ["已入库", stocked.name], ["立项中", initial.name], ["已批准", project.name]];
  for (const [state, name] of projectStates) {
    await selectStatus("projects", state, name, projectStates.map(entry => entry[1]).filter(other => other !== name));
  }
  const statusHeader = table.getByRole("columnheader", { name: /项目状态/ });
  await statusHeader.locator(".el-table__column-filter-trigger").click();
  const remoteHeader = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/projects" && JSON.parse(url.searchParams.get("grid_filters") ?? "{}").display_status?.[0] === "已入库";
  });
  await page.locator(".el-table-filter").getByText("已入库", { exact: true }).click();
  assert.equal((await remoteHeader).status(), 200);
  await table.getByRole("row").filter({ hasText: stocked.name }).waitFor();
  const stockedTab = page.getByRole("tab", { name: "已入库", exact: true });
  assert.equal(await stockedTab.getAttribute("aria-selected"), "true");
  await page.reload();
  await table.getByRole("row").filter({ hasText: stocked.name }).waitFor();
  assert.equal(await stockedTab.getAttribute("aria-selected"), "true");

  let revised = s.projects.approvalDraft(user, project.id, { expected_version: project.version,
    expected_approval_version_id: approval.id, approved_budget_fen: 121000, confirm_changes: true,
    scopes: [{ project_scope_id: project.scopes[0].id, demand_version: demand.current_version,
      locations: demand.work_locations.map(loc => ({ location_item_no: loc.item_no, approved_quantity_scaled: loc.quantity_scaled })) }] });
  await selectStatus("projects", "变更中", project.name);
  await table.getByRole("row").filter({ hasText: project.name }).getByRole("button", { name: "查看详情", exact: true }).click();
  const detail = page.getByRole("dialog", { name: project.name, exact: true });
  await detail.getByText("变更中", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "审核批准草稿", exact: true }).click();
  await page.waitForURL(/\/approval\/review/);
  const review = page.locator(".approval-document");
  await review.getByRole("button", { name: "确认正式批准", exact: true }).waitFor();
  revised = s.projects.discardApproval(user, project.id, revised.approvals.find(entry => entry.status === "draft").id);
  await go("projects");
  await selectStatus("projects", "已批准", project.name);
  await go("demands");
  for (const [state, entry] of [["待确认", pending], ["已退回", returned], ["待承接", available], ["已承接", demand], ["已取消", cancelled]]) {
    await selectStatus("demands", state, entry.demand_no, state === "已退回" ? [pending.demand_no] : []);
  }
  const remaining = s.finance.settlementWorksheet(user, project.id, approval.id).rows.filter(row => row.editable);
  assert.equal(remaining.length, demand.work_locations.length);
  const bill = s.finance.saveAndSubmit(user, project.id, { approval_version_id: approval.id, mode: "project_total", amount_fen: 10000,
    basis: "核对全部位置", resolutions: remaining.map(row => ({ project_scope_id: row.project_scope_id,
      location_item_no: row.location_item_no, resolved_quantity_scaled: row.remaining_quantity_scaled, evidence: "已完成" })) });
  s.finance.review(user, bill.id, { expected_version: bill.version.version_no, expected_event_seq: bill.review.event_seq, action: "approve" });
  await selectStatus("demands", "已解决", demand.demand_no, [available.demand_no]);
  const proof = resolve("test-results/youlai-status-tabs");
  mkdirSync(proof, { recursive: true });
  await page.screenshot({ path: join(proof, "demand-resolved-1920.png"), animations: "disabled" });
  s.projectClosure.commit(user, project.id, { preview_hash: s.projectClosure.preview(user, project.id).preview_hash, expected_version: revised.version });
  assert.equal(s.demands.get(demand.id).binding.project_id, project.id, "completed demands retain the exclusive historical binding");
  await go("projects");
  await selectStatus("projects", "已结项", project.name);
  await page.screenshot({ path: join(proof, "project-closed-1920.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("YOULAI_STATUS_TABS_OK six project states and six demand states, shared server filter and restored query");
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.shutdown(resolveClose));
  for (const done of cleanup.reverse()) await done();
}
