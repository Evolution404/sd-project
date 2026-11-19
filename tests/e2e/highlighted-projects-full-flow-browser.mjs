import { activeEditor, workPage, confirmProjectApproval, approveSettlement, submitSettlement } from "./work-page-helper.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { inspect } from "../inspector.mjs";
import { selectFormChoice } from "./field-helper.mjs";

const source = JSON.parse(readFileSync(new URL("../fixtures/highlighted-projects-1113.json", import.meta.url)));
const out = join(process.cwd(), "test-results/schema113/two-source-projects");
mkdirSync(out, { recursive: true });
const runDirectory = mkdtempSync(join(out, "run-"));
const dataDirectory = join(runDirectory, "data");
let system = createSystem(dataDirectory);
const password = "Source-Project-Flow-Test-2026!";
system.auth.initialize("admin", password);
const { user } = system.auth.login("admin", password);
const save = (kind, input) => system.catalog.save(user, kind, input);
const voltage = save("voltages", { name: "220kV" });
const baseUnit = save("units", { name: "基", quantity_precision: 0 });
const pieceUnit = save("units", { name: "片", quantity_precision: 0 });
const object = save("objects", { name: "绝缘子", object_position: "body", attribution_unit: "logical_tower" });
const operation = save("operations", { name: "老旧瓷绝缘子综合修理", work_object_id: object.id,
  default_unit_id: baseUnit.id, completion_standard: "模拟验收标准：绝缘子及连接金具检查合格" });
const inspectionObject = save("objects", { name: "杆塔检查", object_position: "body", attribution_unit: "logical_tower" });
const inspectionOperation = save("operations", { name: "模拟登塔检查消缺", work_object_id: inspectionObject.id,
  default_unit_id: baseUnit.id, completion_standard: "模拟检查和缺陷复核" });
const materials = ["耐张瓷绝缘子", "跳线瓷绝缘子"].map(name => save("materials", {
  name, model: "演练规格", specification: "原表未提供型号，本规格为测试专用", unit_id: pieceUnit.id,
}));
save("prices", { title: "模拟逐塔综合修理参考价", operation_id: operation.id,
  pricing_mode: "per_unit", unit_price_fen: 3000000, price_source: "隔离演练模拟价格",
  price_date: "2026-01-01", effective_on: "2026-01-01", basis: "用于复核逐塔数量和参考价，独立于原表审定额" });
const framework = save("frameworks", { name: source.framework_name, fiscal_year: source.framework_year,
  limit_fen: 200000000 });
const agreement = save("agreements", { name: source.agreement_name, framework_id: framework.id,
  limit_fen: source.agreement_amount_fen });
const cases = source.projects.map((record, index) => {
  const line = save("lines", { name: record.line, voltage_level_id: voltage.id });
  const towers = record.towers.map(number => save("towers", { line_id: line.id, tower_no: String(number) }));
  return { ...record, line, towers, index, demandId: null, projectId: null, bills: [] };
});
const errors = [], steps = [], rejected = [];
let server = httpServer(system);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1060 } });
page.on("pageerror", error => errors.push(error.message));
page.on("response", async response => {
  if (response.url().includes("/api/") && response.status() >= 400)
    rejected.push({ url: new URL(response.url()).pathname, status: response.status(), message: (await response.json()).message });
});
const detail = page.locator(".business-detail-dialog:visible");
const editor = activeEditor(page);
const budgetMultiplier = 10000;
function recordStep(name, facts = {}) {
  steps.push({ name, ...facts });
  console.log("SOURCE_PROJECT_STEP", name, JSON.stringify(facts));
}
async function login() {
  await page.goto(base + "/#/demands");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function visit(path) {
  await page.goto(base + "/#/" + path);
  await page.locator(".shell").waitFor();
}
async function confirm() {
  await page.locator(".el-message-box:visible .el-button--primary").click();
  await page.locator(".el-message-box:visible").waitFor({ state: "hidden" });
}
async function saveEditor(label = "保存") {
  await editor.getByRole("button", { name: label, exact: true }).click();
  await editor.waitFor({ state: "hidden", timeout: 12000 });
}
async function choose(label, value, scope = editor) {
  await selectFormChoice(page, label, value, scope);
}
async function rowAction(row, name) {
  const button = row.getByRole("button", { name, exact: true });
  if (await button.count()) await button.click();
  else {
    await row.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}
async function openProject(record, tab = "overview") {
  await visit(`projects?project=${record.projectId}&tab=${tab}`);
  await detail.getByRole("heading", { name: record.name, exact: true }).waitFor();
  const names = { overview: "概览", scope: "承接需求", approval: "立项与变更", finance: "费用与结算", history: "历史记录" };
  await detail.getByRole("tab", { name: names[tab], exact: true }).click();
}
async function selectLocations(lineName) {
  await editor.getByRole("button", { name: "添加作业位置", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加作业位置", exact: true });
  await picker.locator(".picker-filters .el-select").first().click();
  await page.getByRole("option", {name:new RegExp(lineName)}).last().click();
  await picker.locator(".el-table__body-wrapper tr").first().waitFor();
  await picker.getByRole("button", { name: "全选筛选结果", exact: true }).click();
  await picker.getByRole("button", { name: "添加已选位置", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
}
async function createDemand(record) {
  await visit("demands");
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await choose("操作类型", operation.name);
  await editor.getByLabel("问题描述", { exact: true }).fill(record.description);
  await selectLocations(record.line.name);
  await editor.getByRole("tab", { name: "作业位置与工作量", exact: true }).click();
  const quantities = editor.locator(".quantity-cell input:visible");
  for (let i = 0; i < await quantities.count(); i++) await quantities.nth(i).fill("1");
  await editor.getByRole("tab", { name: "预计物资", exact: true }).click();
  await editor.getByRole("button", { name: "添加预计物资", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加预计物资", exact: true });
  for (const material of materials)
    await picker.getByRole("checkbox", { name:"选择物资：" + material.name + " 演练规格", exact:true }).locator("xpath=ancestor::label[1]").click();
  await picker.getByRole("button", { name: "添加已选物资（2）", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  for (const [index, quantity] of [record.tension_pieces, record.jumper_pieces].entries())
    await editor.getByRole("row").filter({ hasText: materials[index].name }).locator("input:visible").last().fill(String(quantity));
  await editor.getByRole("tab", { name: "来源及其他信息", exact: true }).click();
  await editor.getByLabel("来源说明", { exact: true }).fill(`${source.source_file}「大修」${record.source_range}，逐塔按1基综合修理；型号与后续变更为模拟测试`);
  await saveEditor("保存需求版本");
  const row = system.demands.list().find(d => d.problem_description === record.description);
  assert.ok(row);
  const demand = system.demands.get(row.id);
  record.demandId = demand.id;
  assert.equal(demand.quantity_scaled, record.towers.length * 10000);
  assert.equal(demand.materials.reduce((sum, m) => sum + m.quantity_scaled, 0),
    (record.tension_pieces + record.jumper_pieces) * 10000);
  recordStep("需求录入", { project: record.source_reference, locations: demand.work_locations.length });
}
async function activateDemand(record, returnOnce = false) {
  await visit("demands?demand=" + record.demandId);
  await detail.getByRole("button", { name: "确认并待承接", exact: true }).click();
  await confirm();
  await detail.getByRole("button", { name: "关联子项目", exact: true }).waitFor();
  if (returnOnce) {
    await detail.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "退回", exact: true }).click();
    await confirm();
    await detail.getByRole("button", { name: "修订需求", exact: true }).click();
    await editor.getByLabel("问题描述", { exact: true }).fill(record.description + "\n模拟补正：按现场核验保留全部杆塔范围。");
    await saveEditor("保存需求版本");
    await detail.getByRole("button", { name: "确认并待承接", exact: true }).click();
    await confirm();
    await detail.getByRole("button", { name: "关联子项目", exact: true }).waitFor();
    recordStep("需求退回修订再确认", { project: record.source_reference });
  }
}
async function createProject(record) {
  await detail.getByRole("button", { name: "关联子项目", exact: true }).click();
  await page.getByRole("dialog", { name: "选择子项目承接需求" })
    .getByRole("button", { name: "创建子项目并承接", exact: true }).click();
  await editor.getByLabel("项目名称", { exact: true }).fill(record.name);
  await choose("年度框架", framework.name + " · " + source.framework_year);
  await saveEditor();
  await detail.getByRole("heading", { name: record.name, exact: true }).waitFor();
  const project = system.projects.list().find(p => p.name === record.name);
  record.projectId = project.id;
  assert.equal(system.demands.get(record.demandId).binding.project_id, project.id);
  await detail.getByRole("button", { name: "确认入库", exact: true }).click();
  await confirm();
  recordStep("项目入库", { project: record.source_reference, projectId: record.projectId });
}
async function reviseDate(record, date) {
  await visit("demands?demand=" + record.demandId);
  await detail.getByRole("button", { name: "修订需求", exact: true }).click();
  await editor.getByLabel("预计解决时间", { exact: true }).fill(date);
  await saveEditor("保存需求版本");
}
async function createApproval(record) {
  await openProject(record, "approval");
  await detail.getByRole("button", { name: "编制立项", exact: true }).click();
  await editor.getByLabel("批准预算（元）", { exact: true }).fill(
    (Number(record.budget_value) * budgetMultiplier).toFixed(2));
  for (const [index, quantity] of [record.tension_pieces, record.jumper_pieces].entries()) {
    await editor.getByRole("button", { name: "添加批准物资", exact: true }).click();
    const materialRow = editor.locator(".approval-material-row").last();
    await materialRow.locator(".el-select").click();
    const popupId = await materialRow.getByRole("combobox").getAttribute("aria-controls");
    await page.locator('[id="' + popupId + '"]').getByRole("option", {
      name: new RegExp("^" + materials[index].name + " ·"),
    }).click();
    await materialRow.locator(".approval-material-field").nth(1).locator("input").fill(String(quantity));
  }
  await editor.getByRole("button", { name: "保存批准草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  return system.projects.get(record.projectId).approvals.find(ap => ap.status === "draft");
}
async function quoteAndApprove(record) {
  const quoteButtons = detail.getByRole("button", { name: "按承接范围核价", exact: true });
  for (let index = 0; index < await quoteButtons.count(); index++) {
    await quoteButtons.nth(index).click();
    const quoteDialog = page.getByRole("dialog", { name: "参考价格", exact: true });
    const confirmQuote = quoteDialog.getByRole("button", { name: "确认正式报价", exact: true });
    await quoteDialog.getByText(/完整参考价 ¥|未完整计价，已计价小计/).waitFor();
    if (await confirmQuote.isDisabled()) {
      await quoteDialog.getByText(/未完整计价，已计价小计/).waitFor();
      assert.equal(await quoteDialog.getByText("计价条件已修改，上次金额仅供参考；请重新试算后才能确认正式报价", { exact: true }).count(), 0);
    } else {
      await confirmQuote.click();
      await page.getByText("已保存正式参考报价", { exact: true }).last().waitFor();
    }
    await page.getByRole("button", { name: "关闭报价", exact: true }).click();
  }
  await detail.getByRole("button", { name: /^审核(立项|变更)$/ }).click();
  await confirmProjectApproval(page);
  await page.getByText("确认正式批准成功，正在刷新业务状态", { exact: true }).last().waitFor();
}
async function linkAgreement(record) {
  await openProject(record);
  await detail.getByRole("button", { name: "编辑档案", exact: true }).click();
  await editor.getByLabel("执行协议（选填）", { exact: true }).click();
  await page.getByRole("option", { name: new RegExp(agreement.name) }).click();
  await saveEditor();
  assert.equal(system.projects.get(record.projectId).funding.agreement_id, agreement.id);
}
async function reviseLocations(record) {
  await visit("ledger/towers");
  await page.getByRole("button", { name: "新增逻辑杆塔", exact: true }).click();
  await choose("所属线路", record.line.name + " · 220kV");
  await editor.getByLabel("杆塔号", { exact: true }).fill("20");
  await saveEditor();
  await visit("demands?demand=" + record.demandId);
  await detail.getByRole("button", { name: "修订需求", exact: true }).click();
  await editor.getByLabel("问题描述", { exact: true }).fill(record.description + "\n模拟需求变更：新增20号塔综合修理，逐塔材料明细待现场核对。");
  await selectLocations(record.line.name);
  await editor.getByRole("tab", { name: "作业位置与工作量", exact: true }).click();
  const quantities = editor.locator(".quantity-cell input:visible");
  for (let i = 0; i < await quantities.count(); i++) await quantities.nth(i).fill("1");
  await saveEditor("保存需求版本");
  assert.equal(system.demands.get(record.demandId).quantity_scaled, 170000);
  assert.equal(system.projects.get(record.projectId).approvals.at(-1).scopes[0].quantity_scaled, 160000);
  recordStep("已批准需求新增位置，旧批准保持16基", { project: record.source_reference });
}
async function createCandidate() {
  const description = "模拟变更新增的独立登塔检查需求，可在正式移出后转承";
  await visit("demands");
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await choose("操作类型", inspectionOperation.name);
  await editor.getByLabel("问题描述", { exact: true }).fill(description);
  await editor.getByLabel("预计解决时间", { exact: true }).fill("2026-12-20");
  await editor.getByRole("button", { name: "添加作业位置", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加作业位置", exact: true });
  await picker.locator(".picker-filters .el-select").first().click();
  await page.getByRole("option", { name: new RegExp(cases[0].line.name) }).last().click();
  await picker.locator(".el-table__body-wrapper tr").first().locator(".el-checkbox").click();
  await picker.getByRole("button", { name: "添加已选位置", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await editor.getByLabel("来源说明", { exact: true }).fill("模拟增加的独立检查任务，原表未列本项变更");
  await saveEditor("保存需求版本");
  const demand = system.demands.list().find(d => d.problem_description === description);
  const record = { demandId: demand.id };
  await activateDemand(record);
  return system.demands.get(demand.id);
}
async function changeApproval(record, { addCandidate, removeDemandId, budgetFen, changeMaterials } = {}) {
  await openProject(record, "approval");
  await detail.getByRole("button", { name: "编制变更", exact: true }).click();
  await editor.getByLabel("批准预算（元）", { exact: true }).fill(
    budgetFen === undefined ? (Number(record.budget_value) * budgetMultiplier + 1000).toFixed(2) : amountInput(budgetFen));
  if (changeMaterials) {
    await editor.locator(".approval-material-row").first().locator(".approval-material-field").nth(1).locator("input").fill(String(record.tension_pieces + 1));
  }
  if (addCandidate) {
    await editor.getByRole("button", { name: "新增候选需求", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "选择变更新增需求", exact: true });
    await picker.getByLabel("选择需求：" + addCandidate.demand_no).check();
    await picker.getByRole("button", { name: "加入变更草稿（1）", exact: true }).click();
    await picker.waitFor({ state: "hidden" });
  }
  if (removeDemandId) {
    const number = system.demands.get(removeDemandId).demand_no;
    await editor.locator("label.el-checkbox").filter({ hasText: number }).click();
  }
  await editor.getByRole("button", { name: "核对并保存变更草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const draft = system.projects.get(record.projectId).approvals.find(ap => ap.status === "draft");
  if (addCandidate) assert.equal(system.demands.get(addCandidate.id).binding, null);
  return draft;
}
async function postRejected(path, input, expectedStatus) {
  const response = await page.evaluate(async ({ path, input }) => {
    const response = await fetch("/api" + path, { method: "POST", credentials: "same-origin",
      headers: {"Content-Type":"application/json", "Idempotency-Key":crypto.randomUUID()}, body:JSON.stringify(input) });
    return { status:response.status, body:await response.json() };
  }, { path, input });
  assert.equal(response.status, expectedStatus, JSON.stringify(response));
  return response;
}
const amountInput = fen => (fen / 100).toFixed(2);
const displayAmount = fen => (fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function createNode(record, name) {
  await detail.getByRole("button", { name: "新增科目", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill(name);
  await saveEditor();
  return system.finance.costTree(user, record.projectId).find(node => node.name === name);
}
async function createCost(record, node, title, amount) {
  await detail.getByRole("button", { name: "核定费用", exact: true }).click();
  await editor.getByLabel("费用事项", { exact: true }).fill(title);
  await choose("末级费用科目", node.name);
  await editor.getByLabel("实际金额（元）", { exact: true }).fill(amountInput(amount));
  await editor.getByLabel("发生日期", { exact: true }).fill("2026-03-17");
  await editor.getByLabel("费用凭据", { exact: true }).fill("模拟费用凭据，原表未提供发票和真实费用分项");
  await saveEditor();
  return system.finance.costs(record.projectId).find(cost => cost.title === title);
}
async function createBill(record, node, evidence, amount, resolved, candidate) {
  await detail.getByRole("button", { name: "新增结算草稿", exact: true }).click();
  await choose("费用科目", node.name);
  await choose("关联需求（共同费用可不选）", system.demands.get(record.demandId).demand_no);
  await editor.getByLabel("本次金额（元）", { exact: true }).fill(amountInput(amount));
  await editor.getByLabel("依据", { exact: true }).fill(evidence);
  await editor.getByRole("button", { name: "添加解决需求", exact: true }).click();
  await choose("项目需求", system.demands.get(record.demandId).demand_no);
  await editor.locator(".el-form-item").filter({ has:page.getByText("本次新增解决量", {exact:true}) })
    .locator("input").fill(String(resolved));
  if (candidate) {
    await editor.getByRole("button", { name: "添加解决需求", exact: true }).click();
    const last = editor.locator(".finance-editor-line").last();
    await choose("项目需求", candidate.demand_no, last);
    await last.locator(".el-form-item").filter({ has:page.getByText("本次新增解决量", {exact:true}) })
      .locator("input").fill("0");
  }
  await saveEditor("保存草稿");
  const bill = system.finance.settlements(record.projectId).find(item => item.draft?.document.items[0].evidence === evidence);
  record.bills.push(bill.id);
  return bill;
}
async function submitBill(bill, returned = false) {
  const row = detail.getByRole("row").filter({ hasText: bill.number }).first();
  await submitSettlement(page, row);
  await row.getByText(/待审核/).waitFor();
  if (returned) {
    await rowAction(row, "审核结算");
    const review = workPage(page);
    await review.getByLabel("退回原因（选择退回时必填）").fill("模拟退回，补充核定工作量及凭据后按原版重提");
    await review.getByRole("button", { name: "确认退回", exact: true }).click();
    await row.getByText(/退回原因/).waitFor();
    const versionId = system.finance.settlement(bill.id).version.id;
    await rowAction(row, "原版重新提交");
    await confirm();
    await row.getByText(/待审核/).waitFor();
    assert.equal(system.finance.settlement(bill.id).version.id, versionId);
    recordStep("结算退回后原版重新提交", { bill:bill.number });
  }
  await approveSettlement(page, row);
  await row.getByText(/已审核/).waitFor();
  return system.finance.settlement(bill.id);
}
async function reconcile(record, cost, bill, suffix) {
  await detail.getByRole("button", { name: "新增正式核对", exact: true }).click();
  await choose("实际费用", cost.title + " ¥" + displayAmount(cost.amount_fen));
  await choose("已批准结算明细", bill.number + " ¥" + displayAmount(bill.items[0].amount_fen));
  await editor.getByLabel("费用份额（元）", { exact: true }).fill(amountInput(cost.amount_fen));
  await editor.getByLabel("核定结算额（元）", { exact: true }).fill(amountInput(bill.items[0].amount_fen));
  await editor.getByLabel("核对依据", { exact: true }).fill("模拟双金额核对" + suffix);
  await saveEditor();
  return system.finance.reconciliations(record.projectId).find(r => r.evidence === "模拟双金额核对" + suffix);
}
async function financialFlow(record, candidate) {
  await openProject(record, "finance");
  const materialNode = await createNode(record, "材料费");
  const laborNode = await createNode(record, "施工费");
  const cancelledDraft = await createBill(record, laborNode, "模拟首次草稿撤回", 100, 0);
  const cancelledRow = detail.getByRole("row").filter({ hasText: cancelledDraft.number }).first();
  await rowAction(cancelledRow, "撤回草稿");
  await confirm();
  await cancelledRow.waitFor({ state: "hidden" });
  assert.equal(system.finance.settlements(record.projectId).some(b => b.id === cancelledDraft.id), false);
  recordStep("首次结算草稿撤回及审计保留", { project: record.source_reference });
  const materialAmount = Math.floor(record.approved_settlement_fen / 2);
  const difference = record.index === 0 ? 123456 : 20000;
  const materialCost = await createCost(record, materialNode, "模拟绝缘子材料费用", materialAmount);
  await createCost(record, laborNode, "模拟施工费用", record.approved_settlement_fen - materialAmount + difference);
  const baseline = system.finance.summary(record.projectId).actual_cost_fen;
  const overBudget = system.projects.get(record.projectId).approval.approved_budget_fen + 100;
  const temporary = await createCost(record, laborNode, "模拟超预算后撤销的费用", overBudget);
  assert.equal(system.finance.summary(record.projectId).actual_cost_fen, baseline + overBudget);
  const temporaryRow = detail.getByRole("row").filter({ hasText: temporary.title }).filter({ has: page.getByRole("button", { name: "更多操作", exact: true }) }).first();
  await rowAction(temporaryRow, "作废费用");
  await confirm();
  await temporaryRow.getByText("已作废", { exact: true }).waitFor();
  assert.equal(system.finance.summary(record.projectId).actual_cost_fen, baseline);
  await rowAction(temporaryRow, "管理员删除");
  await confirm();
  assert.equal(system.finance.costs(record.projectId, true).find(c => c.entry_id === temporary.entry_id).deleted, true);
  recordStep("费用分项、超预算、作废及逻辑删除", { project:record.source_reference, actual_fen:baseline });

  const firstTarget = Math.floor(record.approved_settlement_fen * 0.6);
  const originalAmount = Math.floor(record.submitted_amount_fen * 0.6);
  let firstBill = await createBill(record, materialNode, "模拟第一期，送审额拆分", originalAmount,
    record.index === 0 ? 10 : 7, candidate);
  firstBill = await submitBill(firstBill, record.index === 0);
  const oldReconciliation = await reconcile(record, materialCost, firstBill, "原送审版");
  const previousVersion = firstBill.version.id;
  const previousApproval = firstBill.version.approval_version_id;
  await changeApproval(record, { budgetFen: system.projects.get(record.projectId).approval.approved_budget_fen + 100 });
  await quoteAndApprove(record);
  await openProject(record, "finance");
  assert.notEqual(system.projects.get(record.projectId).approval.id, previousApproval);
  recordStep("已有结算后正式调整项目预算，原结算继续有效", { project: record.source_reference });
  const firstRow = detail.getByRole("row").filter({ hasText:firstBill.number }).first();
  await rowAction(firstRow, "发起新修订");
  await editor.getByLabel("本次金额（元）", { exact:true }).first().fill(amountInput(firstTarget));
  await editor.getByLabel("结算依据", { exact:true }).fill("模拟按原表审定额修正本期金额");
  await saveEditor("保存草稿");
  assert.equal(system.finance.summary(record.projectId).settlement_fen, originalAmount);
  await submitSettlement(page, firstRow);
  await firstRow.getByText(/待审核/).waitFor();
  assert.equal(system.finance.summary(record.projectId).settlement_fen, originalAmount);
  await approveSettlement(page, firstRow);
  await firstRow.getByText(/已审核/).waitFor();
  firstBill = system.finance.settlement(firstBill.id);
  assert.notEqual(firstBill.version.id, previousVersion);
  assert.equal(firstBill.version.approval_version_id, previousApproval);
  assert.equal(system.finance.summary(record.projectId).settlement_fen, firstTarget);
  assert.equal(system.finance.summary(record.projectId).reconciled_cost_fen, 0);
  const staleRow = detail.getByRole("row").filter({ hasText:"模拟双金额核对原送审版" }).first();
  await rowAction(staleRow, "删除");
  await confirm();
  assert.equal(system.finance.reconciliationHistory(oldReconciliation.record_id).at(-1).status, "voided");
  await reconcile(record, materialCost, firstBill, "审定修正版");
  recordStep("结算修订替代及原核对撤销再核对", { project:record.source_reference, first_bill:firstBill.number });

  const second = await createBill(record, laborNode, "模拟第二期", record.approved_settlement_fen - firstTarget - 10000,
    record.index === 0 ? 7 : 5);
  await submitBill(second);
  const third = await createBill(record, laborNode, "模拟第三期仅补结费用", 10000, 0);
  await submitBill(third);
  let summary = system.finance.summary(record.projectId);
  assert.equal(summary.settlement_fen, record.approved_settlement_fen);
  const mainResult = summary.demands.find(d => d.demand_id === record.demandId);
  assert.equal(mainResult.resolved_quantity_scaled, record.index === 0 ? 170000 : 120000);
  if (candidate) {
    assert.equal(mainResult.excess_quantity_scaled, 10000);
    assert.equal(summary.demands.find(d => d.demand_id === candidate.id).remaining_quantity_scaled, 10000);
  }
  recordStep("三期结算与零新增解决量", { project:record.source_reference, summary });

  const thirdRow = detail.getByRole("row").filter({ hasText:third.number }).first();
  await rowAction(thirdRow, "发起新修订");
  await editor.getByLabel("结算依据", { exact:true }).fill("模拟未提交修订，随后撤回");
  await saveEditor("保存草稿");
  await detail.getByRole("tab", { name:"概览", exact:true }).click();
  await detail.getByText(/尚有未提交的结算草稿或修订草稿/).waitFor();
  assert.equal(await detail.getByRole("button", { name:"结项核对", exact:true }).isDisabled(), true);
  await detail.getByRole("tab", { name:"费用与结算", exact:true }).click();
  await rowAction(thirdRow, "撤回草稿");
  await confirm();
  await thirdRow.getByText(/已审核/).waitFor();
  assert.equal(system.finance.settlement(third.id).draft, null);
  assert.equal(system.finance.summary(record.projectId).settlement_fen, record.approved_settlement_fen);
  recordStep("撤回未提交结算修订，保留原批准金额", { project:record.source_reference });
  await detail.getByRole("tab", { name:"概览", exact:true }).click();
  await detail.getByRole("button", { name:"结项核对", exact:true }).click();
  const closeDialog = page.getByRole("dialog", { name:"结项前业务核对", exact:true });
  await closeDialog.getByText("待核对费用", { exact:true }).waitFor();
  await closeDialog.getByRole("button", { name:"已核对差异，正式结项", exact:true }).click();
  await page.getByText("确认审核结项成功，正在刷新业务状态", { exact:true }).last().waitFor();
  assert.equal(system.projects.get(record.projectId).status, "closed");
  summary = system.finance.summary(record.projectId);
  await postRejected(`/projects/${record.projectId}/costs`, {title:"结项后非法费用", amount_fen:1,
    cost_node_id:laborNode.id, occurred_on:"2026-11-16", evidence:"负例"}, 409);
  const scope = system.projects.get(record.projectId).scopes.find(s => s.demand_id === record.demandId);
  const binding = system.demands.history(record.demandId).bindings.find(b => b.id === scope.id);
  await postRejected(`/projects/${record.projectId}/release/${scope.id}`, {
    expected_event_seq:binding.events.at(-1).event_seq,
  }, 409);
  recordStep("差异结项与结项后写入、解绑保护", { project:record.source_reference, summary });
  for (const width of [1500, 1280, 960, 760]) {
    await page.setViewportSize({width,height:1060});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({path:join(runDirectory, `project-${record.index + 1}-closed-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1500,height:1060});
}

try {
  await page.route("**/api/projects/*/approval-candidates", async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({response});
  });
  await login();
  for (const record of cases) {
    await createDemand(record);
    await activateDemand(record, record.index === 0);
    await createProject(record);
    const oldDraft = await createApproval(record);
    await detail.getByText(/正式批准前，请填写/).waitFor();
    assert.equal(await detail.getByRole("button", { name: "审核立项", exact: true }).isDisabled(), true);
    await postRejected(`/projects/${record.projectId}/approvals/${oldDraft.id}/approve`, {
      expected_version: system.projects.get(record.projectId).version,
    }, 422);
    assert.equal(system.projects.get(record.projectId).approval, null);
    await reviseDate(record, "2026-12-15");
    await openProject(record, "approval");
    await detail.getByRole("button", { name: /^审核(立项|变更)$/ }).click();
    await workPage(page).getByRole("button", { name: "确认正式批准", exact: true }).click();
    await page.getByText(/需求正式版本已变化/).waitFor();
    await workPage(page).getByRole("button", { name: "撤回草稿", exact: true }).click();
    await confirm();
    assert.equal(inspect(system).find("project_approval_versions", "id", oldDraft.id).status, "withdrawn");
    await createApproval(record);
    await quoteAndApprove(record);
    assert.equal(system.projects.get(record.projectId).status, "approved");
    record.initialApprovalId = system.projects.get(record.projectId).approval.id;
    assert.equal(system.projects.get(record.projectId).approval.approved_budget_fen,
      Math.round(Number(record.budget_value) * budgetMultiplier * 100));
    assert.equal(system.projects.get(record.projectId).approvals.at(-1).scopes[0].materials
      .reduce((sum, item) => sum + item.approved_quantity_scaled, 0),
      (record.tension_pieces + record.jumper_pieces) * 10000);
    recordStep("日期缺失与草稿过期保护后正式立项", { project: record.source_reference });
    await page.screenshot({ path: join(runDirectory, `project-${record.index + 1}-approved.png`), fullPage: true });
  }
  recordStep("初始两项目批准完成", { cases: cases.map(record => record.projectId) });
  for (const record of cases) await linkAgreement(record);
  const agreementUsage = system.projects.agreementOptions(cases[0].projectId).options.find(item => item.id === agreement.id);
  assert.equal(agreementUsage.linked_projects_count, 2);
  assert.equal(agreementUsage.linked_approved_budget_fen, 191900000);
  recordStep("共用执行协议汇总与软额度", { approved_budget_fen:agreementUsage.linked_approved_budget_fen });
  const secondBaseline = system.projects.get(cases[1].projectId).approval.id;
  await reviseDate(cases[1], "2026-12-16");
  assert.equal(system.projects.get(cases[1].projectId).approval.id, secondBaseline);
  recordStep("批准后仅修订需求日期", { project:cases[1].source_reference });
  await reviseLocations(cases[0]);
  await changeApproval(cases[0], { changeMaterials: true });
  await quoteAndApprove(cases[0]);
  assert.equal(system.projects.get(cases[0].projectId).approvals.at(-1).scopes[0].quantity_scaled, 170000);
  assert.equal(system.projects.get(cases[0].projectId).approvals.at(-1).scopes[0].materials
    .reduce((sum, item) => sum + item.approved_quantity_scaled, 0), 33910000);
  recordStep("项目正式变更采用17基需求新版及模拟增加1片批准物资", { project:cases[0].source_reference });
  const candidate = await createCandidate();
  const added = await changeApproval(cases[0], {addCandidate:candidate});
  await quoteAndApprove(cases[0]);
  assert.equal(system.demands.get(candidate.id).binding.project_id, cases[0].projectId);
  await postRejected(`/projects/${cases[1].projectId}/link`, {demand_id:candidate.id,expected_version:candidate.current_version}, 409);
  recordStep("正式变更新增候选及独占保护", { candidate:candidate.demand_no });
  await changeApproval(cases[0], {removeDemandId:candidate.id});
  await quoteAndApprove(cases[0]);
  assert.equal(system.demands.get(candidate.id).binding, null);
  assert.equal(system.projects.get(cases[0].projectId).approvals.find(ap => ap.id === added.id).scopes.length, 2);
  await changeApproval(cases[1], {addCandidate:candidate});
  await quoteAndApprove(cases[1]);
  assert.equal(system.demands.get(candidate.id).binding.project_id, cases[1].projectId);
  recordStep("正式移出、释放并由另项目正式转承", { candidate:candidate.demand_no });
  for (const record of cases) await financialFlow(record, record.index === 1 ? candidate : null);
  const finalSummaries = cases.map(record => system.finance.summary(record.projectId));
  assert.equal(finalSummaries.reduce((sum, item) => sum + item.settlement_fen, 0), 29491251);
  await new Promise(resolve => server.shutdown(resolve));
  system.close();
  system = createSystem(dataDirectory);
  server = httpServer(system);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  await page.context().clearCookies();
  await login();
  for (const record of cases) {
    const project = system.projects.get(record.projectId);
    assert.equal(project.status, "closed");
    const initial = project.approvals.find(ap => ap.id === record.initialApprovalId);
    assert.equal(initial.approved_budget_fen, Math.round(Number(record.budget_value) * budgetMultiplier * 100));
    assert.equal(initial.scopes[0].quantity_scaled, record.towers.length * 10000);
    assert.equal(initial.scopes[0].materials.reduce((sum, item) => sum + item.approved_quantity_scaled, 0),
      (record.tension_pieces + record.jumper_pieces) * 10000);
    const history = system.projects.history(record.projectId);
    assert.equal(history.closures.length, 1);
    assert.deepEqual(JSON.parse(history.closures[0].close_snapshot_json), finalSummaries[record.index]);
    assert.equal(system.finance.summary(record.projectId).settlement_fen, record.approved_settlement_fen);
    assert.equal(system.demands.get(record.demandId).binding.project_id, record.projectId);
    await openProject(record, "finance");
    await detail.getByText("¥" + displayAmount(record.approved_settlement_fen), { exact: true }).first().waitFor();
  }
  recordStep("重启后两项目结项、归属、结算及不可变历史持久化", { combined_settlement_fen: 29491251 });
  assert.deepEqual(errors, []);
  assert.deepEqual(inspect(system).integrity().foreignKeys, []);
  writeFileSync(join(out, "last-run.json"), JSON.stringify({dataDirectory, runDirectory, steps, cases,
    budget_unit: source.budget_unit, finalSummaries, errors, rejected}, null, 2));
  console.log("HIGHLIGHTED_PROJECTS_FULL_FLOW_OK", runDirectory);
} catch (error) {
  await page.screenshot({ path: join(runDirectory, "failure.png"), fullPage: true });
  writeFileSync(join(runDirectory, "failure.json"), JSON.stringify({step:steps.at(-1), url:page.url(), errors, rejected, message:error.message}, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.shutdown(resolve));
  system.close();
}
