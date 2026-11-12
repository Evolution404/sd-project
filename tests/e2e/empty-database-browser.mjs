import {addOperationAttribute} from "./field-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";

const root = mkdtempSync(join(tmpdir(), "sd113-empty-browser-"));
const s = createSystem(join(root, "data"));
assert.equal(s.catalog.list("units").length, 0);
assert.equal(s.catalog.list("operations").length, 0);
assert.equal(s.catalog.list("lines").length, 0);
assert.equal(s.demands.list().length, 0);
assert.equal(s.projects.list().length, 0);
s.auth.initialize("admin", "Fresh-Browser-Test-Password");
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const out = join(process.cwd(), "test-results/schema113/empty-database");
mkdirSync(out, { recursive: true });
const dialog = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
async function visit(path) {
  await page.goto(base + "/#/" + path);
  await page.locator("main h1").waitFor();
  await page.waitForLoadState("networkidle");
}
async function save() {
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 13000 });
}
async function select(label, option) {
  await dialog.getByLabel(label, { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: option, exact: true }).last().click();
}
async function audit(name, width) {
  await page.setViewportSize({ width, height: 780 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const issues = await page.locator("main").evaluate((main) => {
    const out = [], rect = main.getBoundingClientRect();
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push("full-page horizontal overflow");
    for (const button of main.querySelectorAll(".el-button")) {
      if (button.closest(".el-table") || button.closest(".el-tabs__nav-scroll")) continue;
      const b = button.getBoundingClientRect();
      if (b.width && (b.left < rect.left - 1 || b.right > rect.right + 1))
        out.push("button clipped: " + button.textContent);
    }
    for (const header of main.querySelectorAll(".business-column-title"))
      if (header.clientWidth && header.scrollWidth > header.clientWidth + 1)
        out.push("column header clipped: " + header.textContent);
    return out;
  });
  assert.deepEqual(issues, [], name + "/" + width);
  if ([1500, 760].includes(width))
    await page.screenshot({ path: join(out, name.replaceAll("/", "-") + "-" + width + ".png"), fullPage: true });
}
async function auditOpenDialog(name, width) {
  await page.setViewportSize({ width, height: 760 });
  await dialog.locator(".el-dialog").waitFor();
  // Wait until the Element Plus opening transition has finished before
  // measuring/photographing geometry; transitional frames are not layout bugs.
  await page.waitForTimeout(300);
  const bounds = await dialog.locator(".el-dialog").evaluate((node) => {
    const d = node.getBoundingClientRect();
    const footer = node.querySelector(".el-dialog__footer")?.getBoundingClientRect();
    return { top: d.top, bottom: d.bottom, left: d.left, right: d.right,
      footerTop: footer?.top || 1, footerBottom: footer?.bottom || 0,
      viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(bounds.top >= -1 && bounds.bottom <= bounds.viewportHeight + 1 &&
    bounds.left >= -1 && bounds.right <= bounds.viewportWidth + 1 &&
    bounds.footerBottom <= bounds.viewportHeight + 1 &&
    bounds.footerTop > 0,
    name + " " + width + ": " + JSON.stringify(bounds));
  await page.screenshot({
    path: join(out, "dialog-" + name + "-" + width + ".png"), fullPage: true,
  });
}
try {
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Fresh-Browser-Test-Password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();

  const routes = ['dashboard', 'demands', 'projects', 'frameworks', 'agreements', 'finance', 'ledger', 'materials', 'standards', 'pricing', 'dictionaries', 'system'];
  for (const path of routes) {
    await visit(path);
    for (const width of [1500, 1280, 960, 760])
      await audit("empty-" + path, width);
  }
  const dialogs = [
    ["ledger", "新增线路"],
    ["standards", "新增操作类型"],
    ["standards/objects", "新增作业对象"],
    ["pricing/prices", "新增参考价格规则"],
    ["demands", "新增需求"],
    ["projects", "新增子项目"],
  ];
  for (const [path, title] of dialogs) {
    await visit(path);
    await page.getByRole("button", { name: title, exact: true }).click();
    for (const width of [1500, 760]) await auditOpenDialog(path.replace("/", "-"), width);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  await visit("dictionaries/units");
  await page.getByRole("button", { name: "新增计量单位", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("套");
  await save();
  assert.equal(s.catalog.list("units").length, 1);

  await visit("standards/objects");
  await page.getByRole("button", { name: "新增作业对象", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("防鸟装置");
  await select("对象位置", "本体");
  await select("归属单元", "物理杆塔");
  await save();

  await visit("standards/operations");
  await page.getByRole("button", { name: "新增操作类型", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("安装防鸟装置");
  await select("作业对象", "防鸟装置");
  await select("固定计量单位", "套");
  await dialog.getByRole("tab", { name: "录入模板" }).click();
  await dialog.getByLabel("默认验收标准", { exact: true }).fill("安装牢固");
  await addOperationAttribute(page,{label:"施工难度",type:"单选",options:["普通","困难"],pricing:true,requirement:"计价必需"});
  await auditOpenDialog("operation-price-features", 760);
  await save();
  assert.equal(s.catalog.list("operations").length, 1);

  await visit("pricing/prices");
  await page.getByRole("button", { name: "新增参考价格规则", exact: true }).click();
  await dialog.getByLabel("规则名称", { exact: true }).fill("空库普通施工参考价");
  await select("操作类型", "安装防鸟装置");
  await dialog.getByLabel("价格来源", { exact: true }).fill("现场测试");
  await dialog.getByLabel("价格日期", { exact: true }).fill("2026-01-01");
  await dialog.getByLabel("生效日期", { exact: true }).fill("2026-01-01");
  await dialog.getByLabel("计价依据", { exact: true }).fill("验收依据");
  await dialog.getByRole("tab", { name: "计价方式" }).click();
  await dialog.getByLabel("单价/固定价", { exact: true }).fill("30");
  await dialog.getByRole("button", { name: "保存前检查" }).click();
  await dialog.getByText("规则完整性检查通过").waitFor();
  await dialog.getByText("试算金额：¥30.00", { exact: false }).waitFor();
  await auditOpenDialog("price-rule-precheck", 760);
  await save();
  assert.equal(s.catalog.list("prices").length, 1);
  // From a genuinely empty database, exercise the visible copy/edit/delete
  // commands rather than relying solely on application service tests.
  const originalRule = s.catalog.list("prices")[0];
  const ruleRow = page.getByRole("row").filter({ hasText: "空库普通施工参考价" });
  await ruleRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "复制规则", exact: true }).last().click();
  await dialog.getByRole("button", { name: "保存前检查" }).click();
  await dialog.getByText("存在可能重叠的参考价格规则").waitFor();
  await save();
  const copiedRule = s.catalog.list("prices").find((row) =>
    row.title.endsWith("（副本）"));
  assert.ok(copiedRule && copiedRule.id !== originalRule.id);
  await page.getByRole("row").filter({ hasText: "（副本）" })
    .getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).last().click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  assert.equal(s.catalog.list("prices").length, 1);
  assert.equal(s.catalog.get("prices", copiedRule.id, true).deleted, true);

  await visit("dictionaries/priorities");
  await page.getByRole("button", { name: "新增优先级", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("空库临时优先级");
  await save();
  const priority = s.catalog.list("priorities")[0];
  assert.equal(priority.name, "空库临时优先级");
  await page.getByRole("row").filter({ hasText: "空库临时优先级" })
    .getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).last().click();
  await dialog.getByLabel("名称", { exact: true }).fill("空库已修订优先级");
  await save();
  assert.equal(s.catalog.get("priorities", priority.id).version, 2);
  await page.getByRole("row").filter({ hasText: "空库已修订优先级" })
    .getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).last().click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  assert.equal(s.catalog.list("priorities").length, 0);
  assert.equal(s.catalog.get("priorities", priority.id, true).deleted, true);

  assert.deepEqual(errors, []);
  console.log("EMPTY_DATABASE_BROWSER_OK 12 zero-data modules, 4 widths, 7 empty dialogs, UI master creation/edit/delete, price copy, overlap preview");
} catch (error) {
  console.log("EMPTY_DATABASE_BROWSER_ERRORS", errors);
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  s.close();
  rmSync(root, { recursive: true, force: true });
}
