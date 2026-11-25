import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
const cleanup = [];
const { s, user } = fixture({ after: fn => cleanup.push(fn) });
s.auth.saveUser(user, { username: "log-reader", password: "ReadOnly-secret", role: "viewer" });
let instant = new Date("2026-11-12T16:03:47Z");
const server = httpServer(s, { accessLog: { clock: () => instant } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const context = await browser.newContext({ timezoneId: "America/Los_Angeles", viewport: { width: 1920, height: 1080 } });
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/access-logs"); mkdirSync(output, { recursive: true });
try {
  await page.goto(base + "/#/system/access-logs");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("tab", { name: "访问日志", exact: true }).waitFor();
  await page.getByText("登录成功", { exact: true }).first().waitFor();
  const logs = page.locator(".access-logs");
  await logs.getByText("2026-11-13 00:03:47", { exact: true }).first().waitFor();
  await context.request.get(base + "/api/missing-log-browser");
  instant = new Date("2026-11-12T16:04:47Z");
  await logs.getByRole("button", { name: "更多筛选", exact: true }).click();
  await logs.getByLabel("状态码", { exact: true }).fill("404");
  await logs.getByRole("button", { name: "查询", exact: true }).click();
  await logs.getByText("/api/missing-log-browser", { exact: true }).waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".access-logs .el-loading-mask"))
    .every(mask => getComputedStyle(mask).display === "none" || mask.getClientRects().length === 0));
  await logs.getByRole("button", { name: "/api/missing-log-browser", exact: true }).click();
  const scrollBefore = await logs.locator(".el-table__body-wrapper .el-scrollbar__wrap").evaluate(root => root.scrollLeft);
  const dialog = page.getByRole("dialog", { name: "访问请求详情", exact: true });
  await dialog.getByText("资源不存在", { exact: true }).waitFor();
  assert.match(await dialog.innerText(), /2026-11-13 00:03:47/);
  assert.equal(new URL(page.url()).hash.includes("access-logs"), true);
  await dialog.getByRole("button", { name: "关闭详情", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await logs.locator(".el-table__body-wrapper .el-scrollbar__wrap").evaluate(root => root.scrollLeft), scrollBefore, "closing details must preserve the table scroll position");
  await logs.getByLabel("状态码", { exact: true }).fill("403");
  await logs.getByRole("button", { name: "刷新", exact: true }).click();
  await logs.getByRole("button", { name: "/api/missing-log-browser", exact: true }).waitFor();
  await logs.getByLabel("状态码", { exact: true }).fill("404");
  await logs.getByLabel("关键词", { exact: true }).fill("/api/missing-log-browser");
  const [download] = await Promise.all([page.waitForEvent("download"), logs.getByRole("button", { name: "应用条件并下载", exact: true }).click()]);
  assert.equal(download.suggestedFilename(), "访问日志.jsonl");
  const saved = join(output, "访问日志.jsonl"); await download.saveAs(saved);
  const records = readFileSync(saved, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(records.length > 0); assert.ok(records.every(row => row.status === 404 && row.path.includes("/api/missing-log-browser")));
  await logs.getByLabel("状态码", { exact: true }).fill("");
  await logs.getByLabel("关键词", { exact: true }).fill("登录成功");
  await logs.getByRole("button", { name: "查询", exact: true }).click();
  await logs.getByText("登录成功", { exact: true }).waitFor();
  for (const width of [1920]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.screenshot({ path: join(output, `logs-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: join(output, "logs-dark-1920.png"), fullPage: true, animations: "disabled" });
  assert.ok(await logs.locator(".el-table__body-wrapper td").first().evaluate(cell => {
    const channels = getComputedStyle(cell).backgroundColor.match(/\d+/g)?.slice(0,3).map(Number);
    return channels && channels.every(value => value < 100);
  }),"log records must use the dark table surface");
  await page.reload(); await logs.getByText("登录成功", { exact: true }).waitFor();
  assert.equal(await logs.getByLabel("关键词", { exact: true }).inputValue(), "登录成功");
  const viewer = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    await viewer.request.post(base + "/api/login", { data: { username: "log-reader", password: "ReadOnly-secret" } });
    assert.equal((await viewer.request.get(base + "/api/access-logs")).status(), 403);
    assert.equal((await viewer.request.get(base + "/api/access-logs/export")).status(), 403);
    const viewerPage = await viewer.newPage(); await viewerPage.goto(base + "/#/system/access-logs");
    await viewerPage.getByRole("heading", { name: "工作台", exact: true }).waitFor();
    assert.equal(await viewerPage.getByRole("tab", { name: "访问日志" }).count(), 0);
  } finally { await viewer.close(); }
  assert.deepEqual(errors, []);
  console.log("ACCESS_LOGS_BROWSER_OK Beijing time, admin filters, details, safe download, restored route at 1920×1080, dark mode and viewer denial");
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  for (const done of cleanup) await done();
}
