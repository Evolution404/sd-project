import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";
import { makeWorkbook } from "../../server/exchange/workbook.mjs";
const cleanup = [],
  { s, user, operation, towers } = fixture({
    after: (action) => cleanup.push(action),
  }),
  server = httpServer(s);
const factor = s.catalog.save(user, "factors", {
  name: "正式施工环境",
  fields_json: { kind: "enum", values: ["山地"] },
});
s.catalog.save(
  user,
  "operations",
  {
    ...operation,
    expected_version: 1,
    pricing_features_json: [
      {
        factor_id: factor.id,
        factor_version: 1,
        source: "manual",
        required: true,
      },
    ],
  },
  operation.id,
);
s.demands.save(user, {
  operation_id: operation.id,
  problem_description: "中文正式特征历史",
  work_locations: [
    {
      location_kind: "physical_tower",
      physical_tower_id: towers[0].id,
      quantity_scaled: 10000,
      site_features_json: {
        [factor.code]: { factor_version: 1, value: "山地" },
      },
    },
  ],
});
s.catalog.save(
  user,
  "factors",
  { ...factor, name: "现行施工环境名称", expected_version: 1 },
  factor.id,
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }),
  errors = [],
  submitted = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/catalog/"))
    submitted.push(request.postDataJSON());
});
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });
async function select(label, option) {
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByLabel(label, { exact: true })
    .press("ArrowDown");
  await page.getByRole("option", { name: option, exact: true }).last().click();
}
async function save() {
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
}
async function line(name) {
  await page.getByRole("tab", { name: "线路", exact: true }).click();
  await page.getByRole("button", { name: "新增线路", exact: true }).click();
  assert.equal(
    await page
      .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
      .locator(".el-form-item.is-required:visible")
      .count(),
    2,
  );
  await page.getByLabel("名称", { exact: true }).fill(name);
  await select("电压等级", "220kV");
  await save();
}
async function tower(lineName, number) {
  await page.getByRole("tab", { name: "逻辑杆塔", exact: true }).click();
  await page.getByRole("button", { name: "新增逻辑杆塔", exact: true }).click();
  await select("所属线路", lineName + " · 220kV");
  await page.getByLabel("杆塔号", { exact: true }).fill(number);
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
  await page.getByLabel("名称", { exact: true }).fill("220kV");
  assert.equal(await page.getByLabel("编码", { exact: true }).count(), 0);
  await save();
  for (const name of ["最少录入甲线", "最少录入乙线", "最少录入丙线"])
    await line(name);
  const originalPhysicalCount = s.catalog.list("physical").length;
  await tower("最少录入甲线", "#15");
  assert.equal(
    await page
      .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
      .locator(".el-form-item.is-required:visible")
      .count(),
    2,
  );
  assert.equal(
    await page
      .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
      .getByLabel("物理杆塔", { exact: true })
      .isVisible(),
    false,
  );
  await page.screenshot({
    path: join(output, "ordinary-tower-minimal-1500.png"),
    fullPage: true,
  });
  await save();
  const first = s.catalog.list("towers")[0];
  assert.equal(s.catalog.list("physical").length, originalPhysicalCount + 1);
  await tower("最少录入乙线", "#15");
  await page.getByText("与已有杆塔共用实体", { exact: true }).click();
  await select("物理杆塔", "最少录入甲线 · 220kV · #15");
  await save();
  assert.equal(s.catalog.list("physical").length, originalPhysicalCount + 1);
  assert.equal(
    s.catalog
      .list("towers")
      .filter((row) => row.physical_tower_id === first.physical_tower_id)
      .length,
    2,
  );
  await tower("最少录入甲线", "#15");
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByText("本线路杆塔号重复", { exact: true }).waitFor();
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await tower("最少录入丙线", "#15");
  await save();
  assert.equal(await page.locator('.el-message-box:visible').count(), 0);
  assert.equal(s.catalog.list("physical").length, originalPhysicalCount + 2);
  await page.getByRole("tab", { name: "物理杆塔", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "最少录入甲线" })
    .getByRole("button", { name: "查看", exact: true })
    .click();
  await page.getByRole("heading", { name: /最少录入甲线/ }).waitFor();
  await page.getByRole("button", { name: "整基更换", exact: true }).click();
  await page.getByLabel("新杆塔杆塔高度（米）", { exact: true }).fill("25");
  await page.getByRole("button", { name: "确认整基更换", exact: true }).click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({ state: "hidden" });
  assert.equal(
    s.catalog.get("physical", first.physical_tower_id).status,
    "retired",
  );
  assert.equal(s.catalog.list("physical").length, originalPhysicalCount + 3);
  const circuit = s.catalog.get("towers", first.id);
  assert.notEqual(circuit.physical_tower_id, first.physical_tower_id);
  for (const width of [1500, 760]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: join(output, `replacement-history-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("tab", { name: "线路", exact: true }).click();
  await page
    .getByRole("button", { name: "Excel 批量处理", exact: true })
    .click();
  const buffer = await makeWorkbook("assets", {
    documents: [{ name: "浏览器批量线路", voltage_name: "220kV" }],
    towers: [{ line_name: "浏览器批量线路", tower_no: "#77" }],
  });
  await page.locator(".el-upload input[type=file]").setInputFiles({
    name: "独立业务台账.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByText("新增 2", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "确认提交有效单据", exact: true })
    .click();
  await page
    .getByText("已处理 2 张单据，失败 0 项", { exact: false })
    .waitFor();
  assert.ok(s.catalog.list("towers").some((row) => row.tower_no === "#77"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  if (await page.getByRole("button", { name: "打开导航" }).isVisible())
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("menuitem", { name: "专业需求", exact: true }).last().click();
  await page
    .getByRole("row")
    .filter({ hasText: "中文正式特征历史" })
    .getByRole("button", { name: "查看", exact: true })
    .click();
  await page.getByText("正式施工环境 · 山地", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  assert.ok(!(await page.locator("body").innerText()).includes(factor.code));
  if (await page.getByRole("button", { name: "打开导航" }).isVisible())
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("menuitem", { name: "输电设备台账", exact: true }).last().click();
  await line("最少录入甲线");
  await tower("最少录入甲线", "#88");
  await page
    .getByText("存在同名对象，请到台账核对名称和真实属性后再保存。", {
      exact: true,
    })
    .waitFor();
  await page
    .locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  for (const body of submitted)
    for (const key of ["code", "line_code", "tower_code", "logical_code"])
      assert.equal(body[key], undefined);
  assert.deepEqual(errors, []);
  console.log(
    "INDEPENDENT_LEDGER_BROWSER_OK no code input, 2-field line/tower, shared physical, same-line duplicates only, whole replacement, business-only Excel",
  );
} catch (error) {
  await page.screenshot({
    path: join(output, "independent-ledger-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
