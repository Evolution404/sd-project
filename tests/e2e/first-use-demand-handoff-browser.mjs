import assert from "node:assert/strict";
import { chromium } from "playwright";
import { selectFormChoice } from "./field-helper.mjs";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";

const root = mkdtempSync(join(tmpdir(), "sd113-first-use-"));
const s = createSystem(join(root, "isolated-data"));
assert.equal(s.catalog.list("operations").length, 0);
assert.equal(s.catalog.list("units").length, 0);
s.auth.initialize("admin", "Fresh-Browser-Test-Password");
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const out = join(process.cwd(), "test-results", "schema113", "first-use");
mkdirSync(out, { recursive: true });
const editor = page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
async function save() {
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
}
async function choose(label, option) {
  await selectFormChoice(page, label, option, editor);
}
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + "/#/demands");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Fresh-Browser-Test-Password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "新增需求", exact: true }).click();
  await editor.getByLabel("问题描述", { exact: true }).fill("第一次录入的巡视问题（保留草稿）");
  await editor.getByText("尚未配置操作类型").waitFor();
  await page.screenshot({ path: join(out, "missing-operation.png") });
  await editor.getByRole("button", { name: "配置操作类型" }).click();
  await page.waitForURL(url => url.hash.includes("/standards/operations") && url.hash.includes("returnTo"), { timeout: 5000 });
  await page.getByRole("button", { name: "配置计量单位" }).click();
  await page.waitForURL(url => url.hash.includes("/dictionaries/units") && url.hash.includes("returnTo"));
  await page.getByRole("button", { name: "新增计量单位" }).click();
  await editor.getByLabel("名称", { exact: true }).fill("套");
  await save();
  assert.equal(s.catalog.list("units").length, 1);
  await page.getByRole("button", { name: "配置作业对象" }).click();
  await page.waitForURL(url => url.hash.includes("/standards/objects") && url.hash.includes("returnTo"));
  await page.getByRole("button", { name: "新增作业对象" }).click();
  await editor.getByLabel("名称", { exact: true }).fill("防鸟装置");
  await choose("对象位置", "本体");
  await choose("归属单元", "逻辑杆塔");
  await save();
  await page.waitForURL(url => url.hash.includes("/standards/operations") && url.hash.includes("returnTo"));
  await page.getByRole("button", { name: "新增操作类型" }).click();
  await editor.getByLabel("名称", { exact: true }).fill("安装防鸟装置");
  await choose("作业对象", "防鸟装置");
  await choose("固定计量单位", "套");
  await editor.getByRole("tab", { name: "录入模板" }).click();
  await editor.getByLabel("默认验收标准", { exact: true }).fill("应安装牢固且不损坏设备");
  await save();
  await page.waitForURL(url => url.hash.startsWith("#/demands") && !url.hash.includes("returnTo"));
  await editor.getByLabel("问题描述", { exact: true }).waitFor();
  assert.equal(await editor.getByLabel("问题描述", { exact: true }).inputValue(), "第一次录入的巡视问题（保留草稿）");
  await choose("操作类型", "安装防鸟装置");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("textarea"))
    .some(element => element.value === "应安装牢固且不损坏设备"), null, { timeout: 6000 });
  assert.equal(await editor.getByLabel("验收标准", { exact: true }).inputValue(), "应安装牢固且不损坏设备");
  await page.screenshot({ path: join(out, "resumed-draft.png") });
  assert.deepEqual(errors, []);
  console.log("FIRST_USE_HANDOFF_BROWSER_OK empty -> missing operation -> units -> object -> operation -> restored demand draft with auto standard");
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  s.close();
  rmSync(root, { recursive: true, force: true });
}
