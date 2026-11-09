import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { approvedFixture } from '../helpers.mjs';
import { httpServer } from '../../server/http/server.mjs';
import { columnIndex } from '../workbook-helpers.mjs';

test('all exchange downloads have Chinese filenames, Chinese headers and required markers', async t => {
  const { s, project } = approvedFixture(t);
  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { token } = s.auth.login('admin', 'Schema113-test-password');
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [kind, label] of [['demands','需求'], ['assets','设备台账'], ['settlements','结算']]) {
    for (const action of ['template', 'export']) {
      const response = await fetch(`${base}/api/exchange/${kind}/${action}?project_id=${project.id}`, { headers: { Cookie: 'sd113=' + token } });
      assert.equal(response.status, 200);
      const filename = decodeURIComponent(response.headers.get('content-disposition').split("UTF-8''")[1]);
      assert.equal(filename, label + (action === 'template' ? '模板.xlsx' : '数据维护.xlsx'));
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
      for (const sheet of book.worksheets.filter(sheet => sheet.name !== '使用说明'))
        sheet.getRow(1).eachCell(cell => assert.doesNotMatch(String(cell.value), /[A-Za-z_|]/, sheet.name));
      if (action === 'template') {
        const [sheetName, field] = ({ demands: ['需求清单','operation_name'], assets: ['线路','name'], settlements: ['费用明细','amount_fen'] })[kind];
        const sheet = book.getWorksheet(sheetName);
        assert.match(sheet.getCell(1, columnIndex(sheet, field)).value, /^新增必填\n/);
        assert.equal(sheet.getRow(1).height, 42);
      }
    }
  }
});
