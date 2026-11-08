import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";
const cleanup = [],
  { s, user, save, demandInput } = fixture({
    after: (action) => cleanup.push(action),
  }),
  demand = s.demands.save(user, demandInput);
s.demands.transition(user, demand.id, {
  expected_version: 1,
  expected_event_seq: 1,
  status: "active",
});
save("frameworks", {
  code: "F-BROWSER",
  name: "浏览器验收框架",
  fiscal_year: 2026,
  limit_fen: 10000000,
});
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
    existsSync(chromium.executablePath())
      ? { headless: true }
      : { headless: true, channel: "chrome" },
  ),
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = join(process.cwd(), "test-results", "schema113");
mkdirSync(output, { recursive: true });
async function select(label, option) {
  await page
    .getByRole("dialog")
    .getByLabel(label, { exact: true })
    .press("ArrowDown");
  await page.getByRole("option", { name: option, exact: true }).last().click();
}
async function confirm() {
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.locator(".el-message-box").waitFor({ state: "hidden" });
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
    .getByRole("menuitem", { name: "年度框架与子项目", exact: true })
    .click();
  await page.getByRole("button", { name: "新增子项目", exact: true }).click();
  await page
    .getByLabel("项目编码（留空自动生成）", { exact: true })
    .fill("P-BROWSER");
  await page.getByLabel("项目名称", { exact: true }).fill("浏览器完整流程项目");
  await select("年度框架", "浏览器验收框架");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("row")
    .filter({ hasText: "P-BROWSER" })
    .getByRole("button", { name: "进入项目" })
    .click();
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await confirm();
  await page.getByRole("button", { name: "关联需求", exact: true }).click();
  await select("专业需求", "D001 · 防鸟设施缺失");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "编制立项范围", exact: true }).click();
  await page.getByLabel("批准预算（元）", { exact: true }).fill("1200");
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: "T17" })
    .locator(".el-checkbox")
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "按承接范围核价", exact: true })
    .click();
  await page.getByText("完整参考价 ¥300.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "确认正式报价", exact: true }).click();
  await page.getByText("已保存正式参考报价", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭报价", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "正式批准", exact: true }).click();
  await confirm();
  await page.getByRole("tab", { name: "费用与结算", exact: true }).click();
  await page.getByRole("button", { name: "新增科目", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("名称", { exact: true })
    .fill("人工费");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "核定费用", exact: true }).click();
  await page.getByLabel("费用事项", { exact: true }).fill("浏览器真实费用");
  await select("末级费用科目", "人工费");
  await page.getByLabel("实际金额（元）", { exact: true }).fill("1400");
  await page.getByLabel("费用凭据", { exact: true }).fill("合成验收发票记录");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  for (const [index, resolved] of [2, 3, 0].entries()) {
    await page
      .getByRole("button", { name: "新增结算草稿", exact: true })
      .click();
    await page
      .getByLabel("结算编号（留空自动生成）", { exact: true })
      .fill("BROWSER-JS" + (index + 1));
    await select("费用科目", "人工费");
    await select("关联需求（共同费用可不选）", "D001");
    await page.getByLabel("本次金额（元）", { exact: true }).fill("400");
    await page.getByLabel("依据", { exact: true }).fill("本期结算依据");
    await page
      .getByRole("button", { name: "添加解决需求", exact: true })
      .click();
    await select("项目需求", "D001");
    await page
      .getByLabel("本次新增解决量", { exact: true })
      .fill(String(resolved));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存草稿", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const row = page
      .getByRole("row")
      .filter({ hasText: "BROWSER-JS" + (index + 1) });
    await row.getByRole("button", { name: "正式提交", exact: true }).click();
    await confirm();
    await row.getByRole("button", { name: "批准", exact: true }).click();
    await confirm();
  }
  const project = s.projects.list().find((p) => p.code === "P-BROWSER");
  assert.equal(s.finance.summary(project.id).settlement_fen, 120000);
  assert.equal(
    s.finance.summary(project.id).demands[0].resolved_quantity_scaled,
    50000,
  );
  await page.screenshot({
    path: join(output, "project-finance-1500.png"),
    fullPage: true,
  });
  for (const width of [1280, 760]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(async () => {
      scrollTo(0, 0);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `finance overflow ${width}`,
    );
    await page.screenshot({
      path: join(output, `project-finance-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "审核结项", exact: true }).click();
  await confirm();
  assert.equal(s.projects.get(project.id).status, "closed");
  assert.deepEqual(errors, []);
  console.log(
    "SCHEMA113_PROJECT_BROWSER_OK project creation, scope5, price300, budget1200, actual1400, 3 settlements, resolved5, financial-only third installment and close",
  );
} catch (error) {
  await page.screenshot({
    path: join(output, "project-browser-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
