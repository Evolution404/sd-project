import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, project } = approvedFixture({ after: done => cleanup.push(done) });
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", failure => errors.push(failure.message));
const dir = join(process.cwd(), "test-results/schema113/form-layout");
mkdirSync(dir, { recursive: true });
const scenarios = [
  ["operation", "standards", "新增操作类型"],
  ["demand", "demands", "新增需求"],
  ["project", "projects", "新增子项目"],
  ["cost", "finance", "核定费用"],
  ["settlement", "finance", "新增结算"],
];
async function inspect(dialog, kind, width) {
  const details = await dialog.evaluate(element => {
    const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const footer = element.querySelector(".el-dialog__footer, .work-footer");
    const header = element.querySelector(".el-dialog__header, .page-heading");
    const body = element.querySelector(".el-dialog__body, .work-body");
    const workPage = element.classList.contains("business-work-surface");
    const labels = [...element.querySelectorAll(".el-form-item__label")].filter(visible);
    const buttons = [...footer.querySelectorAll(".el-button")].filter(visible);
    const firstField = [...element.querySelectorAll(".el-input__wrapper, .el-select__wrapper")]
      .find(node => visible(node) && node.querySelector("input:not([disabled])"));
    let focusChanged = true, focusBefore = "", focusAfter = "", focusTarget = "";
    if (firstField) {
      focusBefore = getComputedStyle(firstField).boxShadow;
      firstField.querySelector("input").focus();
      focusAfter = getComputedStyle(firstField).boxShadow;
      focusTarget = document.activeElement?.outerHTML?.slice(0,180) || "";
      focusChanged = focusAfter !== focusBefore ||
        (firstField.matches(":focus-within") && focusAfter.includes(" inset, "));
    }
    const bounds = element.getBoundingClientRect(), foot = footer.getBoundingClientRect();
    const gapBetweenButtons = buttons.length < 2 ? 999 : (() => {
      const left = buttons[buttons.length-2].getBoundingClientRect();
      const right = buttons[buttons.length-1].getBoundingClientRect();
      if (right.top > left.bottom - 2) return 999;
      return right.left - left.right;
    })();
    return {
      title: element.querySelector(".el-dialog__title, .guide-dialog-heading strong")?.textContent?.trim(),
      labelCount: labels.length, minLabelWeight: Math.min(...labels.map(label => Number(getComputedStyle(label).fontWeight))),
      border: parseFloat(getComputedStyle(footer).borderTopWidth),
      footerInBounds: foot.bottom <= innerHeight + 1 && foot.top >= bounds.top + 1,
      nonOverlapping: foot.top >= header.getBoundingClientRect().bottom &&
        (workPage || body.getBoundingClientRect().bottom <= foot.top + 2),
      gapBetweenButtons, focusChanged, focusBefore, focusAfter, focusTarget,
      primaryLast: buttons[buttons.length-1]?.classList.contains("el-button--primary"),
      firstControlHeight: firstField?.getBoundingClientRect().height ?? 0,
    };
  });
  assert.ok(details.labelCount > 0 && details.minLabelWeight >= 600,
    kind + " " + width + " labels must be prominent: " + JSON.stringify(details));
  assert.ok(details.border >= 1 && details.footerInBounds && details.nonOverlapping,
    kind + " " + width + " footer must be visually separated: " + JSON.stringify(details));
  assert.ok(details.gapBetweenButtons >= 8 && details.primaryLast && details.focusChanged,
    kind + " " + width + " button and focus hierarchy: " + JSON.stringify(details));
  assert.ok(details.firstControlHeight >= 34, kind + " " + width + " control must be usable");
}
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  for (const [kind, path, button] of scenarios) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("http://127.0.0.1:" + server.address().port + "/#/" + path);
    await page.locator("main h1").waitFor();
    if (path === "finance") {
      await page.locator(".cell-link:visible").first().click();
      await page.locator(".business-detail-page:visible").waitFor();
      await page.getByRole("tab", {name:"实际费用", exact:true}).click();
      await page.locator(".business-detail-page:visible")
        .getByRole("button", { name: "核定费用", exact: true }).waitFor();
      const alignment = await page.evaluate(() => [...document.querySelectorAll(".business-detail-page .panel > .toolbar")]
        .filter(bar => bar.querySelector(":scope > h2") && bar.querySelector(":scope > .el-button"))
        .map(bar => {
          const title = bar.querySelector(":scope > h2").getBoundingClientRect();
          const control = bar.querySelector(":scope > .el-button").getBoundingClientRect();
          return Math.abs((title.top + title.bottom)/2 - (control.top + control.bottom)/2);
        }));
      assert.ok(alignment.every(diff => diff < 8), "panel headings and buttons must share a baseline " + alignment);
    }
    if (kind === "settlement") await page.getByRole("tab", { name: "结算单", exact: true }).click();
    await page.getByRole("button", { name: button, exact: true }).click();
    const routed = ["operation", "demand", "settlement"].includes(kind);
    const dialog = routed ? page.getByRole("region", { name: kind === "operation" ? "新增操作类型" : kind === "demand" ? "新增专业需求" : "编制结算草稿", exact: true })
      : page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible .el-dialog").last();
    await dialog.waitFor();
    // Capture neutral, fully animated form states before the focus test opens
    // any date-picker popover or triggers validation on required fields.
    for (const width of [1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.waitForTimeout(450);
      await page.screenshot({ path: join(dir, kind + "-" + width + ".png"), fullPage: true });
    }
    for (const width of [1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await inspect(dialog, kind, width);
    }
    if (kind === "settlement") {
      await dialog.getByLabel("本次金额（元）", { exact: true }).waitFor();
      assert.equal(await dialog.getByText("费用明细 1", { exact: true }).count(), 0);
      await dialog.getByText("按子费用", { exact: true }).click();
      await dialog.getByText("费用明细 1", { exact: true }).waitFor();
      assert.equal(await dialog.getByText("费用明细 1", { exact: true }).count(), 1);
      assert.equal(await dialog.getByRole("button", { name: "移除此项", exact: true }).count(), 1);
    }
    if (routed) {
      await dialog.getByRole("button", { name: "← 返回", exact: true }).click();
      if (kind === "settlement") await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    }
    else await dialog.locator(".el-dialog__headerbtn").click();
    await dialog.waitFor({state: "hidden"});
  }
  assert.deepEqual(errors, []);
  console.log("FORM_SPACING_BROWSER_OK 5 edit surfaces at 1920×1080, labels, focus, footer, buttons, and finance headings");
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const done of cleanup.reverse()) await done();
}
