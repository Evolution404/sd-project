import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, demand } = approvedFixture({ after: action => cleanup.push(action) });
const voltage = save("voltages", { name: "500kV" });
Array.from({ length: 35 }, (_, i) => save("lines", { name: `路由验收${String(i).padStart(2, '0')}线`, voltage_level_id: voltage.id }));
s.management.saveUser(user, { username: "route-reader", password: "Route-reader-password", role: "viewer", status: "active" });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/navigation");
mkdirSync(output, { recursive: true });
const detail = page.locator('.business-detail-overlay .el-overlay-dialog:visible');
async function login(name, password) {
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator('.shell').waitFor();
}
async function closeDetail() {
  await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  await detail.waitFor({ state: 'hidden' });
}
try {
  await page.goto(`${base}/#/demands`);
  await login("admin", "Schema113-test-password");
  await page.getByRole('row').filter({ hasText: demand.demand_no }).getByRole('button', { name: '查看', exact: true }).click();
  await detail.getByRole('heading', { name: new RegExp(demand.demand_no) }).waitFor();
  assert.equal(page.url(), `${base}/#/demands`);
  await closeDetail();
  // A late search response must not replace a newer query's rows.
  await page.route('**/api/demands?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === '防鸟') {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 450));
      await route.fulfill({ response });
    } else await route.continue();
  });
  const demandSearch = page.getByPlaceholder('需求编号、问题或位置');
  await demandSearch.fill('防鸟');
  const slowRequest = page.waitForRequest(request => request.url().includes('/api/demands?') && new URL(request.url()).searchParams.get('q') === '防鸟');
  await demandSearch.press('Enter');
  await slowRequest;
  await demandSearch.fill('不存在的查询');
  await demandSearch.press('Enter');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('main .el-table__body-wrapper .el-table__row').count(), 0);
  await page.getByText('没有符合筛选条件的记录', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选条件', exact: true }).last().click();
  assert.equal(await demandSearch.inputValue(), '');
  await demandSearch.clear();
  await demandSearch.press('Enter');
  await page.getByRole('row').filter({ hasText: demand.demand_no }).waitFor();
  await page.unroute('**/api/demands?*');

  const modules = [
    ["工作台", "/dashboard"], ["子项目管理", "/projects"],
    ["年度框架", "/frameworks"], ["执行协议", "/agreements"], ["物资管理", "/materials"], ["参考价格", "/pricing"], ["基础数据", "/dictionaries"], ["费用与结算", "/finance"],
    ["作业标准", "/standards"], ["系统管理", "/system"], ["输电设备台账", "/ledger"],
  ];
  for (const [name, path] of modules) {
    await selectNavigation(page, name);
    await page.waitForURL(url => url.hash === '#' + path);
    await page.reload();
    await page.getByRole("heading", { name: name === "年度框架" ? "年度框架" : name, exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForURL(/page=2/);
  const listUrl = page.url();
  await page.getByRole('row').filter({ hasText: '路由验收00线' }).getByRole('button', { name: '查看', exact: true }).click();
  await detail.getByRole('heading', { name: /路由验收00线/ }).waitFor();
  assert.equal(page.url(), listUrl);
  assert.ok(await page.getByRole('heading', { name: '输电设备台账', exact: true }).isVisible());
  await closeDetail();
  assert.equal(await page.locator('.el-pager .is-active').innerText(), '2');
  const search = page.getByPlaceholder('搜索名称或真实属性');
  await search.fill('路由验收17线');
  await search.press('Enter');
  await page.getByRole('row').filter({ hasText: '路由验收17线' }).getByRole('button', { name: '查看', exact: true }).click();
  await closeDetail();
  assert.equal(await search.inputValue(), '路由验收17线');
  assert.equal(await page.locator('.el-pager .is-active').innerText(), '1');
  await page.reload();
  assert.equal(await search.inputValue(), '路由验收17线');
  await page.getByRole('button', { name: '筛选线路名称', exact: true }).click();
  await page.getByPlaceholder('筛选线路名称', { exact: true }).fill('17');
  await page.getByPlaceholder('筛选线路名称', { exact: true }).press('Enter');
  await page.locator('main h1').click();
  await page.getByRole('columnheader', { name: /线路名称/ }).locator('.caret-wrapper').click();
  await page.waitForURL(url => url.hash.includes('sort=name'));
  await page.reload();
  await page.getByRole('row').filter({ hasText: '路由验收17线' }).waitFor();
  assert.match(await page.getByRole('columnheader', { name: /线路名称/ }).getAttribute('class'), /ascending|descending/);
  await page.getByRole('button', { name: '筛选线路名称', exact: true }).click();
  assert.equal(await page.getByPlaceholder('筛选线路名称', { exact: true }).inputValue(), '17');
  await page.locator('main h1').click();
  await selectNavigation(page, "基础数据");
  await page.getByRole('tab', { name: '电压等级', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '500kV' }).getByRole('button', { name: '更多操作' }).click();
  const beforeHistory = page.url();
  await page.getByRole('menuitem', { name: '历史', exact: true }).click();
  await detail.getByRole('heading', { name: '完整版本与审计历史', exact: true }).waitFor();
  assert.equal(page.url(), beforeHistory);
  await closeDetail();
  await page.goBack();
  await page.getByRole('tab', { name: '线路', exact: true }).waitFor();
  assert.equal(await search.inputValue(), '路由验收17线');
  await page.goForward();
  await page.getByRole('row').filter({ hasText: '500kV' }).waitFor();

  await selectNavigation(page, '费用与结算');
  await page.waitForURL(url => url.hash === '#/finance');
  await page.getByRole('tab', { name: '项目办理', exact: true }).click();
  const financeUrl = page.url();
  await page.getByRole('button', { name: '进入项目', exact: true }).click();
  await detail.getByRole('heading', { name: '独立结算单', exact: true }).waitFor();
  assert.equal(page.url(), financeUrl);
  await page.screenshot({ path: join(output, 'project-modal.png'), fullPage: true });
  await closeDetail();
  await page.reload();
  assert.equal(await detail.count(), 0);
  // Validation awaits must still reserve a save before a second click.
  await selectNavigation(page, '子项目管理');
  await page.getByRole('button', { name: '新增子项目', exact: true }).click();
  const editor = page.locator('.el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible');
  await editor.getByLabel('项目名称', { exact: true }).fill('防重复保存项目');
  await editor.getByLabel('年度框架', { exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '年度框架 · 2026', exact: true }).click();
  let writes = 0;
  const countWrite = request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects') writes++; };
  page.on('request', countWrite);
  await editor.getByRole('button', { name: '保存', exact: true }).evaluate(button => { button.click(); button.click(); });
  await editor.waitFor({ state: 'hidden' });
  page.off('request', countWrite);
  assert.equal(writes, 1);
  assert.equal(s.projects.list().filter(row => row.name === '防重复保存项目').length, 1);
  await page.goto(`${base}/#/unknown/path`);
  await page.getByText('页面不存在', { exact: true }).waitFor();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.goto(`${base}/#/ledger`);
  await login('route-reader', 'Route-reader-password');
  await page.getByRole('row').filter({ hasText: '路由验收34线' }).getByRole('button', { name: '查看', exact: true }).click();
  await detail.getByRole('heading', { name: /路由验收34线/ }).waitFor();
  assert.ok(await detail.getByRole('button', { name: '编辑', exact: true }).isDisabled());
  await closeDetail();
  await page.goto(`${base}/#/system/audit`);
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  assert.equal((await page.request.get(`${base}/api/audit`)).status(), 403);
  assert.deepEqual(errors, []);
  console.log('NAVIGATION_BROWSER_OK module history and refresh, modal views without navigation, list state, formal history and viewer authorization');
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  console.log('FAILURE_URL', page.url(), 'ERRORS', errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
