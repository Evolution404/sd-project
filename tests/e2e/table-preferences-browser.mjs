import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";

const cleanup = [], { s, user } = fixture({ after: action => cleanup.push(action) });
const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
const lineA = s.catalog.save(user, "lines", { name: "交互甲线", voltage_level_id: voltage.id });
s.catalog.save(user, "lines", { name: "交互乙线", voltage_level_id: voltage.id });
const ph = s.catalog.save(user, "physical", { asset_no: "铭牌77", tower_type: "直线塔" });
s.catalog.save(user, "towers", {
  line_id: lineA.id, tower_no: "#77",
  physical_mode: "shared", physical_tower_id: ph.id,
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const context = await browser.newContext({ viewport: { width: 1450, height: 1000 } });
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113");
mkdirSync(output, { recursive: true });

try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();

  // Navigation preferences are not tied to a single route.
  await page.getByRole("button", { name: "折叠导航" }).click();
  await page.locator(".navigation.is-collapsed").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("sd-sidebar-collapsed")), "true");
  await page.reload();
  await page.locator(".navigation.is-collapsed").waitFor();
  await page.getByRole("button", { name: "展开导航" }).click();
  await page.getByRole("menuitem", { name: "输电设备台账", exact: true }).click();
  await page.getByRole("heading", { name: "输电设备台账" }).waitFor();

  // Column layout is persisted and must not change the underlying equipment.
  await page.getByRole("button", { name: "列设置" }).click();
  const dialog = page.getByRole("dialog", { name: "自定义表格列" });
  await dialog.waitFor();
  await page.waitForTimeout(350); // Wait for dialog opening and Sortable attachment.
  const handle = dialog.getByRole("button", { name: "调整线路名称顺序", exact: true });
  const destination = dialog.locator('.column-setting-item').filter({ hasText: "线路类型" });
  const from = await handle.boundingBox(), to = await destination.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x + 40, to.y + to.height - 3, { steps: 16 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const pref = JSON.parse(localStorage.getItem("sd-columns:catalog:lines"));
    return pref.order?.indexOf("name") > 0;
  });
  const draggedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem("sd-columns:catalog:lines")).order);
  await handle.focus();
  await handle.press("Home");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sd-columns:catalog:lines")).order[0] === "name");
  assert.notEqual(draggedOrder[0], "name");
  await handle.press("ArrowDown");
  await dialog.locator('.column-setting-item').filter({ hasText: "线路名称" }).getByRole("button", { name: "固定列", exact: true }).click();
  await dialog.getByText("接入杆塔", { exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(await page.getByRole("columnheader", { name: "接入杆塔" }).count(), 0);
  assert.ok(await page.getByRole("columnheader", { name: /线路名称/ }).count());
  await page.reload();
  await page.getByRole("menuitem", { name: "输电设备台账", exact: true }).click();
  await page.getByRole("heading", { name: "输电设备台账" }).waitFor();
  assert.equal(await page.getByRole("columnheader", { name: "接入杆塔" }).count(), 0);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("sd-columns:catalog:lines")));
  assert.equal(restored.order[1], "name");
  assert.ok(restored.fixed.includes("name"));

  // Filter searches complete SQL dataset, not only the visible page.
  await page.getByRole("button", { name: "筛选线路名称" }).click();
  const field = page.getByPlaceholder("筛选线路名称");
  await field.fill("交互甲线");
  await field.press("Enter");
  await page.getByRole("cell", { name: "交互甲线", exact: true }).waitFor();
  await page.getByRole("cell", { name: "交互乙线", exact: true }).waitFor({ state: "detached", timeout: 10000 });
  assert.equal(await page.getByRole("cell", { name: "交互乙线", exact: true }).count(), 0);
  assert.equal(s.catalog.list("lines").filter(row => row.name.startsWith("交互")).length, 2);

  await page.screenshot({ path: join(output, "ledger-table-preferences-1450.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("BUSINESS_TABLE_BROWSER_OK persistent nav, persistent columns, server-side equipment filters");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
