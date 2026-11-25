import {inspect} from "../inspector.mjs";
import { columnIndex } from "../workbook-helpers.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fixture, approvedFixture } from "../helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import { approvalPositionLabel } from "../../dist/server/shared/approval-position-label.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";

test("new demands use business names and stable import references, with protected identity roundtrip", async (t) => {
  const { s, user, operation, towers } = fixture(t, { quantity_precision: 2 }),
    exchange = createExchange(s);
  const buffer = await makeWorkbook("demands", {
    documents: [
      {
        operation_name: operation.name,
        problem_description: "无技术身份录入",
        completion_standard: "安装牢固",
      },
    ],
    work_locations: [
      {
        location_kind: "physical_tower",
        asset_no: towers[0].asset_no,
        quantity_scaled: 20000,
      },
    ],
  });
  const preview = await exchange.preview(user, "demands", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const result = exchange.commit(user, preview.token, {
    request_key: "business-name-create",
    atomic: true,
  });
  const created = s.demands.get(result.results[0].id);
  assert.match(created.demand_no, /^XQ-/);
  assert.equal(created.quantity_scaled, 20000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await exchange.exportData(user, "demands", { ids: [created.id] }),
  );
  const root = workbook.getWorksheet("需求清单");
  for (const key of ["id", "expected_version", "operation_id"]) {
    const column = columnIndex(root, key);
    assert.ok(column > 0);
    assert.equal(root.getColumn(column).hidden, true);
  }
  assert.equal(root.getColumn(columnIndex(root,"demand_no")).hidden,false);
  const positions = workbook.getWorksheet("作业位置");
  const quantity = columnIndex(positions, "quantity_scaled");
  positions.getRow(2).getCell(quantity).value = "3.5";
  const revision = await exchange.preview(
    user,
    "demands",
    Buffer.from(await workbook.xlsx.writeBuffer()),
    { mode: "update" },
  );
  assert.equal(revision.issues.length, 0, JSON.stringify(revision.issues));
  exchange.commit(user, revision.token, {
    request_key: "business-name-revise",
    atomic: true,
  });
  assert.equal(s.demands.get(created.id).quantity_scaled, 35000);
  assert.equal(s.demands.get(created.id).current_version, 2);
});

test("asset workbook creates complete lines and towers, reuses explicit physical sharing and rejects ambiguity", async (t) => {
  const { s, user } = fixture(t),
    exchange = createExchange(s);
  s.catalog.save(user, "voltages", { name: "220kV" });
  const workbook = await makeWorkbook("assets", {
    documents: [
      { name: "甲回", voltage_name: "220kV" },
      { name: "乙回", voltage_name: "220kV" },
    ],
    towers: [
      { line_name: "甲回", tower_no: "#1", asset_no: "甲实物" },
      { line_name: "乙回", tower_no: "#2" },
    ],
  });
  let preview = await exchange.preview(user, "assets", workbook);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const committed = exchange.commit(user, preview.token, {
    request_key: "asset-batch-create",
    atomic: true,
  });
  assert.equal(committed.results.length, 4);
  const first = s.catalog.list("towers").find((row) => row.tower_no === "#1");
  const before = s.catalog.list("physical").length;
  preview = await exchange.preview(
    user,
    "assets",
    await makeWorkbook("assets", {
      towers: [
        {
          line_name: "乙回",
          tower_no: "#1",
          sharing_line_name: "甲回",
          sharing_tower_no: "#1",
        },
      ],
    }),
  );
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  exchange.commit(user, preview.token, {
    request_key: "asset-shared-create",
    atomic: true,
  });
  assert.equal(s.catalog.list("physical").length, before);
  assert.equal(
    s.catalog
      .list("towers")
      .filter((row) => row.physical_tower_id === first.physical_tower_id)
      .length,
    2,
  );
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(await exchange.exportData(user, "assets"));
  const sheet = exported.getWorksheet("杆塔"),
    teamColumn = columnIndex(sheet, "operations_team");
  sheet.getRow(2).getCell(teamColumn).value = "独立运维班组";
  preview = await exchange.preview(
    user,
    "assets",
    Buffer.from(await exported.xlsx.writeBuffer()),
    { mode: "update" },
  );
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  exchange.commit(user, preview.token, {
    request_key: "asset-maintenance-revise",
    atomic: true,
  });
  assert.ok(
    s.catalog
      .list("towers")
      .some((row) => row.operations_team === "独立运维班组"),
  );
  const voltage = s.catalog.list("voltages")[0];
  s.catalog.save(user, "lines", { name: "甲回", voltage_level_id: voltage.id });
  preview = await exchange.preview(
    user,
    "assets",
    await makeWorkbook("assets", {
      towers: [{ line_name: "甲回", tower_no: "#99" }],
    }),
  );
  assert.ok(preview.issues.some((problem) => problem.reason.includes("歧义")));
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("new settlement workbook needs business descriptions only and maintenance exports readable descriptions", async (t) => {
  const { s, user, project, demand, scope, node } = approvedFixture(t),
    exchange = createExchange(s);
  const buffer = await makeWorkbook("settlements", {
    documents: [{ project_name: project.name, basis: "按实际费用补结" }],
    items: [
      {
        cost_node_path: node.name,
        demand_description: demand.problem_description,
        quantity_scaled: 10000,
        amount_fen: 12345,
        evidence: "费用事实",
      },
    ],
    resolutions: [
      {
        demand_description: demand.problem_description,
        location_label: approvalPositionLabel(project.approvals[0].scopes[0].locations[0]),
        resolved_quantity_scaled: 0,
        evidence: "仅结费用",
      },
    ],
  });
  const preview = await exchange.preview(user, "settlements", buffer);
  assert.deepEqual(preview.issues, []);
  const result = exchange.commit(user, preview.token, {
    request_key: "business-only-bill",
    atomic: true,
  });
  const bill = s.finance.settlement(result.results[0].id);
  assert.match(bill.number, /^JS-/);
  assert.equal(bill.draft.document.items[0].cost_node_id, node.id);
  assert.equal(bill.draft.document.resolutions[0].project_scope_id, scope.id);
  assert.equal(bill.draft.document.resolutions[0].resolved_quantity_scaled, 0);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await exchange.exportData(user, "settlements", { ids: [bill.id] }),
  );
  for (const name of ["费用明细", "需求解决明细"]) {
    const sheet = workbook.getWorksheet(name);
    const column = columnIndex(sheet, "demand_description");
    assert.equal(
      sheet.getRow(2).getCell(column).value,
      demand.problem_description,
    );
  }
});

test("asset preflight identifies every duplicated new tower and commit failure rolls all objects back", async (t) => {
  const { s, user } = fixture(t),
    exchange = createExchange(s);
  const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
  const line = s.catalog.save(user, "lines", {
    name: "原子台账线",
    voltage_level_id: voltage.id,
  });
  const duplicate = await exchange.preview(
    user,
    "assets",
    await makeWorkbook("assets", {
      towers: [
        { line_name: line.name, tower_no: "#9" },
        { line_name: line.name, tower_no: "#9" },
      ],
    }),
  );
  assert.equal(duplicate.summary.invalid_documents, 2);
  assert.equal(duplicate.documents.length, 0);
  const preview = await exchange.preview(
    user,
    "assets",
    await makeWorkbook("assets", {
      documents: [{ name: "须整批回滚", voltage_name: "220kV" }],
      towers: [{ line_name: "须整批回滚", tower_no: "#1" }],
    }),
  );
  assert.deepEqual(preview.issues, []);
  const before = s.catalog.list("physical").length;
  const save = s.catalog.save;
  s.catalog.save = (...args) => {
    if (args[1] === "towers") throw Error("模拟正式写入失败");
    return save(...args);
  };
  try {
    assert.throws(
      () =>
        exchange.commit(user, preview.token, {
          request_key: "asset-atomic-failure",
          atomic: true,
        }),
      /模拟正式写入失败/,
    );
  } finally {
    s.catalog.save = save;
  }
  assert.equal(s.catalog.list("physical").length, before);
  assert.ok(!s.catalog.list("lines").some((row) => row.name === "须整批回滚"));
});

test("workbooks allow selecting complete rows and editing headers while retaining field bindings", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  s.catalog.save(user, "voltages", { name: "220kV" });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await makeWorkbook("assets", { documents: [{ name: "改表头线路", voltage_name: "220kV" }] }));
  for (const title of ["线路", "物理杆塔", "杆塔", "档距"]) {
    const sheet = book.getWorksheet(title);
    assert.notEqual(sheet.sheetProtection.selectLockedCells, false);
    sheet.getRow(1).eachCell(cell => assert.equal(cell.protection.locked, false));
    for (const column of sheet.columns.filter(column => column.hidden))
      assert.notEqual(column.style.protection?.locked, false);
  }
  const sheet = book.getWorksheet("线路");
  const column = columnIndex(sheet, "name");
  assert.ok(column > 0);
  sheet.getCell(1, column).value = "我的线路名称";
  const preview = await exchange.preview(user, "assets", Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(preview.issues, []);
  exchange.commit(user, preview.token, { request_key: "edited-header-import", atomic: true });
  assert.ok(s.catalog.list("lines").some(row => row.name === "改表头线路"));
});

test("identical tower numbers on different lines create independent physical towers in one atomic workbook", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  s.catalog.save(user, "voltages", { name: "500kV" });
  const buffer = await makeWorkbook("assets", {
    documents: [{ name: "合成甲D011线", voltage_name: "500kV" }, { name: "合成乙D012线", voltage_name: "500kV" }],
    towers: [{ line_name: "合成甲D011线", tower_no: "#001" }, { line_name: "合成乙D012线", tower_no: "#001" }],
  });
  const preview = await exchange.preview(user, "assets", buffer);
  assert.deepEqual(preview.issues, []);
  exchange.commit(user, preview.token, { request_key: "cross-line-same-number", atomic: true });
  const towers = s.catalog.list("towers");
  assert.equal(towers.length, 2);
  assert.notEqual(towers[0].physical_tower_id, towers[1].physical_tower_id);
  const duplicate = await exchange.preview(user, "assets", await makeWorkbook("assets", { towers: [{ line_name: "合成甲D011线", tower_no: "#001" }] }));
  assert.ok(duplicate.issues.some(issue => issue.reason.includes("本线路已有该杆塔号")));
});
