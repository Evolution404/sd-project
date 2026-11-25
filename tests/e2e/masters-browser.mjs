import {addOperationAttribute,chooseDemandLocations} from "./field-helper.mjs";
import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [],
  { s } = fixture({ after: (action) => cleanup.push(action) }),
  server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
    existsSync(chromium.executablePath())
      ? { headless: true }
      : { headless: true, channel: "chrome" },
  ),
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });
async function select(label, value) {
  await page
    .locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByLabel(label, { exact: true })
    .press("ArrowDown");
  await page.getByRole("option", { name: value, exact: true }).last().click();
}
async function save() {
  await page
    .locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  try {
    await page.locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden", timeout: 8000 });
  } catch (error) {
    console.error(
      "MASTER_SAVE_STILL_OPEN",
      await page.locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").innerText(),
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
  await selectNavigation(page, "输电设备台账");
  await selectNavigation(page, "基础数据");
  await page.getByRole("tab", { name: "电压等级", exact: true }).click();
  await page.getByRole("button", { name: "新增电压等级", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("110kV");
  await save();
  await page
    .getByRole("row")
    .filter({ hasText: "110kV" })
    .locator(".cell-link:visible").first()
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByLabel("名称", { exact: true })
    .fill("110千伏");
  await save();
  await page.getByRole("heading", { name: "110千伏", exact: true }).waitFor();
  await page.getByRole("button", { name: "完整历史", exact: true }).click();
  await page
    .getByRole("heading", { name: "完整版本与审计历史", exact: true })
    .waitFor();
  const history = page.getByRole("region", { name: "历史记录", exact: true });
  const event = history.getByRole("article", { name: "事项详情" });
  await event.getByRole("heading", { name: "修订电压等级", exact: true }).waitFor();
  await event.getByText("110kV", { exact: true }).waitFor();
  await history.getByRole("button", { name: /新增电压等级/ }).click();
  await event.getByRole("heading", { name: "新增电压等级", exact: true }).waitFor();
  assert.equal(await page.locator("pre.data-json").count(), 0);
  await page.screenshot({
    path: join(output, "ledger-detail-1500.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByText("暂无记录", { exact: true }).waitFor();
  await selectNavigation(page, "作业标准");
  await page.getByRole("tab", { name: "作业对象", exact: true }).click();
  await page
    .getByRole("button", { name: "新增作业对象", exact: true })
    .click();
  await page.getByLabel("名称", { exact: true }).fill("浏览器专用对象");
  await select("对象位置", "本体");
  await select("归属单元", "物理杆塔");
  await save();
  await page.getByRole("row").filter({ hasText: "浏览器专用对象" })
    .getByText("物理杆塔", { exact: true }).waitFor();
  await page.getByRole("row").filter({ hasText: "浏览器专用对象" })
    .getByText("本体", { exact: true }).waitFor();
  await selectNavigation(page, "基础数据");
  await page.getByRole("tab", { name: "计量单位", exact: true }).click();
  await page.getByRole("button", { name: "新增计量单位", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("件");
  await save();
  await selectNavigation(page, "作业标准");
  await page.getByRole("tab", { name: "操作类型", exact: true }).click();
  await page.getByRole("button", { name: "新增操作类型", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("浏览器安装");
  await select("作业对象", "浏览器专用对象");
  await select("固定计量单位", "件");
  await page
    .locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("tab", { name: "录入模板", exact: true })
    .click();
  await page.getByLabel("默认验收标准", { exact: true }).fill("安装牢固");
  await addOperationAttribute(page,{label:"测试作业高度",type:"小数",scope:"需求级",precision:2,requirement:"保存必填"});
  await save();
  await selectNavigation(page, "专业需求");
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await select("操作类型", "浏览器安装");
  await page
    .getByLabel("问题描述", { exact: true })
    .fill("真实动态附加字段验收");
  await page.getByLabel("测试作业高度", { exact: true }).fill("12.5");
  await chooseDemandLocations(page,["T15"]);
  await page.getByLabel("来源说明", { exact: true }).fill("浏览器现场记录");
  await page.getByRole("button", { name: "保存需求版本", exact: true }).click();
  await page.locator(".business-work-surface:visible:not(.business-detail-page), .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  const demand = s.demands
    .list()
    .find((row) => row.problem_description === "真实动态附加字段验收");
  assert.ok(demand.demand_no.startsWith("XQ-"));
  assert.equal(Object.values(s.demands.get(demand.id).attributes)[0], "12.5");
  assert.equal(s.catalog.list("voltages").length, 0);
  assert.equal(s.catalog.list("voltages", true)[0].name, "110千伏");
  // Saving now opens the demand's next-step workspace; close it before leaving
  // for administrative price-factor setup instead of clicking behind a modal.
  await page.locator(".business-detail-dialog:visible")
    .getByRole("heading", { name: /真实动态附加字段验收/ }).waitFor();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.locator(".business-detail-dialog:visible").waitFor({ state: "hidden" });
  await selectNavigation(page,"作业标准");
  await page.getByRole("tab",{name:"操作类型",exact:true}).click();
  await page.getByRole("row").filter({hasText:"浏览器安装"}).locator(".cell-link:visible").first().click();
  await page.locator(".business-detail-dialog:visible").getByRole("button",{name:"编辑",exact:true}).click();
  const factorEditor=page.getByRole("region",{name:"编辑操作类型",exact:true});
  await factorEditor.getByRole("tab", { name: "基本定义", exact: true }).waitFor();
  assert.equal(await factorEditor.getByRole("tab").count(),4);
  await addOperationAttribute(page,{label:"施工难度",type:"单选",options:["普通","困难"],pricing:true,requirement:"计价必需"});
  await addOperationAttribute(page,{label:"施工高度",type:"整数",precision:0,min:0,max:100,pricing:true});
  await save();
  const configured=s.catalog.list("operations").find(item=>item.name==="浏览器安装");
  assert.equal(configured.version,2);
  const definitions=JSON.parse(configured.attributes_schema_json);
  assert.equal(definitions.find(field=>field.label==="施工难度").pricing,true);
  assert.equal(definitions.find(field=>field.label==="施工高度").max,"100");
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name:"关闭详情", exact:true }).click();
  await selectNavigation(page, "参考价格");
  await page.getByRole("button", { name: "新增参考价格规则", exact: true }).click();
  const priceEditor=page.getByRole("region",{name:"新增参考价格规则",exact:true});
  await priceEditor.waitFor();
  assert.deepEqual(await priceEditor.getByRole("tab").allTextContents(),
    ["基本信息", "适用条件", "计价方式"]);
  await priceEditor.getByRole("tab", { name: "适用条件" }).click();
  assert.equal(await priceEditor.getByLabel("适用电压").isVisible(), true);
  await priceEditor.getByRole("tab", { name: "计价方式" }).click();
  assert.equal(await priceEditor.getByLabel("计价模型").isVisible(), true);
  await page.screenshot({
    path: join(output, "price-features-settings-browser.png"),
    fullPage: true,
  });
  await priceEditor.getByRole("button", { name: "取消" }).click();

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
