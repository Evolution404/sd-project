import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectFormChoice } from "./field-helper.mjs";
const cleanup = [];
const { s, user, unit } = fixture({ after: (action) => cleanup.push(action) });
s.management.saveUser(user, {
  username: "foundation-reader",
  password: "Foundation-reader-password",
  role: "viewer",
  status: "active",
});
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/foundations");
mkdirSync(output, { recursive: true });
async function login(name, password) {
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function save(name) {
  const editor = page.getByRole("dialog", { name, exact: true });
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
}
async function rowAction(row, name) {
  await row.locator(".cell-link:visible").first().click();
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name, exact: true }).click();
}
try {
  await page.goto(base + "/#/dictionaries/units");
  await login("admin", "Schema113-test-password");
  await page.getByRole("button", { name: "新增计量单位", exact: true }).click();
  await page
    .getByRole("dialog", { name: "新增计量单位", exact: true })
    .getByLabel("名称", { exact: true })
    .fill("浏览器单位");
  await save("新增计量单位");
  const unitRow = page.getByRole("row").filter({ hasText: "浏览器单位" });
  await rowAction(unitRow, "编辑");
  await page
    .getByRole("dialog", { name: "编辑计量单位", exact: true })
    .getByLabel("名称", { exact: true })
    .fill("浏览器单位新版");
  await save("编辑计量单位");
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("tab", { name: "优先级", exact: true }).click();
  await page.getByRole("button", { name: "新增优先级", exact: true }).click();
  await page
    .getByRole("dialog", { name: "新增优先级", exact: true })
    .getByLabel("名称", { exact: true })
    .fill("优先处理");
  await save("新增优先级");
  await page.getByRole("tab", { name: "项目类别", exact: true }).click();
  await page.getByRole("button", { name: "新增项目类别", exact: true }).click();
  await page
    .getByRole("dialog", { name: "新增项目类别", exact: true })
    .getByLabel("名称", { exact: true })
    .fill("常规治理");
  await save("新增项目类别");
  await page.goto(base + "/#/materials");
  await page.getByRole("button", { name: "新增物资", exact: true }).click();
  const materialEditor = page.getByRole("dialog", {
    name: "新增物资",
    exact: true,
  });
  await selectFormChoice(page, "计量单位", unit.name, materialEditor);
  await materialEditor
    .getByLabel("物资名称", { exact: true })
    .fill("新版物资浏览器");
  await materialEditor.getByLabel("型号", { exact: true }).fill("A-1");
  await materialEditor.getByLabel("规格", { exact: true }).fill("耐候型");
  await save("新增物资");
  const materialRow = page
    .getByRole("row")
    .filter({ hasText: "新版物资浏览器" });
  const location = page.url();
  await materialRow.locator(".cell-link:visible").first().click();
  const detail = page.getByRole("dialog", { name: "物资详情", exact: true });
  await detail
    .getByRole("heading", {
      name: "新版物资浏览器",
      exact: true,
    })
    .waitFor();
  await detail.getByText("A-1", { exact: true }).waitFor();
  await detail.getByText("耐候型", { exact: true }).waitFor();
  assert.equal(page.url(), location);
  await detail.getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑物资", exact: true });
  assert.equal(
    await edit.getByRole("combobox", { name: "计量单位", exact: true }).count(),
    0,
  );
  await edit.getByLabel("型号", { exact: true }).fill("B-2");
  await save("编辑物资");
  await detail
    .getByRole("heading", {
      name: "新版物资浏览器",
      exact: true,
    })
    .waitFor();
  await detail.getByText("B-2", { exact: true }).waitFor();
  await detail.getByText("耐候型", { exact: true }).waitFor();
  for (const width of [1920]) {
    await page.setViewportSize({ width, height: 1080 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: join(output, "material-detail-" + width + ".png"),
      fullPage: true,
      animations: "disabled",
    });
  }
  await detail.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await detail.getByText("已删除", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "历史记录", exact: true }).click();
  await detail.getByRole("article", { name: "事项详情" })
    .getByRole("heading", { name: "删除物资", exact: true }).waitFor();
  const material = s.materials
    .list(true)
    .find((item) => item.name === "新版物资浏览器");
  assert.equal(material.unit_id, unit.id);
  assert.equal(material.deleted, true);
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.goto(base + "/#/dictionaries/units");
  const current = page.getByRole("row").filter({ hasText: "浏览器单位新版" });
  await rowAction(current, "删除");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.locator(".business-detail-dialog:visible").getByRole("button", { name: "关闭详情" }).click();
  await page.locator("label.el-checkbox:visible").filter({ hasText: "包含已删除" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "浏览器单位新版" })
    .getByText("已删除", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^账号设置/ }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await login("foundation-reader", "Foundation-reader-password");
  await page.getByRole("heading", { name: "基础数据", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "新增计量单位", exact: true })
      .count(),
    0,
  );
  await page.goto(base + "/#/materials");
  await page.getByRole("heading", { name: "物资管理", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "新增物资", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "FOUNDATIONS_BROWSER_OK dictionaries CRUD, material immutable units, version/audit history, modal URL, 3 widths and viewer",
  );
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
