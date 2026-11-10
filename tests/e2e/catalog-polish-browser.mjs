import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { fixture } from '../helpers.mjs';
import { httpServer } from '../../server/http/server.mjs';
import { columnIndex } from '../workbook-helpers.mjs';

const cleanup = [], { s, save } = fixture({ after: action => cleanup.push(action) });
const voltage = save('voltages', { name: '500kV' });
for (const name of ['01线路', '02线路']) save('lines', { name, voltage_level_id: voltage.id });
const spanUnit = save('units', { name: '处' });
const spanObject = save('objects', { name: '导线', work_target_type: 'line' });
const spanOperation = save('operations', {
  name: '处理导线缺陷', work_object_id: spanObject.id, default_unit_id: spanUnit.id,
  work_target_type: 'line', allow_tower: 0, allow_span: 1, default_location_kind: 'span',
});
const server = httpServer(s);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = join(process.cwd(), 'test-results/schema113/catalog-polish');
mkdirSync(output, { recursive: true });
const editor = page.locator('.el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible');
async function select(label, name) {
  await editor.getByLabel(label, { exact: true }).press('ArrowDown');
  await page.getByRole('option', { name, exact: true }).last().click();
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/ledger`);
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('Schema113-test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('cell', { name: '01线路', exact: true }).waitFor();
  for (let index = 0; index < 8; index++) {
    const ascending = index % 2 === 0;
    const response = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/catalog/lines' && url.searchParams.get('sort') === 'name'
        && url.searchParams.get('direction') === (ascending ? 'asc' : 'desc');
    });
    await page.getByRole('columnheader', { name: /线路名称/ }).locator('.business-column-title').click();
    await response;
    await page.waitForFunction(expected => document.querySelector('main .el-table__body .el-table__row')?.textContent.includes(expected), ascending ? '01线路' : '02线路');
    assert.match(await page.getByRole('columnheader', { name: /线路名称/ }).getAttribute('class'), ascending ? /ascending/ : /descending/);
  }
  assert.equal(await page.getByRole('columnheader', { name: /架设方式/ }).count(), 0);
  await page.getByRole('button', { name: '新增线路', exact: true }).click();
  assert.equal(await editor.getByLabel('架设方式', { exact: true }).count(), 0);
  assert.equal(await editor.getByRole('tab', { name: '影响与预览', exact: true }).count(), 0);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('tab', { name: '逻辑杆塔', exact: true }).click();
  await page.getByRole('button', { name: '新增逻辑杆塔', exact: true }).click();
  await select('所属线路', '01线路 · 500kV');
  await editor.getByLabel('杆塔号', { exact: true }).fill('#009');
  await select('杆塔性质', '耐张');
  await page.screenshot({ path: join(output, 'tower-nature-dropdown.png'), fullPage: true });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal(s.catalog.list('towers')[0].tower_nature, 'tension');
  await page.getByRole('cell', { name: '耐张', exact: true }).waitFor();
  await page.getByRole('menuitem', { name: '作业标准与参考价格', exact: true }).click();
  await page.getByRole('columnheader', { name: /默认作业位置/ }).waitFor();
  const spanRow = page.getByRole('row').filter({ hasText: '处理导线缺陷' });
  await spanRow.getByRole('cell', { name: '档距', exact: true }).waitFor();
  await spanRow.getByRole('cell', { name: '是', exact: true }).waitFor();
  await spanRow.getByRole('cell', { name: '否', exact: true }).waitFor();
  const towerRow = page.getByRole('row').filter({ hasText: '安装防鸟装置' });
  await towerRow.getByRole('cell', { name: '杆塔', exact: true }).waitFor();
  assert.doesNotMatch(await spanRow.innerText(), /\bspan\b|\btower\b/);
  assert.equal(s.catalog.get('operations', spanOperation.id).default_location_kind, 'span');
  await spanRow.getByRole('button', { name: '查看', exact: true }).click();
  const detail = page.locator('.business-detail-dialog:visible');
  await detail.getByText('默认作业位置', { exact: true }).waitFor();
  await detail.getByText('档距', { exact: true }).waitFor();
  await detail.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('button', { name: '新增操作类型', exact: true }).click();
  assert.equal(await editor.getByRole('tab').count(), 4);
  assert.equal(await editor.getByText('影响与预览', { exact: true }).count(), 0);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('menuitem', { name: '专业需求', exact: true }).click();
  await page.getByRole('button', { name: 'Excel 批量处理', exact: true }).click();
  const received = page.waitForEvent('download');
  await page.getByRole('button', { name: '空白模板', exact: true }).click();
  const file = await received;
  assert.equal(file.suggestedFilename(), '需求模板.xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(await file.path()));
  const sheet = book.getWorksheet('需求清单');
  assert.equal(sheet.getCell(1, columnIndex(sheet, 'operation_name')).value, '新增必填\n操作类型名称');
  assert.equal(sheet.getCell(1, columnIndex(sheet, 'problem_description')).value, '新增必填\n问题描述');
  sheet.getRow(1).eachCell(cell => assert.doesNotMatch(String(cell.value), /[A-Za-z_|]/));
  assert.deepEqual(errors, []);
  console.log('CATALOG_POLISH_BROWSER_OK 8 alternating header clicks, removed field and impact tab, shared physical nature dropdown, Chinese filename and required Chinese headers');
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  console.log('CATALOG_POLISH_ERRORS', errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}
