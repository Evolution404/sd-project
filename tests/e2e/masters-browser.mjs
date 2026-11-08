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
    .getByRole("dialog")
    .getByLabel(label, { exact: true })
    .press("ArrowDown");
  await page.getByRole("option", { name: value, exact: true }).last().click();
}
async function save() {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  try {
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 8000 });
  } catch (error) {
    console.error(
      "MASTER_SAVE_STILL_OPEN",
      await page.getByRole("dialog").innerText(),
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
  await page.getByLabel("编码", { exact: true }).fill("UI-110");
  await page.getByLabel("名称", { exact: true }).fill("110kV");
  await save();
  await page
    .getByRole("row")
    .filter({ hasText: "UI-110" })
    .getByRole("button", { name: "查看", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("dialog")
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
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "UI-110" })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByText("暂无数据", { exact: true }).waitFor();
  await page
    .getByRole("menuitem", { name: "作业标准与参考价格", exact: true })
    .click();
  await page.getByRole("tab", { name: "标准作业对象", exact: true }).click();
  await page
    .getByRole("button", { name: "新增标准作业对象", exact: true })
    .click();
  await page.getByLabel("编码", { exact: true }).fill("UI-OBJECT");
  await page.getByLabel("名称", { exact: true }).fill("浏览器专用对象");
  await select("设备对象", "共用物理杆塔");
  await save();
  await page.getByRole("tab", { name: "计量单位", exact: true }).click();
  await page.getByRole("button", { name: "新增计量单位", exact: true }).click();
  await page.getByLabel("编码", { exact: true }).fill("UI-UNIT");
  await page.getByLabel("名称", { exact: true }).fill("件");
  await save();
  await page.getByRole("tab", { name: "操作类型", exact: true }).click();
  await page.getByRole("button", { name: "新增操作类型", exact: true }).click();
  await page.getByLabel("编码", { exact: true }).fill("UI-OP");
  await page.getByLabel("名称", { exact: true }).fill("浏览器安装");
  await select("标准作业对象", "浏览器专用对象");
  await select("固定计量单位", "件");
  await select("设备对象", "共用物理杆塔");
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: "录入模板", exact: true })
    .click();
  await page.getByLabel("默认验收标准", { exact: true }).fill("安装牢固");
  await page
    .getByRole("dialog")
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
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const demand = s.demands
    .list()
    .find((row) => row.problem_description === "真实动态附加字段验收");
  assert.ok(demand.demand_no.startsWith("XQ-"));
  assert.equal(Object.values(s.demands.get(demand.id).custom_fields)[0], 12.5);
  assert.equal(s.catalog.list("voltages").length, 0);
  assert.equal(s.catalog.list("voltages", true)[0].name, "110千伏");
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
