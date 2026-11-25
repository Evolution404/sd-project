import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, demand, project, towers } = approvedFixture({ after: action => cleanup.push(action) });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = join(process.cwd(), 'test-results/schema113/visual-audit');
mkdirSync(output, { recursive: true });
const routes = ['dashboard', 'demands', 'projects', 'frameworks', 'agreements', 'finance', 'ledger', 'materials', 'standards', 'pricing', 'dictionaries', 'system'];
const widths = [1920];
async function visit(path) {
  if (await page.locator('.business-detail-dialog:visible').count()) {
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.locator('.business-detail-overlay:visible').waitFor({ state: 'hidden' });
  }
  const parts = path.split('/');
  const isDetail = parts[0] === 'ledger' ? parts.length === 3 : parts.length === 2;
  const route = isDetail ? (parts[0] === 'ledger' ? parts.slice(0,2).join('/') : parts[0]) : path;
  await page.goto(`${base}/#/${route}`);
  await page.locator('main h1:visible').waitFor();
  await page.waitForLoadState('networkidle');
  if (isDetail) {
    if (parts[0] === "finance") assert.ok(await page.getByRole("radio", { name: "按项目办理" }).isChecked());
    await page.locator('main .cell-link:visible').first().click();
    await page.locator(parts[0] === "finance" ? ".business-detail-page h1" : ".business-detail-dialog h1").waitFor();
    await page.waitForLoadState('networkidle');
  }
}
async function settleLayout() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity);
    // Some UI transitions can be replaced/restarted indefinitely during a reactive update.
    // Visual stability must not hang the entire release gate.
    await Promise.race([
      Promise.all(finite.map(animation => animation.finished.catch(() => {}))),
      new Promise(resolve => setTimeout(resolve, 1200)),
    ]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function auditLayout(name, width) {
  await page.setViewportSize({ width, height: 1080 });
  await settleLayout();
  // This test covers 12 business entries, detail views and dialogs in both
  // themes. Any user-visible raw UTC/ISO or locale timestamp is a regression.
  const displayedText = await page.locator('body').innerText();
  const badTimePatterns = [
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g,
    /\b\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/g,
    /\b\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\.\d+/g,
    /\b\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}(?:\s*(?:Z|UTC|GMT|[+-]\d{2}:\d{2}))/g,
    /\b\d{4}-\d{2}-\d{2}\s+\d:\d{2}:\d{2}/g,
    /\b\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}/g,
  ];
  const badTimes = badTimePatterns.flatMap(pattern => [...displayedText.matchAll(pattern)].map(hit => hit[0]));
  assert.deepEqual(badTimes, [], `${name} ${width} unformatted timestamp visible in UI`);
  const root = await page.locator('.business-detail-dialog:visible').count() ? page.locator('.business-detail-dialog:visible') : page.locator('main');
  const violations = await root.evaluate(main => {
    const issues = [], bounds = main.getBoundingClientRect();
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('page overflow');
    for (const button of main.querySelectorAll('.el-button')) {
      if (button.closest('.el-table') || button.closest('.el-tabs__nav-scroll')) continue;
      const box = button.getBoundingClientRect();
      if (box.width && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) issues.push('button outside workspace ' + button.textContent);
    }
    for (const title of main.querySelectorAll('.business-column-title')) {
      if (title.clientWidth && title.scrollWidth > title.clientWidth + 1) issues.push('default header clipped ' + title.textContent);
    }
    return issues;
  });
  assert.deepEqual(violations, [], `${name} ${width}`);
  await page.screenshot({ path: join(output, `${name}-${width}.png`), fullPage: true });
}
async function auditDialog(name, button, width) {
  await page.setViewportSize({ width, height: 1080 });
  if (button === "核定费用") await page.getByRole("tab", { name: "实际费用", exact: true }).click();
  if (button === "新增结算") await page.getByRole("tab", { name: "结算单", exact: true }).click();
  await page.getByRole('button', { name: button, exact: true }).click();
  const workTitles = { 新增需求: "新增专业需求", 新增结算: "编制结算草稿", 新增操作类型: "新增操作类型",
    新增作业对象: "新增作业对象", 新增参考价格规则: "新增参考价格规则" };
  const routed = Boolean(workTitles[button]);
  const dialog = routed ? page.getByRole("region", { name: workTitles[button], exact: true })
    : page.locator('.el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible .el-dialog');
  await dialog.waitFor();
  await settleLayout();
  const layout = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const footer = element.querySelector('.el-dialog__footer, .work-footer')?.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      footerBottom: footer?.bottom, footerTop: footer?.top, width: innerWidth, height: innerHeight };
  });
  assert.ok(layout.top >= 0 && (routed || layout.bottom <= layout.height + 1), `${name} ${width} ${JSON.stringify(layout)}`);
  assert.ok(layout.left >= 0 && layout.right <= width + 1, name);
  if (layout.footerBottom) assert.ok(layout.footerBottom <= layout.height && layout.footerTop > 0, name);
  await page.screenshot({ path: join(output, `dialog-${name}-${width}.png`), fullPage: true });
  if (routed) await dialog.getByRole("button", { name: "← 返回", exact: true }).click();
  else await dialog.locator('.el-dialog__headerbtn').click();
  await dialog.waitFor({ state: 'hidden' });
}
try {
  await page.goto(base);
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('Schema113-test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.shell').waitFor();
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.business-detail-dialog:visible').count()) {
      await page.getByRole('button', { name: '关闭详情', exact: true }).click();
      await page.locator('.business-detail-overlay:visible').waitFor({ state: 'hidden' });
    }
    const currentDark = await page.locator("html").evaluate(element => element.classList.contains("dark"));
    if (currentDark !== (theme === "dark")) await page.getByRole("button", { name: theme === "dark" ? "切换为深色" : "切换为浅色", exact: true }).click();
    await page.locator('main h1:visible').click();
    for (const path of routes) {
      await visit(path);
      for (const width of widths) await auditLayout(`${theme}-${path}`, width);
    }
    for (const [name, path] of [
      ['demand', `demands/${demand.id}`], ['project', `projects/${project.id}`], ['physical', `ledger/physical/${towers[0].id}`],
    ]) {
      await visit(path);
      for (const width of widths) {
        await auditLayout(`${theme}-${name}-detail`, width);
        if (name === 'project') {
          await page.getByRole('heading', { name: '项目档案', exact: true }).waitFor();
        } else {
          const columns = await page.locator('.el-descriptions__body tr').first().locator('td').count();
          assert.equal(columns, 4, `${name} description columns ${width}`);
        }
      }
    }
    // Inspect the full finance tab as well as the default project scope tab.
    await visit(`projects/${project.id}`);
    await page.locator('.business-detail-dialog').getByRole('tab', { name: '费用与结算' }).click();
    await page.waitForLoadState('networkidle');
    for (const width of widths) await auditLayout(`${theme}-project-finance-detail`, width);
    for (const [name, path, button] of [
      ['line', 'ledger', '新增线路'], ['tower', 'ledger/towers', '新增逻辑杆塔'],
      ['operation', 'standards', '新增操作类型'], ['demand', 'demands', '新增需求'],
      ['project', 'projects', '新增子项目'], ['user', 'system', '新增用户'],
      ['cost', `finance/${project.id}`, '核定费用'], ['settlement', `finance/${project.id}`, '新增结算'],
    ]) {
      await visit(path);
      for (const width of widths) await auditDialog(`${theme}-${name}`, button, width);
    }
  }
  // Cancelling a destructive detail action preserves both the entity and its location.
  await visit(`ledger/physical/${towers[0].id}`);
  const location = page.url();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(page.url(), location);
  assert.equal(s.catalog.get('physical', towers[0].id).deleted, false);
  assert.deepEqual(errors, []);
  console.log('VISUAL_AUDIT_BROWSER_OK 12 modules + 3 details + 8 editor surfaces at 1920×1080, light/dark, bounded footer, responsive facts and cancel');
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  console.log('FAILURE_URL', page.url(), errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
