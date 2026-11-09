import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";

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

async function checkHeading(title, expectedButtons, width) {
  await page.setViewportSize({ width, height: 1192 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const layout = await page.locator(".page-heading").evaluate((heading) => {
    const bounds = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    };
    const actions = heading.querySelector(":scope > .page-heading-actions");
    return {
      heading: bounds(heading),
      title: bounds(heading.firstElementChild),
      sections: heading.children.length,
      actions: actions && bounds(actions),
      buttons: [...heading.querySelectorAll(".el-button")]
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map(bounds),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  const context = `${title} ${width}px ${JSON.stringify(layout)}`;
  if (title === "输电设备台账" && width === 2524)
    console.log(
      "HEADING_ACTION_GAP_PX",
      layout.buttons[1].left - layout.buttons[0].right,
    );
  assert.ok(!layout.overflow, context);
  assert.equal(layout.buttons.length, expectedButtons, context);
  assert.ok(layout.sections <= 2, context);
  if (!expectedButtons) return;
  assert.ok(layout.actions, context);
  assert.ok(
    layout.title.right <= layout.actions.left + 1 ||
      layout.title.bottom <= layout.actions.top + 1,
    context,
  );
  for (const [index, button] of layout.buttons.entries()) {
    assert.ok(button.left >= layout.actions.left - 1, context);
    assert.ok(button.right <= layout.actions.right + 1, context);
    assert.ok(button.right <= layout.heading.right + 1, context);
    if (!index) continue;
    const previous = layout.buttons[index - 1];
    if (Math.abs(button.top - previous.top) <= 1) {
      const gap = button.left - previous.right;
      assert.ok(gap >= 8 && gap <= 12, context);
      assert.ok(Math.abs(button.bottom - previous.bottom) <= 1, context);
    } else {
      assert.ok(button.top >= previous.bottom + 8, context);
    }
  }
  const last = layout.buttons.at(-1);
  if (width > 900)
    assert.ok(Math.abs(last.right - layout.heading.right) <= 1, context);
  else
    assert.ok(
      Math.abs(layout.buttons[0].left - layout.heading.left) <= 1,
      context,
    );
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
  for (const [title, button, expectedButtons] of [
    ["输电设备台账", "新增线路", 2],
    ["专业需求", "新增需求", 2],
    ["年度框架与子项目", "新增子项目", 1],
    ["执行协议与资金", "新增年度框架", 1],
    ["实际费用与结算", null, 0],
    ["作业标准与参考价格", "新增操作类型", 1],
    ["系统管理", "新增", 1],
  ]) {
    if (await page.getByRole("button", { name: "打开导航" }).isVisible())
      await page.getByRole("button", { name: "打开导航" }).click();
    await page.getByRole("menuitem", { name: title, exact: true }).last().click();
    await page
      .getByRole("heading", {
        name: title === "执行协议与资金" ? "年度框架、协议与组织" : title,
        exact: true,
      })
      .waitFor();
    if (button)
      await page.getByRole("button", { name: button, exact: true }).waitFor();
    for (const width of [2524, 1920, 1500, 1280, 960, 760, 360]) {
      await checkHeading(title, expectedButtons, width);
      if (title === "输电设备台账" && [2524, 760].includes(width))
        await page.screenshot({
          path: join(output, `heading-actions-${width}.png`),
          fullPage: true,
        });
    }
    console.log("HEADING_LAYOUT_PAGE_OK", title);
    if (title === "输电设备台账") {
      const actions = page.locator(".page-heading-actions");
      await actions.evaluate((group) => (group.style.width = "160px"));
      await checkHeading("受限操作区换行", 2, 760);
      const buttons = actions.locator(":scope > .el-button");
      const first = await buttons.nth(0).boundingBox();
      const second = await buttons.nth(1).boundingBox();
      assert.ok(second.y >= first.y + first.height + 8);
      assert.ok(Math.abs(second.x - first.x) <= 1);
      await actions.evaluate((group) => group.style.removeProperty("width"));
      await page.getByRole("tab", { name: "电压等级", exact: true }).click();
      await page
        .getByRole("button", { name: "新增电压等级", exact: true })
        .waitFor();
      await checkHeading(title, 1, 1500);
      await page.getByRole("tab", { name: "线路", exact: true }).click();
      await page
        .getByRole("button", { name: "Excel 批量处理", exact: true })
        .click();
      await page
        .getByRole("dialog", {
          name: "设备台账 Excel（线路／物理杆塔／逻辑杆塔／档距）", exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "HEADING_LAYOUT_BROWSER_OK 7 modules, 7 widths, grouped actions, 10px spacing, alignment, wrap and Excel dialog",
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
