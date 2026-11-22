import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { approvedFixture } from "../helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";
test("settlement workbook creates draft only, preserves independent resolution and revises approved history", async (t) => {
  const { s, user, project, scope, approval, node } = approvedFixture(t),
    exchange = createExchange(s);
  const buffer = await makeWorkbook("settlements", {
    documents: [
      {
        number: "IMPORT-S01",
        project_id: project.id,
        approval_version_id: approval.id,
        expected_version: 0,
      },
    ],
    items: [
      {
        number: "IMPORT-S01",
        cost_node_id: node.id,
        project_scope_id: scope.id,
        quantity_scaled: 10000,
        amount_fen: 30001,
        evidence: "结算依据",
      },
    ],
    resolutions: [
      {
        number: "IMPORT-S01",
        project_scope_id: scope.id,
        resolved_quantity_scaled: 0,
        evidence: "补结费用",
      },
    ],
  });
  let preview = await exchange.preview(user, "settlements", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  let result = exchange.commit(user, preview.token, {
    request_key: "settle-import-key1",
    atomic: true,
  });
  let bill = s.finance.settlement(result.results[0].id);
  assert.equal(bill.version, null);
  assert.equal(bill.draft.document.resolutions[0].resolved_quantity_scaled, 0);
  bill = s.finance.submit(user, bill.id, {
    expected_version: 0,
    expected_edit_version: 1,
  });
  bill = s.finance.review(user, bill.id, {
    expected_version: 1,
    expected_event_seq: 1,
    action: "approve",
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await exchange.exportData(user, "settlements", { ids: [bill.id] }),
  );
  workbook.getWorksheet("费用明细").getCell("F2").value = "350.99";
  preview = await exchange.preview(
    user,
    "settlements",
    Buffer.from(await workbook.xlsx.writeBuffer()),
    { mode: "update" },
  );
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  exchange.commit(user, preview.token, { request_key: "settle-import-key2" });
  bill = s.finance.settlement(bill.id);
  assert.equal(bill.items[0].amount_fen, 30001);
  assert.equal(bill.draft.document.items[0].amount_fen, 35099);
  const businessReport = new ExcelJS.Workbook();
  await businessReport.xlsx.load(
    await exchange.exportData(user, "settlements", {
      ids: [bill.id],
      report: true,
    }),
  );
  const reportSheet = businessReport.getWorksheet("结算业务报表");
  const reportValue = (header) =>
    reportSheet.getRow(4).getCell(reportSheet.getRow(3).values.indexOf(header))
      .value;
  assert.equal(reportValue("本次草稿金额（元）"), "350.99");
  assert.equal(reportValue("当前已批准金额（元）"), "300.01");
  bill = s.finance.submit(user, bill.id, {
    expected_version: 1,
    expected_edit_version: 1,
  });
  s.finance.review(user, bill.id, {
    expected_version: 2,
    expected_event_seq: 1,
    action: "approve",
  });
  assert.equal(s.finance.history(bill.id).length, 2);
  assert.equal(s.finance.summary(project.id).settlement_fen, 35099);
  assert.equal(
    s.finance.summary(project.id).demands[0].resolved_quantity_scaled,
    0,
  );
});
test("partial success excludes invalid documents, atomic batch rolls back every write", async (t) => {
  const { s, user, project, scope, approval, node } = approvedFixture(t),
    exchange = createExchange(s);
  const make = async (suffix) =>
    makeWorkbook("settlements", {
      documents: [
        {
          number: "GOOD" + suffix,
          project_id: project.id,
          approval_version_id: approval.id,
        },
        {
          number: "BAD" + suffix,
          project_id: project.id,
          approval_version_id: "missing",
        },
      ],
      items: [
        {
          number: "GOOD" + suffix,
          cost_node_id: node.id,
          project_scope_id: scope.id,
          quantity_scaled: 0,
          amount_fen: 100,
          evidence: "凭据",
        },
        {
          number: "BAD" + suffix,
          cost_node_id: node.id,
          quantity_scaled: 0,
          amount_fen: 100,
          evidence: "凭据",
        },
      ],
      resolutions: [
        {
          number: "GOOD" + suffix,
          project_scope_id: scope.id,
          resolved_quantity_scaled: 0,
        },
      ],
    });
  let preview = await exchange.preview(user, "settlements", await make("1"));
  assert.ok(preview.issues.length);
  let result = exchange.commit(user, preview.token, {
    request_key: "partial-import-001",
  });
  assert.equal(result.results.length, 1);
  const report = new ExcelJS.Workbook();
  await report.xlsx.load(await exchange.results(user, preview.token));
  assert.equal(report.getWorksheet("导入结果").rowCount, 3);
  assert.ok(report.getWorksheet("报表标记"));
  assert.equal(s.finance.allSettlements().length, 1);
  preview = await exchange.preview(user, "settlements", await make("2"));
  assert.throws(
    () =>
      exchange.commit(user, preview.token, {
        request_key: "atomic-import-001",
        atomic: true,
      }),
    /全部未写入/,
  );
  assert.equal(s.finance.allSettlements().length, 1);
});

test("project total workbook can round-trip without detail sheets or an artificial new draft", async t => {
  const { s, user, project } = approvedFixture(t);
  const exchange = createExchange(s);
  const input = await makeWorkbook("settlements", {
    documents: [{ number: "TOTAL-EXCEL", project_id: project.id, mode: "按项目总额", amount_fen: 123456 }],
  });
  const imported = await exchange.preview(user, "settlements", input, { projectId: project.id });
  assert.deepEqual(imported.issues, []);
  const result = exchange.commit(user, imported.token, { request_key: "total-excel-draft" });
  const bill = s.finance.settlement(result.results[0].id);
  assert.equal(bill.draft.document.amount_fen, 123456);
  assert.deepEqual(bill.draft.document.items, []);
  const exportData = await exchange.exportData(user, "settlements", { projectId: project.id, ids: [bill.id] });
  const preview = await exchange.preview(user, "settlements", exportData, { mode: "update", projectId: project.id });
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.documents[0].action, "unchanged");
});

test("settlement report distinguishes current approval from a revision and exports frozen units by demand", async t => {
  const { s, user, project, scope, approval, node, demand } = approvedFixture(t);
  const exchange = createExchange(s);
  let bill = s.finance.saveDraft(user, project.id, {
    mode: "project_total", approval_version_id: approval.id, amount_fen: 10000,
    settlement_on: "2026-11-10", basis: "旧批准依据",
    resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 20000, evidence: "现场核实" }],
  });
  bill = s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: bill.draft.edit_version });
  bill = s.finance.review(user, bill.id, { expected_version: 1, expected_event_seq: 1, action: "approve" });
  bill = s.finance.saveDraft(user, project.id, {
    mode: "itemized", approval_version_id: approval.id, change_type: "revision",
    expected_version: 1, expected_edit_version: 0, settlement_on: "2026-11-11", basis: "草稿依据",
    items: [{ cost_node_id: node.id, project_scope_id: scope.id, amount_fen: 12000, quantity_scaled: 10000, evidence: "草稿明细依据" }],
  }, bill.id);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exchange.exportData(user, "settlements", { ids: [bill.id], report: true }));
  const cell = (sheetName, heading) => {
    const sheet = workbook.getWorksheet(sheetName);
    const headerRow = sheetName === "结算业务报表" ? 3 : 1;
    return sheet.getRow(headerRow + 1).getCell(sheet.getRow(headerRow).values.indexOf(heading)).value;
  };
  const main = "结算业务报表";
  assert.equal(cell(main, "当前生效结算方式"), "按项目总额");
  assert.equal(cell(main, "当前生效结算依据"), "旧批准依据");
  assert.equal(cell(main, "草稿结算方式"), "按子费用");
  assert.equal(cell(main, "草稿结算依据"), "草稿依据");
  assert.equal(cell("生效需求解决量", "需求编号"), demand.demand_no);
  assert.equal(cell("生效需求解决量", "解决量"), "2.0000");
  assert.equal(cell("生效需求解决量", "计量单位"), "套");
});

test("the same workbook finds its prior result and two pending uploads cannot create duplicate settlement drafts", async t => {
  const { s, user, project } = approvedFixture(t);
  const exchange = createExchange(s);
  const input = await makeWorkbook("settlements", { documents: [{ amount_fen: 5500 }] });
  const context = { projectId: project.id };
  const first = await exchange.preview(user, "settlements", input, context);
  const concurrent = await exchange.preview(user, "settlements", input, context);
  assert.equal(first.summary.created, 1);
  const record = exchange.commit(user, first.token, { request_key: "duplicate-xlsx-first" });
  assert.throws(() => exchange.commit(user, concurrent.token, { request_key: "duplicate-xlsx-concurrent" }), /已被导入/);
  const repeated = await exchange.preview(user, "settlements", input, context);
  assert.deepEqual(repeated.previous, record);
  assert.equal(repeated.documents.length, 0);
  assert.equal(s.finance.settlements(project.id).length, 1);
  const next = await exchange.preview(user, "settlements", input, { ...context, newSettlement: true });
  assert.equal(next.summary.created, 1);
  exchange.commit(user, next.token, { request_key: "duplicate-xlsx-next-period" });
  assert.equal(s.finance.settlements(project.id).length, 2);
});
