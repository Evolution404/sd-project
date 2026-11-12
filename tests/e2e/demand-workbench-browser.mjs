import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixture, attribute } from "../helpers.mjs";
import { selectFormChoice, chooseDemandLocations } from "./field-helper.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [];
const { s, user, save, unit } = fixture({ after: (fn) => cleanup.push(fn) });
const voltage = save("voltages", { name: "220kV" }),
  line = save("lines", { name: "防鸟批量甲线", voltage_level_id: voltage.id }),
  other = save("lines", { name: "防鸟批量乙线", voltage_level_id: voltage.id });
for (const [index, value] of Array.from(
  { length: 24 },
  (_, index) => index + 1,
).entries())
  save("towers", {
    line_id: index < 20 ? line.id : other.id,
    tower_no: String(value),
  });
const object = save("objects", {
  name: "线路侧防鸟装置",
  object_position: "body", attribution_unit: "logical_tower",
});
const fields = [
  attribute({
    key: "reason",
    label: "治理分类",
    scope: "demand",
    requirement: "save",
    pricing: false,
  }),
  attribute({
    key: "bird",
    label: "鸟害等级",
    requirement: "save",
    pricing: false,
  }),
];
const operation = save("operations", {
  name: "批量安装防鸟刺",
  work_object_id: object.id,
  default_unit_id: unit.id,
  completion_standard: "安装牢固，符合现场验收要求",
  attributes_schema_json: fields,
});
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  }),
  page = await context.newPage(),
  failures = [];
page.on("pageerror", (error) => failures.push(error.message));
const output = join(process.cwd(), "test-results/dux/workbench");
mkdirSync(output, { recursive: true });
const editor = page.getByRole("dialog", { name: "新增专业需求", exact: true });
try {
  await page.goto("http://127.0.0.1:" + server.address().port + "/#/demands");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await selectFormChoice(page, "操作类型", operation.name, editor);
  await editor
    .getByLabel("问题描述", { exact: true })
    .fill("两条线路24处位置的防鸟设施缺失");
  await selectFormChoice(page, "治理分类", "普通", editor);
  await editor
    .getByRole("button", { name: "添加作业位置", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "添加作业位置",
    exact: true,
  });
  const lineInput = picker.locator(".picker-filters .el-select").first();
  await lineInput.click();
  await page
    .getByRole("option", { name: /防鸟批量甲线/ })
    .last()
    .click();
  await picker
    .getByRole("button", { name: "全选筛选结果", exact: true })
    .click();
  await picker
    .getByText("已选择 20 处，可切换线路继续选择。", { exact: true })
    .waitFor();
  await lineInput.click();
  await page
    .getByRole("option", { name: /防鸟批量乙线/ })
    .last()
    .click();
  await picker.getByText("粘贴杆号清单或连续区间", { exact: true }).click();
  await picker
    .getByPlaceholder("12、13、18-25（按真实台账逐项匹配）")
    .fill("21、22-24、24、99");
  await picker.getByRole("button", { name: "匹配并选择", exact: true }).click();
  await picker
    .getByText("已选择 24 处，可切换线路继续选择。", { exact: true })
    .waitFor();
  assert.ok(await picker.getByText("清单重复", { exact: true }).count());
  assert.ok(
    await picker
      .getByText("台账不存在或位置类型不适用", { exact: true })
      .count(),
  );
  await picker
    .getByRole("button", { name: "添加已选位置", exact: true })
    .click();
  await editor
    .getByRole("tab", { name: "作业位置与工作量", exact: true })
    .click();
  const workbench = editor.locator(".business-table").first();
  await workbench
    .locator(".el-table__header-wrapper .el-checkbox")
    .first()
    .click();
  await editor
    .getByRole("button", { name: "批量填写共同信息", exact: true })
    .click();
  const batch = page.getByRole("dialog", {
    name: "批量填写共同信息",
    exact: true,
  });
  await batch.getByText("需求数量", { exact: true }).click();
  await batch.locator(".el-form-item input").first().fill("3");
  await batch
    .locator(".el-checkbox-group .el-checkbox")
    .filter({ hasText: "鸟害等级" })
    .click();
  await selectFormChoice(page, "鸟害等级", "普通", batch);
  await batch
    .getByRole("button", { name: "应用到选中位置", exact: true })
    .click();
  const firstRow = workbench.locator(".el-table__body-wrapper tr").first();
  await firstRow.getByRole("button", { name: "编辑", exact: true }).click();
  const locationEditor = page.getByRole("dialog", {
    name: "编辑作业位置",
    exact: true,
  });
  await selectFormChoice(page, "鸟害等级", "困难", locationEditor);
  await locationEditor
    .getByRole("button", { name: "完成", exact: true })
    .click();
  // Remove an adjacent row and check the edited row keeps its own field values.
  await workbench
    .locator(".el-table__body-wrapper tr")
    .nth(1)
    .getByRole("button", { name: "移除", exact: true })
    .click();
  for (const theme of ["浅色", "深色"]) {
    await page.evaluate(
      (theme) =>
        document.documentElement.classList.toggle("dark", theme === "深色"),
      theme,
    );
    for (const width of [1500, 1280, 960, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      await editor.getByRole("tab", {name:"作业位置与工作量",exact:true}).click();
      await page.waitForTimeout(350);
      await workbench.locator(".el-scrollbar__wrap").evaluateAll(elements => elements.forEach(element => { element.scrollTop=0; element.scrollLeft=0; }));
      const rect = await editor.boundingBox();
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1);
      const saveButton = await editor
        .getByRole("button", { name: "保存需求版本", exact: true })
        .boundingBox();
      assert.ok(saveButton && saveButton.y + saveButton.height <= 1000);
      await page.screenshot({
        path: join(output, theme + "-" + width + ".png"),
        fullPage: true,
      });
    }
  }
  await editor
    .getByRole("button", { name: "保存需求版本", exact: true })
    .click();
  await editor.waitFor({ state: "hidden" });
  const saved = s.demands
    .list()
    .find((row) => row.operation_id === operation.id);
  assert.equal(saved.work_locations.length, 23);
  assert.equal(saved.quantity_scaled, 690000);
  assert.equal(
    saved.work_locations[0].attributes.bird,
    fields[1].options[1].value,
  );
  assert.equal(
    saved.work_locations[1].attributes.bird,
    fields[1].options[0].value,
  );
  assert.equal(saved.attributes.reason, "普通");
  assert.deepEqual(failures, []);
  console.log(
    "DEMAND_WORKBENCH_BROWSER_OK 20 same-line, 24 cross-line, paste ranges, missing and duplicate results, batch values, independent row edits, stable deletion, four widths and both themes",
  );
} catch (failure) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  throw failure;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const fn of cleanup.reverse()) await fn();
}
