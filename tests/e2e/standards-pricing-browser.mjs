import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectNavigation } from "./navigation-helper.mjs";
import { selectFormChoice } from "./field-helper.mjs";
const cleanup = [],
  { s, user, unit, operation, price } = fixture({
    after: (action) => cleanup.push(action),
  });
s.catalog.save(
  user,
  "units",
  { expected_version: 1, name: "套数新版" },
  unit.id,
);
s.standards.saveOperation(
  user,
  { expected_version: 1, name: "新版安装作业" },
  operation.id,
);
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/standards-pricing");
mkdirSync(output, { recursive: true });
async function action(row, name) {
  await row.locator(".cell-link:visible").first().click();
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name, exact: true }).click();
}
async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
try {
  await page.goto(
    `http://127.0.0.1:${server.address().port}/#/standards/operations`,
  );
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const operationRow = page
    .getByRole("row")
    .filter({ hasText: "新版安装作业" });
  await action(operationRow, "编辑");
  const standardEditor = page.getByRole("region", {
    name: "编辑操作类型",
    exact: true,
  });
  await standardEditor.getByRole("tab",{name:"基本定义",exact:true}).click();
  await standardEditor.getByText("套", { exact: true }).waitFor();
  assert.equal(await standardEditor.getByRole("tab").count(), 4);
  assert.equal(await standardEditor.getByRole("tab",{name:"作业范围与计量"}).count(),0);
  await standardEditor.getByLabel("固定计量单位",{exact:true}).waitFor();
  for (const width of [1500, 1280, 960, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    await standardEditor
      .getByRole("tab", { name: "录入模板", exact: true })
      .click();
    await standardEditor.getByLabel("默认部位", { exact: true }).waitFor();
    await settle();
    const button = await standardEditor
      .getByRole("button", { name: "保存", exact: true })
      .boundingBox();
    assert.ok(
      button &&
        button.x >= 0 &&
        button.x + button.width <= width &&
        button.y + button.height <= 1000,
    );
    await page.screenshot({
      path: join(output, `standard-editor-${width}.png`),
      fullPage: true,
    });
  }
  await standardEditor
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await standardEditor.waitFor({ state: "hidden" });
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.getByRole("tab", { name: "作业对象", exact: true }).click();
  await page.getByRole("button", { name: "新增作业对象", exact: true }).click();
  const objectEditor = page.getByRole("region", {
    name: "新增作业对象",
    exact: true,
  });
  await objectEditor.getByLabel("名称", { exact: true }).fill("独立作业对象");
  await selectFormChoice(page, "对象位置", "本体", objectEditor);
  await selectFormChoice(page, "归属单元", "物理杆塔", objectEditor);
  await objectEditor.getByRole("button", { name: "保存", exact: true }).click();
  await objectEditor.waitFor({ state: "hidden" });
  await action(
    page.getByRole("row").filter({ hasText: "独立作业对象" }),
    "删除",
  );
  const confirm = page.locator(".el-message-box:visible");
  await confirm.getByText(/当前有0处正式关联/).waitFor();
  await confirm.getByRole("button", { name: "确定", exact: true }).click();
  await page.locator("main .business-table-grid")
    .getByRole("row")
    .filter({ hasText: "独立作业对象" }).first()
    .waitFor({ state: "hidden" });
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name: "关闭详情", exact: true }).click();
  await selectNavigation(page, "参考价格");
  const priceRow = page.getByRole("row").filter({ hasText: price.title });
  await action(priceRow, "编辑");
  const ruleEditor = page.getByRole("region", {
    name: "编辑参考价格规则",
    exact: true,
  });
  await ruleEditor.getByText("安装防鸟装置", { exact: true }).waitFor();
  await ruleEditor
    .getByRole("button", { name: "采用最新 V2 作业标准", exact: true })
    .click();
  await ruleEditor.getByRole("tab", { name: "计价方式", exact: true }).click();
  await page.setViewportSize({ width: 760, height: 1000 });
  await ruleEditor
    .getByRole("button", { name: "保存前检查", exact: true })
    .click();
  await ruleEditor.getByText("规则完整性检查通过", { exact: true }).waitFor();
  await settle();
  await page.screenshot({
    path: join(output, "price-editor-760.png"),
    fullPage: true,
  });
  await ruleEditor.getByRole("button", { name: "保存", exact: true }).click();
  await ruleEditor.waitFor({ state: "hidden" });
  assert.equal(s.priceRules.get(price.id).operation_version, 2);
  const listUrl = page.url();
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("button", { name: "完整历史", exact: true }).click();
  const history = detail.getByRole("region", { name: "历史记录", exact: true });
  await history.getByRole("button", { name: "对比版本", exact: true }).waitFor();
  await history.getByRole("article", { name: "事项详情" }).getByText("计价方式", { exact: true }).waitFor();
  assert.equal(page.url(), listUrl);
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await action(priceRow, "复制规则");
  const copyEditor = page.getByRole("region", {
    name: "新增参考价格规则",
    exact: true,
  });
  await copyEditor.getByRole("button", { name: "保存", exact: true }).click();
  await copyEditor.waitFor({ state: "hidden" });
  const copied = s.priceRules
    .list()
    .find((rule) => rule.title.endsWith("（副本）"));
  assert.ok(copied && copied.operation_version === 2);
  assert.deepEqual(errors, []);
  console.log(
    "SCHEMA113_STANDARDS_PRICING_BROWSER_OK adopted labels, four widths, explicit upgrade, copy, deletion preview and modal history",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const finish of cleanup.reverse()) finish();
}
