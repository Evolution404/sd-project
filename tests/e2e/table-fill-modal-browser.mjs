import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from '../helpers.mjs';
import { httpServer } from '../../dist/server/platform/http/server.js';

const cleanup = [], { s, user, save } = fixture({ after: action => cleanup.push(action) });
const voltage = save('voltages', { name: '500kV' });
const lines = ['合成甲D011线', '合成乙D012线', '独立同号线'].map(name => save('lines', { name, voltage_level_id: voltage.id }));
const first = save('towers', { line_id: lines[0].id, tower_no: '#001' });
save('towers', { line_id: lines[1].id, tower_no: '#001', physical_tower_id: first.physical_tower_id });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = join(process.cwd(), 'test-results/schema113/table-fill-modals');
mkdirSync(output, { recursive: true });
try {
  await page.goto(`${base}/#/dictionaries/voltages`);
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('Schema113-test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '500kV' }).waitFor();
  for (const theme of ['light', 'dark']) {
    const currentDark = await page.locator("html").evaluate(element => element.classList.contains("dark"));
    if (currentDark !== (theme === "dark")) await page.getByRole("button", { name: theme === "dark" ? "切换为深色" : "切换为浅色", exact: true }).click();
    await page.waitForTimeout(250);
    await page.locator('main h1').click();
    await page.locator('.el-popover:visible').waitFor({ state: 'hidden' });
    for (const width of [1500, 1280, 960, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const geometry = await page.locator('main .el-table').evaluate(table => {
        const body = table.querySelector('.el-table__body').getBoundingClientRect();
        const grid = table.getBoundingClientRect();
        const last = table.querySelector('.el-table__header tr').lastElementChild.getBoundingClientRect();
        return { table: grid.width, body: body.width, right: grid.right, last: last.right };
      });
      assert.ok(geometry.body >= geometry.table - 3, JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.last - geometry.right) < 3, JSON.stringify(geometry));
      await page.screenshot({ path: join(output, `voltage-fill-${theme}-${width}.png`), fullPage: true });
    }
  }
  // Even when every column has a saved width, one data column fills spare space.
  await page.evaluate(() => localStorage.setItem('sd-columns:catalog:voltages', JSON.stringify({ order: [], hidden: [], fixed: [], widths: { name: 140, status: 140, __actions: 180 } })));
  await page.reload();
  await page.getByRole('row').filter({ hasText: '500kV' }).waitFor();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForFunction(() => {
    const table = document.querySelector('main .el-table');
    const body = table?.querySelector('.el-table__body');
    return !!table && !!body &&
      body.getBoundingClientRect().width >= table.getBoundingClientRect().width - 3;
  }, null, { timeout: 4000 });
  const savedLayout = await page.locator('main .el-table').evaluate(table => ({ body: table.querySelector('.el-table__body').getBoundingClientRect().width, table: table.getBoundingClientRect().width }));
  assert.ok(savedLayout.body >= savedLayout.table - 3, JSON.stringify(savedLayout));
  await page.goto(`${base}/#/ledger/physical`);
  await page.getByRole('tab', { name: '物理杆塔', exact: true }).click();
  assert.equal(await page.locator('.el-table__expand-column').count(), 0);
  const url = page.url();
  await page.getByRole('row').filter({ hasText: '合成甲D011线' }).locator(".cell-link:visible").first().click();
  const detail = page.locator('.business-detail-dialog:visible');
  await detail.getByText('关联逻辑杆塔（2）', { exact: true }).waitFor();
  await page.waitForTimeout(350);
  for (const name of ['合成甲D011线', '合成乙D012线'])
    await detail.getByRole('row').filter({ hasText: name }).waitFor();
  assert.equal(page.url(), url);
  await page.screenshot({ path: join(output, 'physical-associated-towers-modal.png'), fullPage: true });
  await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  await detail.waitFor({ state: 'hidden' });
  assert.equal(page.url(), url);
  assert.equal(s.catalog.get('towers', first.id).physical_tower_id, first.physical_tower_id);
  assert.deepEqual(errors, []);
  console.log('TABLE_FILL_MODAL_BROWSER_OK sparse columns fill 8 layouts, no physical expand rows, associated circuits in modal, URL unchanged');
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
