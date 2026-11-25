import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { alignmentAudit } from "./youlai-alignment-helpers.mjs";
import { selectWorksheetCell, worksheetCanvas } from "./youlai-business-worksheet-helpers.mjs";
import { pasteSettlementCells } from "./youlai-settlement-grid-helpers.mjs";

const cleanup = [];
const { s, user } = fixture({ after: fn => cleanup.push(fn) });
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const output = resolve("test-results/youlai-foundation-entry-batch");
mkdirSync(output, { recursive: true });
let browser, page;

try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("vea:ui:theme", "auto"));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const errors = [];
  page.on("pageerror", failure => errors.push(failure.message));
  const go = path => page.goto(origin + "/#" + path);
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  const dialog = name => page.getByRole("dialog", { name, exact: true });
  const tab = name => page.getByRole("tab", { name, exact: true });
  async function open(trigger, title) {
    await button(trigger).click();
    const scope = dialog(title);
    await scope.waitFor();
    return scope;
  }
  async function write(scope, title, text, { count = 1, column = 0, widths = [245], revise } = {}) {
    if (revise) {
      await button("选择待修订记录", scope).click();
      const picker = dialog("选择待修订记录");
      await picker.getByRole("row").filter({ hasText: revise }).locator("label.el-checkbox").click();
      await button("添加所选记录（1）", picker).click();
      await picker.waitFor({ state: "hidden" });
    } else {
      await scope.getByRole("spinbutton", { name: "新增行数" }).fill(String(count));
      await button("新增录入行", scope).click();
    }
    const canvas = await worksheetCanvas(scope.getByRole("region", { name: title + "明细", exact: true }));
    await selectWorksheetCell(canvas, 1, column, widths);
    await pasteSettlementCells(page, text);
    await button("预检明细", scope).click();
    await scope.getByText("已预检 " + count + " 条明细", { exact: true }).waitFor();
  }
  async function save(scope) {
    await button("整批保存", scope).click();
    await button("确认提交", dialog("确认整批保存")).click();
    await scope.waitFor({ state: "hidden" });
  }
  await go("/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await button("登录").click();
  await page.waitForURL(/#\/dashboard/);

  await go("/configuration/dictionaries");
  const unit = await open("批量新增", "批量新增计量单位");
  await write(unit, "批量新增计量单位", "批量精度三位\t3\n批量精度二位\t2", { count: 2 });
  assert.equal(s.dictionaries.list("units").length, 1);
  assert.deepEqual((await alignmentAudit(page, ".el-dialog")).violations, []);
  await unit.screenshot({ path: join(output, "dictionary-light.png"), animations: "disabled" });
  await save(unit);
  assert.equal(s.dictionaries.list("units").find(row => row.name === "批量精度三位").quantity_precision, 3);

  await tab("组织目录").click();
  const parent = await open("批量新增顶级组织", "批量新增组织");
  await write(parent, "批量新增组织", "批量工作表组织甲\n批量工作表组织乙", { count: 2 });
  await save(parent);
  await page.getByText("批量工作表组织甲", { exact: true }).first().click();
  const child = await open("批量新增下级", "批量新增组织");
  await write(child, "批量新增组织", "批量工作表下级");
  await save(child);
  const orgs = s.organizations.tree(user);
  assert.equal(orgs.find(row => row.name === "批量工作表下级").parent_id, orgs.find(row => row.name === "批量工作表组织甲").id);

  await go("/funding/frameworks");
  const framework = await open("批量新增", "批量新增年度框架");
  await write(framework, "批量新增年度框架", "批量年度框架\t45.67\t2026");
  await save(framework);
  const frameworkList = s.funding.search("frameworks", { page: 1, page_size: 20, q: "批量年度框架", filters: {} });
  assert.equal(frameworkList.items[0].limit_fen, 4567);

  await go("/funding/agreements");
  const agreement = await open("批量新增", "批量新增执行协议");
  await agreement.getByRole("combobox", { name: "所属年度框架" }).click();
  await page.getByRole("option", { name: /批量年度框架/ }).click();
  await write(agreement, "批量新增执行协议", "批量执行合同\t10.22\tSYN-01\t合成对方\t2026-11-20\t2026-11-21\t2026-12-31");
  await save(agreement);
  const agreements = s.funding.search("agreements", { page: 1, page_size: 20, q: "批量执行合同", filters: {} });
  assert.equal(agreements.items[0].framework_id, frameworkList.items[0].id);
  assert.equal(agreements.items[0].limit_fen, 1022);

  await go("/configuration/users");
  const users = await open("批量登记用户", "批量登记用户");
  await write(users, "批量登记用户", "sheet_user_one\t批量用户甲\tU01\nsheet_user_two\t批量用户乙\tU02", { count: 2 });
  await save(users);
  const account = s.management.users(user).find(row => row.username === "sheet_user_one");
  assert.equal(account.status, "disabled");
  const revise = await open("批量修订用户资料", "批量修订用户资料");
  await write(revise, "批量修订用户资料", "U11", { revise: "sheet_user_one", column: 2, widths: [195, 200, 165] });
  await save(revise);
  assert.equal(s.management.userDetail(user, account.id).employee_no, "U11");
  assert.deepEqual(s.management.userDetail(user, account.id).role_codes, ["viewer"]);

  await go("/configuration/access");
  const grant = await open("批量新增 IP 授权", "批量新增 IP 授权");
  await write(grant, "批量新增 IP 授权", "192.0.2.42\t合成浏览器IPv4\n2001:db8::42\t合成浏览器IPv6", { count: 2 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  assert.deepEqual((await alignmentAudit(page, ".el-dialog")).violations, []);
  await grant.screenshot({ path: join(output, "access-dark.png"), animations: "disabled" });
  await save(grant);
  const ipEdit = await open("批量修订用途", "批量修订 IP 授权用途");
  await write(ipEdit, "批量修订 IP 授权用途", "合成说明更正", { revise: "192.0.2.42", column: 1, widths: [245, 420] });
  await save(ipEdit);
  assert.equal(s.management.ips(user).find(row => row.ip === "192.0.2.42").note, "合成说明更正");

  await go("/assets/ledger");
  await tab("电压等级").click();
  const voltage = await open("批量新增电压等级", "批量新增电压等级");
  await write(voltage, "批量新增电压等级", "220kV\t合成校核");
  await save(voltage);
  assert.ok(s.equipment.list("voltages").some(row => row.name === "220kV"));
  assert.deepEqual(errors, []);
  console.log("YOULAI_FOUNDATION_BATCH_OK dictionaries, voltage, funding, organizations, disabled users and IP scope");
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const fn of cleanup.reverse()) await fn();
}
