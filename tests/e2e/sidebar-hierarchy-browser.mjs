import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectNavigation } from "./navigation-helper.mjs";

const cleanup = [];
const { s } = approvedFixture({ after: action => cleanup.push(action) });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const evidence = join(process.cwd(), "test-results/schema113/sidebar-upgrade");
mkdirSync(evidence, { recursive: true });

async function geometry() {
  return page.evaluate(() => {
    const menu = document.querySelector(".layout-sidebar__menu .el-scrollbar__wrap") ?? document.querySelector(".navigation-menu-scroll");
    const group = document.querySelector(".navigation .nav-group > .el-sub-menu__title");
    const leaf = document.querySelector(".navigation .nav-leaf-item");
    const parentLabel = group.querySelector(".nav-group-label");
    const childLabel = leaf.querySelector(".nav-leaf-label");
    const parentStyle = getComputedStyle(parentLabel);
    const childStyle = getComputedStyle(childLabel);
    return {
      groupFont: Number.parseFloat(parentStyle.fontSize),
      leafFont: Number.parseFloat(childStyle.fontSize),
      groupWeight: Number.parseInt(parentStyle.fontWeight),
      leafWeight: Number.parseInt(childStyle.fontWeight),
      indent: childLabel.getBoundingClientRect().x - parentLabel.getBoundingClientRect().x,
      groupHeight: group.getBoundingClientRect().height,
      leafHeight: leaf.getBoundingClientRect().height,
      scrollable: menu.scrollHeight > menu.clientHeight,
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
    };
  });
}

async function login() {
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".navigation .nav-group").first().waitFor();
}
async function opened() {
  return page.locator(".navigation .nav-group.is-opened").count();
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/agreements`);
  await login();
  const initial = await geometry();
  assert.ok(initial.groupFont >= 15 && initial.groupFont > initial.leafFont, JSON.stringify(initial));
  assert.ok(initial.groupWeight > initial.leafWeight, JSON.stringify(initial));
  assert.ok(initial.indent >= 20, JSON.stringify(initial));
  assert.ok(initial.groupHeight >= 36 && initial.groupHeight <= 42 && initial.leafHeight >= 36 && initial.leafHeight <= 42, JSON.stringify(initial));
  assert.equal(await opened(), 5, "high viewport starts with multiple groups expanded");
  assert.equal(await page.locator(".navigation .nav-leaf-item.is-active .nav-leaf-label").innerText(), "执行协议");
  await page.screenshot({ path: join(evidence, "after-1920x1080.png") });

  await selectNavigation(page, "子项目管理");
  await page.waitForURL(/#\/projects/);
  assert.equal(await opened(), 5, "route changes must not remount or collapse other groups");
  await page.locator(".navigation .nav-group > .el-sub-menu__title").filter({ hasText: "业务办理" }).click();
  assert.equal(await opened(), 4, "users can close exactly one group");
  await page.waitForFunction(() => { const saved = JSON.parse(localStorage.getItem("sd-navigation-open-groups") || "[]"); return !saved.includes("business"); });
  await page.reload();
  assert.equal(await opened(), 4, "manual closed group survives refresh");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sd-navigation-open-groups")));
  assert.ok(!saved.includes("business"));
  await selectNavigation(page, "专业需求");
  assert.equal(await opened(), 5, "navigation to a closed group auto-reveals its active destination");
  assert.equal(await page.locator(".navigation .nav-leaf-item.is-active .nav-leaf-label").innerText(), "专业需求");
  await page.reload();
  assert.equal(await opened(), 5);

  const splitter = page.getByRole("separator", { name: "拖动调整侧栏宽度" });
  await splitter.focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => Math.abs(document.querySelector(".navigation").getBoundingClientRect().width - 208) < 2);
  assert.ok(await page.evaluate(() => document.querySelector(".navigation-menu-scroll").clientWidth > 0));
  await splitter.focus();
  await page.keyboard.press("End");
  await page.waitForFunction(() => Math.abs(document.querySelector(".navigation").getBoundingClientRect().width - 400) < 2);
  await splitter.dblclick();
  await page.getByRole("button", { name: "折叠导航" }).click();
  await page.locator(".navigation.is-collapsed").waitFor();
  await page.getByRole("button", { name: "展开导航" }).click();
  assert.equal(await opened(), 5, "collapse and restore do not wipe remembered groups");

  const standard = await geometry();
  assert.ok(standard.groupFont > standard.leafFont && standard.indent >= 20, JSON.stringify(standard));
  // Exercise the sidebar's own overflow independently of the browser viewport.
  const menu = page.locator(".layout-sidebar__menu .el-scrollbar__wrap").first();
  await menu.evaluate(element => { element.style.maxBlockSize = "50vh"; });
  await page.waitForFunction(() => {
    const element = document.querySelector(".layout-sidebar__menu .el-scrollbar__wrap");
    return element.scrollHeight > element.clientHeight;
  });
  await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await menu.evaluate(element => element.scrollTop >= 30), "sidebar content must scroll inside the standard viewport");
  assert.ok(await page.locator(".navigation .nav-leaf-item").last().isVisible());
  await menu.evaluate(element => { element.style.removeProperty("max-block-size"); element.scrollTop = 0; });
  for (const mode of ["light", "dark"]) {
    await page.evaluate(mode => {
      localStorage.setItem("sd-appearance", mode);
    }, mode);
    await page.reload();
    assert.equal(await page.locator(".navigation .nav-leaf-item.is-active").count(), 1);
    await page.screenshot({ path: join(evidence, `after-${mode}.png`) });
  }
  await selectNavigation(page, "执行协议");
  await page.waitForURL(/#\/agreements/);
  assert.equal(await opened(), 5, "desktop navigation preserves the expanded group state");
  assert.equal(await page.locator(".navigation .nav-leaf-item.is-active .nav-leaf-label").innerText(), "执行协议");
  assert.equal(await page.getByRole("heading", { name: "执行协议", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log("SIDEBAR_HIERARCHY_BROWSER_OK", JSON.stringify(initial));
} catch (error) {
  await page.screenshot({ path: join(evidence, "failure.png") });
  console.error("SIDEBAR_HIERARCHY_FAILURE", errors, page.url());
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
