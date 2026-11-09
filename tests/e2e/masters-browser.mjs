import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";
const cleanup = [],
  { s } = fixture({ after: (action) => cleanup.push(action) }),
  server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
    existsSync(chromium.executablePath())
      ? { headless: true }
      : { headless: true, channel: "chrome" },
  ),
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });
async function select(label, value) {
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByLabel(label, { exact: true })
    .press("ArrowDown");
  await page.getByRole("option", { name: value, exact: true }).last().click();
}
async function save() {
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  try {
    await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden", timeout: 8000 });
  } catch (error) {
    console.error(
      "MASTER_SAVE_STILL_OPEN",
      await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").innerText(),
    );
    console.error("MASTER_PAGE_ERRORS", errors);
    await page.screenshot({
      path: join(output, "master-save-failure.png"),
      fullPage: true,
    });
    throw error;
  }
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page
    .getByRole("menuitem", { name: "输电设备台账", exact: true })
    .click();
  await page.getByRole("tab", { name: "电压等级", exact: true }).click();
  await page.getByRole("button", { name: "新增电压等级", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("110kV");
  await save();
  await page
    .getByRole("row")
    .filter({ hasText: "110kV" })
    .getByRole("button", { name: "查看", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByLabel("名称", { exact: true })
    .fill("110千伏");
  await save();
  await page.getByRole("heading", { name: "110千伏", exact: true }).waitFor();
  await page.getByRole("button", { name: "完整历史", exact: true }).click();
  await page
    .getByRole("heading", { name: "完整版本与审计历史", exact: true })
    .waitFor();
  await page.getByText("正式内容版本", { exact: true }).click();
  await page.getByText("创建时间", { exact: true }).first().waitFor();
  assert.equal(await page.locator("pre.data-json").count(), 0);
  await page.screenshot({
    path: join(output, "ledger-detail-1500.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "110千伏" })
    .getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByText("暂无记录", { exact: true }).waitFor();
  await page
    .getByRole("menuitem", { name: "作业标准与参考价格", exact: true })
    .click();
  await page.getByRole("tab", { name: "作业对象", exact: true }).click();
  await page
    .getByRole("button", { name: "新增作业对象", exact: true })
    .click();
  await page.getByLabel("名称", { exact: true }).fill("浏览器专用对象");
  await page.getByLabel("归属范围", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: "线路", exact: true }).last().waitFor();
  await page.getByRole("option", { name: "杆塔", exact: true }).last().click();
  await save();
  await page.getByRole("row").filter({ hasText: "浏览器专用对象" })
    .getByText("杆塔", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "计量单位", exact: true }).click();
  await page.getByRole("button", { name: "新增计量单位", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("件");
  await save();
  await page.getByRole("tab", { name: "操作类型", exact: true }).click();
  await page.getByRole("button", { name: "新增操作类型", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("浏览器安装");
  await select("作业对象", "浏览器专用对象");
  await select("固定计量单位", "件");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("tab", { name: "录入模板", exact: true })
    .click();
  await page.getByLabel("默认验收标准", { exact: true }).fill("安装牢固");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("tab", { name: "附加字段", exact: true })
    .click();
  await page.getByRole("button", { name: "添加现场字段", exact: true }).click();
  await page.getByLabel("字段名称", { exact: true }).fill("测试作业高度");
  await select("录入方式", "数值");
  await page.locator(".el-switch:visible").last().click();
  await save();
  await page.getByRole("menuitem", { name: "专业需求", exact: true }).click();
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await select("操作类型", "浏览器安装");
  await page
    .getByLabel("问题描述", { exact: true })
    .fill("真实动态附加字段验收");
  await page.getByLabel("测试作业高度", { exact: true }).fill("12.5");
  await select("作业设备", "T15");
  await page.getByLabel("来源说明", { exact: true }).fill("浏览器现场记录");
  await page.getByRole("button", { name: "保存需求版本", exact: true }).click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  const demand = s.demands
    .list()
    .find((row) => row.problem_description === "真实动态附加字段验收");
  assert.ok(demand.demand_no.startsWith("XQ-"));
  assert.equal(Object.values(s.demands.get(demand.id).custom_fields)[0], 12.5);
  assert.equal(s.catalog.list("voltages").length, 0);
  assert.equal(s.catalog.list("voltages", true)[0].name, "110千伏");
  // New extra price factors have constrained enum/integer editors.
  await page.getByRole("menuitem", { name: "作业标准与参考价格", exact: true }).click();
  await page.getByRole("tab", { name: "价格特征", exact: true }).click();
  await page.getByRole("button", { name: "新增价格特征", exact: true }).click();
  const factorEditor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
  await factorEditor.getByLabel("名称", { exact: true }).fill("施工难度");
  assert.equal(await factorEditor.getByText("可自动取得的台账事实").count(), 0);
  for (const item of ["普通", "困难"]) {
    await factorEditor.getByPlaceholder("输入选项名称").fill(item);
    await factorEditor.getByRole("button", { name: "添加选项" }).click();
  }
  await save();
  const difficulty = s.catalog.list("factors").find((item) => item.name === "施工难度");
  assert.deepEqual(JSON.parse(difficulty.fields_json).values, ["普通", "困难"]);

  await page.getByRole("button", { name: "新增价格特征", exact: true }).click();
  await factorEditor.getByLabel("名称", { exact: true }).fill("施工高度");
  await factorEditor.getByText("整数", { exact: true }).click();
  await select("计量单位（选填）", "件");
  await factorEditor.getByLabel("最小允许值（选填）").fill("0");
  await factorEditor.getByLabel("最大允许值（选填）").fill("100");
  await save();
  const height = s.catalog.list("factors").find((item) => item.name === "施工高度");
  const heightDefinition = JSON.parse(height.fields_json);
  assert.equal(heightDefinition.min, 0);
  assert.equal(heightDefinition.max, 100);
  assert.ok(heightDefinition.unit_id);

  await page.getByRole("tab", { name: "操作类型", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "浏览器安装" })
    .getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).last().click();
  assert.equal(await factorEditor.getByRole("tab").count(), 4);
  await factorEditor.getByRole("tab", { name: "计价所需信息" }).click();
  await factorEditor.getByRole("button", { name: "添加计价信息" }).click();
  await select("额外价格特征", "施工难度");
  await factorEditor.locator(".el-switch:visible").last().click();
  await save();
  assert.equal(s.catalog.get("operations", s.catalog.list("operations").find(
    (item) => item.name === "浏览器安装").id).version, 2);

  await page.getByRole("tab", { name: "参考价格规则", exact: true }).click();
  await page.getByRole("button", { name: "新增参考价格规则", exact: true }).click();
  assert.deepEqual(await factorEditor.getByRole("tab").allTextContents(),
    ["基本信息", "适用条件", "计价方式"]);
  await factorEditor.getByRole("tab", { name: "适用条件" }).click();
  assert.equal(await factorEditor.getByLabel("适用电压").isVisible(), true);
  await factorEditor.getByRole("tab", { name: "计价方式" }).click();
  assert.equal(await factorEditor.getByLabel("计价模型").isVisible(), true);
  await page.screenshot({
    path: join(output, "price-features-settings-browser.png"),
    fullPage: true,
  });
  await factorEditor.getByRole("button", { name: "取消" }).click();

  assert.deepEqual(errors, []);
  console.log(
    "SCHEMA113_MASTERS_BROWSER_OK master CRUD, inline equipment detail, audited voltage correction, custom operation fields, decimal fact and automatic demand numbering",
  );
} catch (error) {
  await page.screenshot({
    path: join(output, "masters-browser-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
