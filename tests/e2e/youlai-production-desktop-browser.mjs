import { settlementCanvas } from "./youlai-settlement-grid-helpers.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const artifacts = resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web");
assert.ok(existsSync(join(artifacts, "index.html")), "Build web with the pinned Node and pnpm first");
const cleanup = [];
const { s, project } = approvedFixture({ after: action => cleanup.push(action) });
const backend = httpServer(s, { staticDirectory: artifacts });
await new Promise(done => backend.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${backend.address().port}`;
const screenshots = resolve("test-results/youlai-production-desktop");
mkdirSync(screenshots, { recursive: true });

const modules = [
  ["dashboard", "/dashboard", "实际费用趋势"],
  ["demands", "/business/demands", "新增专业需求"],
  ["projects", "/business/projects", "新增子项目"],
  ["frameworks", "/funding/frameworks", "新增年度框架"],
  ["agreements", "/funding/agreements", "新增执行协议"],
  ["finance", "/funding/finance", "新增结算草稿"],
  ["equipment", "/assets/ledger", "新增输电线路"],
  ["materials", "/assets/materials", "新增物资"],
  ["standards", "/standards/operations", "新增作业对象"],
  ["pricing", "/standards/pricing", "新增参考价格"],
  ["dictionaries", "/configuration/dictionaries", "新增计量单位"],
  ["system", "/configuration/system", "功能权限"],
  ["users", "/configuration/users", "新增用户"],
  ["audit", "/configuration/audit", "业务审计"],
  ["access", "/configuration/access", "新增 IP 授权"],
  ["profile", "/profile", "有效登录会话"],
];
let browser;
try {
  browser = await chromium.launch(existsSync(chromium.executablePath())
    ? { headless: true } : { headless: true, channel: "chrome" });
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/#/login");
    await page.getByRole("heading", { name: "项目全流程管理", exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, `login-1920-${colorScheme}.png`), animations: "disabled" });
    await page.getByPlaceholder("用户名").fill("admin");
    await page.getByPlaceholder("密码").fill("Schema113-test-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL(/#\/dashboard/);
    const releaseVersion = await page.request.get(origin + "/version.json");
    assert.equal(releaseVersion.status(), 200);
    assert.ok((await releaseVersion.json()).version);
    page.on("response", response => {
      if (response.url().startsWith(origin + "/api/") && response.status() >= 400)
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });

    const width=1920;
    for (const [key, path, marker] of modules) {
      await page.goto(origin + "/#" + path);
      const content = page.locator(".layout-content");
      await page.waitForURL(url=>url.hash === "#"+path);
      if(key==="finance"){
        await content.getByRole("tab",{name:"结算单",exact:true}).click();
      }
      await content.getByText(marker,{exact:true}).first().waitFor();
      await page.waitForFunction(()=>!document.querySelector(".layout-content .el-loading-mask"));
      await page.waitForFunction(()=>{
        const main=document.querySelector(".layout-content");
        return main && main.getAnimations({subtree:true}).every(a=>
          a.playState!=="running" || a.effect?.getTiming().iterations===Infinity);
      });
      assert.ok(await content.getByText(marker,{exact:true}).first().isVisible(),key+" destination content");
      assert.equal(await content.locator(".el-loading-mask:visible").count(),0,key+" loading mask");
      assert.equal(await page.locator("html").evaluate(node => node.classList.contains("dark")), colorScheme === "dark");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${key} ${width} ${colorScheme} has ${overflow}px document overflow`);
      await page.screenshot({ path: join(screenshots, `${key}-${width}-${colorScheme}.png`), animations: "disabled" });
    }
    await page.goto(origin + "/#/business/projects?project=" + project.id);
    const drawer = page.locator(".el-drawer:visible");
    await drawer.getByRole("button", { name: "编制正式变更", exact: true }).waitFor();
    await drawer.locator(".el-loading-mask:visible").first().waitFor({ state: "hidden" });
    await page.screenshot({ path: join(screenshots, `project-detail-${width}-${colorScheme}.png`), animations: "disabled" });
    await drawer.getByRole("button", { name: "编制正式变更", exact: true }).click();
    await page.getByRole("textbox", { name: "拟批准预算（元）" }).waitFor();
    await page.getByRole("cell", { name: "T15", exact: true }).waitFor();
    await page.locator(".layout-content .el-loading-mask:visible").first().waitFor({ state: "hidden" });
    await page.screenshot({ path: join(screenshots, `project-change-${width}-${colorScheme}.png`), animations: "disabled" });
    await page.getByRole("button", { name: "返回子项目", exact: true }).click();
    await drawer.getByRole("button", { name: "审核结项", exact: true }).click();
    const closePreview = page.getByRole("dialog", { name: "结项核对" });
    await closePreview.getByRole("cell", { name: "T15", exact: true }).waitFor();
    await closePreview.locator(".el-loading-mask:visible").first().waitFor({ state: "hidden" });
    const closeButton = await closePreview.getByRole("button", { name: "确认正式结项", exact: true }).boundingBox();
    assert.ok(closeButton && closeButton.y + closeButton.height <= page.viewportSize().height,
      `closeout action exceeds viewport at ${width} ${colorScheme}`);
    await page.screenshot({ path: join(screenshots, `close-preview-${width}-${colorScheme}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.goto(origin + "/#/funding/finance?project=" + project.id);
    await page.getByRole("button", { name: "新增结算草稿", exact: true }).click();
    const compose = page.getByRole("region", { name: "编制结算草稿" });
    await settlementCanvas(compose);
    await compose.locator(".el-loading-mask:visible").first().waitFor({ state: "hidden" });
    const save = await compose.getByRole("button", { name: "保存草稿", exact: true }).boundingBox();
    assert.ok(save && save.y + save.height <= page.viewportSize().height,
      `settlement action exceeds viewport at ${width} ${colorScheme}`);
    await page.screenshot({ path: join(screenshots, `settlement-worksheet-${width}-${colorScheme}.png`), animations: "disabled" });
    await compose.getByRole("button", { name: "返回结算列表", exact: true }).click();
    await compose.waitFor({ state: "hidden" });
    await page.goto(origin + "/#/business/demands/edit");
    await page.getByRole("textbox", { name: "问题描述" }).waitFor();
    await page.locator(".layout-content .el-loading-mask:visible").first().waitFor({ state: "hidden" });
    await page.screenshot({ path: join(screenshots, `demand-editor-${width}-${colorScheme}.png`), animations: "disabled" });
    await page.goto(origin + "/#/standards/pricing");
    await page.getByRole("button", { name: "新增参考价格", exact: true }).click();
    const priceEditor = page.getByRole("dialog", { name: "新增参考价格规则" });
    await priceEditor.getByRole("button",{name:"保存正式规则",exact:true}).waitFor();
    const priceSave=await priceEditor.getByRole("button",{name:"保存正式规则",exact:true}).boundingBox();
    assert.ok(priceSave && priceSave.y>=0 && priceSave.y+priceSave.height<=page.viewportSize().height,
      "price save action exceeds viewport at "+width+" "+colorScheme);
    const operation = priceEditor.getByRole("combobox", { name: "操作类型" });
    await operation.click();
    const listId = await operation.getAttribute("aria-controls");
    assert.ok(listId);
    await page.locator("[id='" + listId + "']").getByRole("option").first().waitFor();
    await page.screenshot({ path: join(screenshots, `price-operation-picker-${width}-${colorScheme}.png`), animations: "disabled" });
    await operation.press("Escape");
    await priceEditor.getByRole("button", { name: "保存正式规则" }).click();
    await priceEditor.getByText("请填写规则名称、操作类型、价格来源、价格日期、生效日期和依据", { exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, `price-validation-${width}-${colorScheme}.png`), animations: "disabled" });
    await priceEditor.getByRole("button", { name: "取消", exact: true }).click();
    await priceEditor.waitFor({ state: "hidden" });
    assert.deepEqual(errors, [], `production application failures in ${colorScheme}`);
    await context.close();
  }
  console.log("YOULAI_PRODUCTION_DESKTOP_OK 12 modules, administration, price selector and validation, demand editor, project detail/change/close preview and settlement worksheet, 1920×1080 and both themes");
} finally {
  await browser?.close();
  await new Promise(done => backend.close(done));
  for (const action of cleanup.reverse()) await action();
}
