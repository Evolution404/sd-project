import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [],
  t = { after: (action) => cleanup.push(action) },
  { s } = fixture(t),
  server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const executable = chromium.executablePath();
const browser = await chromium.launch(
  existsSync(executable)
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results", "schema113");
mkdirSync(output, { recursive: true });
async function select(label, option, index = 0) {
  await page.getByLabel(label, { exact: true }).nth(index).click();
  await page.getByRole("option", { name: option, exact: true }).last().click();
}
try {
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "dashboard-1500.png"),
    fullPage: true,
  });
  await selectNavigation(page, "专业需求");
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await select("操作类型", "安装防鸟装置");
  await page.getByLabel("问题描述", { exact: true }).fill("三基塔防鸟装置缺失");
  await select("作业设备", "T15");
  await page.getByRole("spinbutton").nth(0).fill("3");
  await page.getByRole("button", { name: "添加位置", exact: true }).click();
  await select("作业设备", "T16", 1);
  await page.getByRole("spinbutton").nth(1).fill("2");
  await page.getByRole("button", { name: "添加位置", exact: true }).click();
  await select("作业设备", "T17", 2);
  await page.getByRole("spinbutton").nth(2).fill("4");
  await page.getByLabel("来源说明", { exact: true }).fill("现场巡视记录");
  await page.getByRole("button", { name: "保存需求版本", exact: true }).click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  await page
    .getByRole("row")
    .filter({ hasText: "三基塔防鸟装置缺失" })
    .getByRole("button", { name: "查看", exact: true })
    .click();
  await page.getByText("总工作量", { exact: true }).waitFor();
  assert.equal(s.demands.list()[0].quantity_scaled, 90000);
  await page.getByRole("button", { name: "参考价试算", exact: true }).click();
  await page.getByText("完整参考价 ¥480.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "确认正式报价", exact: true }).click();
  await page.getByText("已保存正式参考报价", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭报价", exact: true }).click();
  await page
    .getByRole("dialog", { name: "参考价格" })
    .waitFor({ state: "hidden" });
  await page.locator(".el-overlay:not(.business-detail-overlay):visible").waitFor({ state: "hidden" });
  await page.screenshot({
    path: join(output, "demand-detail-1500.png"),
    fullPage: true,
  });
  for (const width of [1500, 1280, 960, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async () => {
      scrollTo(0, 0);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await page.screenshot({
      path: join(output, `demand-detail-${width}.png`),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `horizontal overflow ${width}`,
    );
  }
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page
    .getByRole("button", { name: "Excel 批量处理", exact: true })
    .click();
  await page.getByRole("button", { name: "空白模板", exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "exchange-760.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  for (const name of [
    "子项目管理",
    "年度框架",
    "执行协议",
    "物资管理",
    "参考价格",
    "基础数据",
    "费用与结算",
    "输电设备台账",
    "作业标准",
    "系统管理",
  ]) {
    const mobileMenu = page.getByRole("button", { name: "打开导航" });
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await selectNavigation(page, name);
    await page.locator("h1").waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `overflow ${name}`,
    );
  }
  const admin = s.auth.login("admin", "Schema113-test-password").user;
  s.auth.saveUser(admin, {
    username: "viewer-browser",
    password: "Viewer-browser-password",
    role: "viewer",
  });
  const readerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const reader = await readerContext.newPage();
  await reader.goto(base);
  await reader.getByLabel("用户名", { exact: true }).fill("viewer-browser");
  await reader
    .getByLabel("密码", { exact: true })
    .fill("Viewer-browser-password");
  await reader.getByRole("button", { name: "登录", exact: true }).click();
  await reader.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  assert.equal(
    await reader
      .getByRole("menuitem", { name: "系统管理", exact: true })
      .count(),
    0,
  );
  await selectNavigation(reader, "专业需求");
  assert.equal(
    await reader
      .getByRole("button", { name: "新增需求", exact: true })
      .isDisabled(),
    true,
  );
  await reader.screenshot({
    path: join(output, "viewer-permissions-1280.png"),
    fullPage: true,
  });
  await readerContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "SCHEMA113_BROWSER_OK login, 3-location demand, 480.00 quote, Excel workbench, 12 modules, 1500/1280/960/760px",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
