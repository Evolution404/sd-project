import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSystem } from "../../server/application/system.mjs";
import { httpServer } from "../../server/http/server.mjs";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";

const root = mkdtempSync(join(tmpdir(), "sd113-governance-browser-"));
const dir = join(root, "demo");
ensureDemoDatabase(dir);
const s = createSystem(dir), server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const base = "http://127.0.0.1:" + server.address().port;
const output = join(process.cwd(), "test-results/schema113/governance");
mkdirSync(output, { recursive: true });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill(DEMO_ACCOUNT);
  await page.getByLabel("密码", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();

  // Workbench figures are real navigation actions with a useful filter.
  await page.getByRole("button", { name: "查看待确认需求" }).click();
  await page.waitForURL(/#\/demands/);
  await page.getByRole("row").filter({ hasText: "导线局部损伤" }).waitFor();

  await page.goto(base + "/#/dashboard");
  const projectName = "【演示】青峰线防鸟装置整治";
  await page.getByRole("row").filter({ hasText: projectName })
    .getByRole("button", { name: "进入办理" }).click();
  await page.waitForURL(/#\/projects\?project=/);
  await page.locator(".business-detail-dialog:visible").getByText(projectName, { exact: true }).first().waitFor();

  // Formal change copies quantities and materials rather than clearing them.
  const detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("button", { name: "编制正式变更" }).click();
  const editor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
  await editor.getByText("已继承上一版正式批准", { exact: false }).waitFor();
  await editor.getByText("防鸟装置 · FN-01", { exact: false }).first().waitFor();
  const quantities = await editor.locator("input").evaluateAll(nodes => nodes.map(node => node.value));
  assert.ok(quantities.some(value => Number(value) === 5), "existing approved material quantity should be restored");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "hidden" });

  // A changed pricing date invalidates the previously viewed formal quote.
  await page.goto(base + "/#/demands");
  await page.getByRole("row").filter({ hasText: "220kV青峰线15、16号杆塔缺少防鸟装置" })
    .getByRole("button", { name: "查看" }).click();
  await page.getByRole("button", { name: "参考价试算" }).click();
  const quote = page.locator(".el-overlay-dialog:visible").filter({ hasText: "参考价格" }).last();
  await quote.getByText("完整参考价 ¥228.00", { exact: true }).waitFor();
  const date = quote.getByLabel("价格适用日期");
  await date.fill("2026-11-11");
  await date.press("Tab");
  await quote.getByText("计价条件已修改", { exact: false }).first().waitFor();
  assert.equal(await quote.getByRole("button", { name: "确认正式报价" }).isDisabled(), true);
  await quote.getByRole("button", { name: "重新试算" }).click();
  await quote.getByText("完整参考价 ¥228.00", { exact: true }).waitFor();
  await quote.getByText("计价条件已修改", { exact: false }).first().waitFor({ state: "hidden" });
  assert.equal(await quote.getByRole("button", { name: "确认正式报价" }).isDisabled(), false);
  await quote.getByRole("button", { name: "关闭报价" }).click();
  await quote.waitFor({ state: "hidden" });
  await page.locator(".business-detail-dialog:visible")
    .getByRole("button", { name: "关闭详情" }).click();
  await page.locator(".business-detail-dialog:visible").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  const demandEditor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
  const operationChoice = demandEditor.getByLabel("操作类型", { exact: true });
  await operationChoice.click();
  await page.getByRole("option", { name: "安装防鸟装置", exact: true }).last().click();
  const completion = demandEditor.getByLabel("验收标准", { exact: true });
  await completion.getAttribute("placeholder").catch(() => {});
  assert.ok((await completion.inputValue()).includes("防鸟装置"));
  await operationChoice.click();
  await page.getByRole("option", { name: "更换绝缘子串", exact: true }).last().click();
  assert.ok((await completion.inputValue()).includes("绝缘子"));
  await completion.fill("用户自己编写的验收标准");
  await operationChoice.click();
  await page.getByRole("option", { name: "安装防鸟装置", exact: true }).last().click();
  assert.equal(await completion.inputValue(), "用户自己编写的验收标准");
  await demandEditor.getByText("当前验收标准包含手工填写内容", { exact: false }).waitFor();
  await demandEditor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByRole("button", { name: "放弃修改" }).click();
  await page.screenshot({ path: join(output, "governance-browser-1300.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("GOVERNANCE_BROWSER_OK: pending-demand route, project deep link, approved material inheritance, stale quote guard, auto vs manual completion standard");
} catch (error) {
  console.error("GOVERNANCE_BROWSER_ERRORS", errors);
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  s.close();
  rmSync(root, { recursive: true, force: true });
}
