import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s } = fixture({ after: (action) => cleanup.push(action) });
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: 2524, height: 1192 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });

async function checkHeading(title, createLabel, width) {
  await page.setViewportSize({ width, height: 1192 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const heading = page.locator("main .page-heading:visible").first();
  assert.equal(await heading.locator(".el-button").count(), 0, title + " moves list actions into the table toolbar");
  const toolbar = page.locator("main .unified-list-tools:visible").first();
  await toolbar.getByRole("button", { name: "列设置", exact: true }).waitFor();
  await toolbar.getByRole("button", { name: "刷新", exact: true }).waitFor();
  if (createLabel) {
    const action = toolbar.getByRole("button", { name: createLabel, exact: true });
    await action.waitFor();
    const box = await action.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, title + " " + width);
    assert.equal(await toolbar.locator(".el-button--primary:visible").count(), 1, title);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, title + " " + width);
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  // Start with the reported regression so the old production build fails here.
  for (const [title, button] of [
    ["输电设备台账", "新增线路"],
    ["专业需求", "新增需求"],
    ["子项目管理", "新增子项目"],
    ["年度框架", "新增年度框架"],
    ["执行协议", "新增执行协议"],
    ["物资管理", "新增物资"],
    ["参考价格", "新增参考价格规则"],
    ["基础数据", "新增电压等级"],
    ["费用与结算", null],
    ["作业标准", "新增操作类型"],
    ["系统管理", "新增用户"],
  ]) {
    if (await page.getByRole("button", { name: "打开导航" }).isVisible())
      await page.getByRole("button", { name: "打开导航" }).click();
    await selectNavigation(page, title);
    await page
      .getByRole("heading", {
        name: title === "年度框架" ? "年度框架" : title,
        exact: true,
      })
      .waitFor();
    if (button)
      await page.getByRole("button", { name: button, exact: true }).waitFor();
    for (const width of [2524, 1920, 1500, 1280, 960, 760, 360]) {
      await checkHeading(title, button, width);
      if (title === "输电设备台账" && [2524, 760].includes(width))
        await page.screenshot({
          path: join(output, `heading-actions-${width}.png`),
          fullPage: true,
        });
    }
    console.log("HEADING_LAYOUT_PAGE_OK", title);
    if (title === "输电设备台账") {
      await selectNavigation(page, "输电设备台账");
      await page.getByRole("tab", { name: "线路", exact: true }).click();
      await page
        .getByRole("button", { name: "导入 Excel", exact: true })
        .click();
      await page
        .getByRole("dialog", {
          name: "导入 Excel", exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "HEADING_LAYOUT_BROWSER_OK 11 modules, 7 widths, one list toolbar, one primary action and Excel dialog",
  );
} catch (error) {
  await page.screenshot({
    path: join(output, "heading-layout-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
