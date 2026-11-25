import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectFormChoice } from "./field-helper.mjs";

// A2: One continuous real browser journey from a genuinely empty database.
// No fixture writes business masters or bypasses UI creation.
const root = mkdtempSync(join(tmpdir(), "sd113-a2-empty-chain-"));
const s = createSystem(join(root, "data"));
for (const type of ["lines", "towers", "physical", "voltages", "units", "operations",
  "organizations", "frameworks", "agreements"])
  assert.equal(s.catalog.list(type).length, 0, type + " must start empty");
assert.equal(s.materials.list().length, 0);
assert.equal(s.demands.list().length, 0);
assert.equal(s.projects.list().length, 0);
s.auth.initialize("admin", "A2-Test-Password");
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const out = join(process.cwd(), "test-results/schema113/first-use-A2");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:" + server.address().port;
const editor = page.locator(".business-work-surface:visible, .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
const detail = page.locator(".business-detail-dialog:visible");
async function visit(route) {
  await page.goto(base + "/#/" + route);
  await page.locator("main h1").waitFor();
}
async function save(label = "保存") {
  await editor.getByRole("button", { name: label, exact: true }).click();
  await editor.waitFor({ state: "hidden", timeout: 12000 });
}
async function choice(label, option) { await selectFormChoice(page, label, option, editor); }

try {
  await page.goto(base + "/#/dictionaries/voltages");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("A2-Test-Password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
  await page.getByRole("button", { name: "新增电压等级", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill("220kV");
  await save();
  assert.equal(s.catalog.list("voltages").length, 1);

  await visit("ledger/lines");
  await page.getByRole("button", { name: "新增线路", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill("A2空库测试线路");
  await choice("电压等级", "220kV");
  await save();
  await page.getByRole("tab", { name: "逻辑杆塔", exact: true }).click();
  await page.getByRole("button", { name: "新增逻辑杆塔", exact: true }).click();
  await choice("所属线路", "A2空库测试线路");
  await editor.getByLabel("杆塔号", { exact: true }).fill("T01");
  await save();
  assert.equal(s.catalog.list("towers").length, 1);
  assert.equal(s.catalog.list("physical").length, 1);

  await visit("dictionaries/units");
  await page.getByRole("button", { name: "新增计量单位", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill("套");
  await save();
  assert.equal(s.catalog.list("units").length, 1);

  await visit("dictionaries/organizations");
  await page.getByRole("button", { name: "新增一级单位", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill("A2空库输电中心");
  await save();
  assert.equal(s.catalog.list("organizations").length, 1);

  await visit("materials");
  await page.getByRole("button", { name: "新增物资", exact: true }).click();
  await choice("计量单位", "套");
  await editor.getByLabel("物资名称", { exact: true }).fill("A2防鸟装置");
  await editor.getByLabel("型号", { exact: true }).fill("A2-BIRD");
  await editor.getByLabel("规格", { exact: true }).fill("测试规格");
  await save();
  assert.equal(s.materials.list().length, 1);

  await visit("standards/objects");
  await page.getByRole("button", { name: "新增作业对象", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill("防鸟装置");
  await choice("对象位置", "本体");
  await choice("归属单元", "逻辑杆塔");
  await save();
  await visit("standards/operations");
  await page.getByRole("button", { name: "新增操作类型", exact: true }).click();
  await editor.getByLabel("名称", { exact: true }).fill("A2安装防鸟装置");
  await choice("作业对象", "防鸟装置");
  await choice("固定计量单位", "套");
  await editor.getByRole("tab", { name: "录入模板" }).click();
  await editor.getByLabel("默认验收标准", { exact: true }).fill("安装牢固");
  await save();
  assert.equal(s.catalog.list("operations").length, 1);

  await visit("pricing/prices");
  await page.getByRole("button", { name: "新增参考价格规则", exact: true }).click();
  await editor.getByLabel("规则名称", { exact: true }).fill("A2空库参考价");
  await choice("操作类型", "A2安装防鸟装置");
  await editor.getByLabel("价格来源", { exact: true }).fill("测试演示资料");
  await editor.getByLabel("价格日期", { exact: true }).fill("2026-01-01");
  await editor.getByLabel("生效日期", { exact: true }).fill("2026-01-01");
  await editor.getByLabel("计价依据", { exact: true }).fill("系统空库验收");
  await editor.getByRole("tab", { name: "计价方式" }).click();
  await editor.getByLabel("单价/固定价", { exact: true }).fill("30");
  await editor.getByRole("button", { name: "试算" }).click();
  await editor.getByText("规则完整性检查通过").waitFor();
  await save();
  assert.equal(s.catalog.list("prices").length, 1);

  await visit("frameworks");
  await page.getByRole("button", { name: "新增年度框架", exact: true }).click();
  await editor.getByLabel("框架名称", { exact: true }).fill("A2空库年度框架");
  await editor.getByLabel("框架额度（元）", { exact: true }).fill("200000");
  await save("保存正式版本");
  assert.equal(s.funding.list("frameworks").length, 1);
  await visit("agreements");
  await page.getByRole("button", { name: "新增执行协议", exact: true }).click();
  await editor.getByLabel("协议名称", { exact: true }).fill("A2空库执行协议");
  await choice("所属年度框架", "A2空库年度框架");
  await editor.getByLabel("协议额度（元）", { exact: true }).fill("100000");
  await save("保存正式版本");
  assert.equal(s.funding.list("agreements").length, 1);

  await visit("demands");
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await choice("操作类型", "A2安装防鸟装置");
  await editor.getByLabel("问题描述", { exact: true }).fill("A2从空数据库完成的现场防鸟治理");
  await editor.getByRole("button", { name: "添加作业位置", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加作业位置", exact: true });
  await picker.getByRole("button", { name: "全选筛选结果", exact: true }).click();
  await picker.getByText("已选择 1 处", { exact: false }).waitFor();
  await picker.getByRole("button", { name: "添加已选位置", exact: true }).click();
  await editor.getByRole("tab", { name: "作业位置与工作量", exact: true }).click();
  await editor.locator(".quantity-cell input:visible").first().fill("2");
  await editor.getByLabel("来源说明", { exact: true }).fill("A2隔离环境巡视记录");
  await save("保存需求版本");
  assert.equal(s.demands.list().length, 1);
  const demand = s.demands.list()[0];
  assert.equal(demand.quantity_scaled, 20000);
  await detail.getByRole("button", { name: "确认并待承接", exact: true }).click();
  await page.locator(".el-message-box:visible .el-button--primary").click();
  // Wait for the server transition and UI reload, not just the confirm click.
  await detail.getByRole("button", { name: "关联子项目", exact: true }).waitFor();
  assert.equal(s.demands.get(demand.id).status, "active");

  await detail.getByRole("button", { name: "关联子项目", exact: true }).click();
  await page.getByRole("dialog", { name: "选择子项目承接需求" })
    .getByRole("button", { name: "创建子项目并承接", exact: true }).click();
  await editor.getByLabel("项目名称", { exact: true }).fill("A2空库完整业务子项目");
  await choice("年度框架", "A2空库年度框架");
  await save();
  const project = s.projects.list().find(row => row.name === "A2空库完整业务子项目");
  assert.ok(project, "new project must be saved");
  assert.equal(s.demands.get(demand.id).binding.project_id, project.id);
  assert.equal(project.scopes.filter(scope => scope.binding).length, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(out, "A2-empty-to-linked-project.png"), fullPage: true });
  console.log("A2_FIRST_USE_FULL_CHAIN_OK empty database -> voltage/line/tower/unit/organization/material/standard/price/framework/agreement -> demand -> active -> linked project");
} catch (error) {
  console.error("A2_FIRST_USE_FULL_CHAIN_FAILURE", error.message, page.url(), errors);
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  s.close();
  rmSync(root, { recursive: true, force: true });
}
