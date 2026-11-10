import { columnIndex } from "../workbook-helpers.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fixture } from "../helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.mjs";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.mjs";

const headerIndex = columnIndex;

test("single workbook creates main line, junction tower, branch, both circuits and explicit spans in dependency order", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  s.catalog.save(user, "voltages", { name: "220kV" });
  const buffer = await makeWorkbook("assets", {
    documents: [
      { name: "演示支线", voltage_name: "220kV", line_kind: "branch",
        parent_line_name: "演示主线", parent_voltage_name: "220kV",
        junction_tower_no: "#2" },
      { name: "演示主线", voltage_name: "220kV", line_kind: "main" },
    ],
    towers: [
      { line_name: "演示支线", tower_no: "#S1", tower_type: "直线塔" },
      { line_name: "演示主线", tower_no: "#2", tower_type: "耐张塔" },
      { line_name: "演示主线", tower_no: "#1", tower_type: "直线塔" },
    ],
    spans: [
      { line_name: "演示支线", start_line_name: "演示主线",
        start_tower_no: "#2", end_tower_no: "#S1",
        transmission_center_length_mm: 1255000, status: "active" },
      { line_name: "演示主线", start_tower_no: "#1", end_tower_no: "#2",
        transmission_center_length_mm: 550000, status: "active" },
    ],
  });
  const preview = await exchange.preview(user, "assets", buffer);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.summary.documents, 7);
  const kinds = preview.documents.map((doc) => doc.kind);
  assert.ok(kinds.indexOf("lines") < kinds.indexOf("towers"));
  assert.ok(kinds.lastIndexOf("spans") > kinds.lastIndexOf("towers"));
  const result = exchange.commit(user, preview.token, {
    request_key: "topology-branch-main-single-workbook", atomic: true,
  });
  assert.equal(result.results.length, 7);
  const main = s.catalog.list("lines").find((row) => row.name === "演示主线"),
    branch = s.catalog.list("lines").find((row) => row.name === "演示支线");
  assert.ok(main && branch);
  const towers = s.catalog.list("towers");
  const junction = towers.find((row) => row.line_id === main.id && row.tower_no === "#2"),
    branchEnd = towers.find((row) => row.line_id === branch.id && row.tower_no === "#S1");
  assert.equal(branch.parent_line_id, main.id);
  assert.equal(branch.junction_tower_id, junction.id);
  const spans = s.catalog.list("spans");
  assert.equal(spans.length, 2);
  const branchSpan = spans.find((row) => row.line_id === branch.id);
  assert.equal(branchSpan.start_tower_id, junction.id);
  assert.equal(branchSpan.end_tower_id, branchEnd.id);
  assert.equal(branchSpan.transmission_center_length_mm, 1255000);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);

  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(await exchange.exportData(user, "assets", {
    ids: [branch.id],
  }));
  const lineSheet = exported.getWorksheet("线路"),
    spanSheet = exported.getWorksheet("档距"),
    towerSheet = exported.getWorksheet("杆塔");
  assert.equal(lineSheet.rowCount, 2);
  assert.equal(towerSheet.rowCount, 2);
  assert.equal(spanSheet.rowCount, 2);
  for (const sheet of [lineSheet, towerSheet, spanSheet])
    for (const column of sheet.columns)
      if (!column.hidden)
        assert.ok(!String(column.header).includes("|"),
          "业务字段不能展示数据库技术名称：" + column.header);
  assert.equal(lineSheet.getRow(2).getCell(headerIndex(lineSheet, "parent_line_name")).value, main.name);
  assert.equal(lineSheet.getRow(2).getCell(headerIndex(lineSheet, "junction_tower_no")).value, "#2");
  assert.equal(spanSheet.getRow(2).getCell(headerIndex(spanSheet, "start_line_name")).value, main.name);
  assert.equal(Number(spanSheet.getRow(2).getCell(headerIndex(spanSheet, "transmission_center_length_mm")).value), 1255);
  for (const column of ["id", "expected_version", "start_tower_id", "end_tower_id"]) {
    assert.equal(spanSheet.getColumn(headerIndex(spanSheet, column)).hidden, true);
  }

  // Safe roundtrip: unedited rows must not create artificial formal versions.
  let recheck = await exchange.preview(user, "assets",
    Buffer.from(await exported.xlsx.writeBuffer()), { mode: "update" });
  assert.deepEqual(recheck.issues, []);
  assert.ok(recheck.documents.every((row) => row.action === "unchanged"));
  exchange.commit(user, recheck.token, {
    request_key: "topology-unchanged-roundtrip", atomic: true,
  });
  assert.equal(s.catalog.get("spans", branchSpan.id).version, branchSpan.version);

  spanSheet.getRow(2).getCell(headerIndex(spanSheet, "transmission_center_length_mm")).value = 1300.25;
  recheck = await exchange.preview(user, "assets",
    Buffer.from(await exported.xlsx.writeBuffer()), { mode: "update" });
  assert.deepEqual(recheck.issues, []);
  const revised = exchange.commit(user, recheck.token, {
    request_key: "topology-length-revision", atomic: true,
  });
  assert.equal(revised.results.length, 4);
  const revisedSpan = s.catalog.get("spans", branchSpan.id);
  assert.equal(revisedSpan.transmission_center_length_mm, 1300250);
  assert.equal(revisedSpan.version, branchSpan.version + 1);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});

test("span preview rejects reversed duplicate pairs and invalid junction; no guessing or hidden automatic topology", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  s.catalog.save(user, "voltages", { name: "220kV" });
  const duplicate = await exchange.preview(user, "assets", await makeWorkbook("assets", {
    documents: [{ name: "独立线路", voltage_name: "220kV" }],
    towers: [
      { line_name: "独立线路", tower_no: "#1" },
      { line_name: "独立线路", tower_no: "#2" },
    ],
    spans: [
      { line_name: "独立线路", start_tower_no: "#1", end_tower_no: "#2" },
      { line_name: "独立线路", start_tower_no: "#2", end_tower_no: "#1" },
    ],
  }));
  assert.equal(duplicate.summary.invalid_documents, 2);
  assert.ok(duplicate.issues.every((row) => row.sheet === "档距"));
  assert.ok(!s.catalog.list("lines").some((row) => row.name === "独立线路"));
  const invalid = await exchange.preview(user, "assets", await makeWorkbook("assets", {
    documents: [
      { name: "错误支线", voltage_name: "220kV", line_kind: "branch",
        parent_line_name: "未建立主线", junction_tower_no: "#99" },
    ],
  }));
  assert.ok(invalid.issues.some((row) => row.reason.includes("不存在")));
  assert.equal(invalid.documents.length, 0);
});

test("span preflight refuses cross-line topology unrelated to the configured branch junction", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
  const main = s.catalog.save(user, "lines", {
    name: "允许接入主线", voltage_level_id: voltage.id,
  });
  const other = s.catalog.save(user, "lines", {
    name: "无关主线", voltage_level_id: voltage.id,
  });
  const mainJunction = s.catalog.save(user, "towers", {
    line_id: main.id, tower_no: "#1",
  });
  s.catalog.save(user, "towers", {
    line_id: other.id, tower_no: "#1",
  });
  const branch = s.catalog.save(user, "lines", {
    name: "被核查支线", voltage_level_id: voltage.id,
    line_kind: "branch", parent_line_id: main.id,
    junction_tower_id: mainJunction.id,
  });
  s.catalog.save(user, "towers", {
    line_id: branch.id, tower_no: "#S1",
  });
  const preview = await exchange.preview(user, "assets", await makeWorkbook("assets", {
    spans: [{
      line_name: branch.name, start_line_name: other.name,
      start_tower_no: "#1", end_tower_no: "#S1",
    }],
  }));
  assert.equal(preview.summary.invalid_documents, 1);
  assert.ok(preview.issues.some((row) =>
    row.reason.includes("只能通过已指定的主线接入杆塔")));
  assert.equal(s.catalog.list("spans").length, 0);
});

test("cyclic cross-sheet sharing and branch junction is rejected for every dependent row", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  s.catalog.save(user, "voltages", { name: "220kV" });
  const preview = await exchange.preview(user, "assets", await makeWorkbook("assets", {
    documents: [
      { name: "循环主线", voltage_name: "220kV", line_kind: "main" },
      { name: "循环支线", voltage_name: "220kV", line_kind: "branch",
        parent_line_name: "循环主线", junction_tower_no: "#1" },
    ],
    towers: [
      { line_name: "循环主线", tower_no: "#1",
        sharing_line_name: "循环支线", sharing_tower_no: "#1" },
      { line_name: "循环支线", tower_no: "#1",
        sharing_line_name: "循环主线", sharing_tower_no: "#1" },
    ],
  }));
  assert.ok(preview.issues.some((row) =>
    row.reason.includes("循环依赖") || row.reason.includes("关联对象无效")));
  assert.ok(preview.summary.invalid_documents >= 2);
  assert.ok(!preview.documents.some((doc) =>
    doc.number === "循环支线" || doc.number.endsWith("· #1")));
  assert.equal(s.catalog.list("towers").length, 0);
});

test("physical sheet selected export and history revision", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
  const line = s.catalog.save(user, "lines", { name: "甲线", voltage_level_id: voltage.id });
  const tower = s.catalog.save(user, "towers", {
    line_id: line.id, tower_no: "#7", physical_properties: { tower_type: "耐张塔", model: "JG-1" },
  });
  const before = s.catalog.get("physical", tower.physical_tower_id);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exchange.exportData(user, "assets", { ids: [before.id] }));
  const sheet = book.getWorksheet("物理杆塔");
  assert.equal(sheet.rowCount, 2, "物理杆塔勾选导出不可为空");
  assert.equal(sheet.getRow(2).getCell(headerIndex(sheet, "tower_type")).value, "耐张塔");
  const unchanged = await exchange.preview(user, "assets",
    Buffer.from(await book.xlsx.writeBuffer()), { mode: "update" });
  assert.deepEqual(unchanged.issues, []);
  assert.equal(unchanged.documents.find(doc => doc.kind === "physical").action, "unchanged");
  sheet.getRow(2).getCell(headerIndex(sheet, "tower_type")).value = "直线塔";
  const preview = await exchange.preview(user, "assets",
    Buffer.from(await book.xlsx.writeBuffer()), { mode: "update" });
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.documents.find(doc => doc.kind === "physical").action, "update");
  exchange.commit(user, preview.token, { request_key: "physical-sheet-v2", atomic: true });
  assert.equal(s.catalog.get("physical", before.id).tower_type, "直线塔");
  assert.equal(s.catalog.get("physical", before.id).version, before.version + 1);
  assert.equal(s.catalog.get("towers", tower.id).physical_tower_id, before.id);
});
test("logical tower Excel physical change is not incorrectly unchanged", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  const voltage = s.catalog.save(user, "voltages", { name: "110kV" });
  const line = s.catalog.save(user, "lines", { name: "乙线", voltage_level_id: voltage.id });
  const tower = s.catalog.save(user, "towers", {
    line_id: line.id, tower_no: "#12", physical_properties: { tower_type: "直线塔" },
  });
  const original = s.catalog.get("physical", tower.physical_tower_id);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exchange.exportData(user, "assets", { ids: [line.id] }));
  const sheet = book.getWorksheet("杆塔");
  assert.equal(sheet.getRow(2).getCell(headerIndex(sheet, "tower_type")).value, "直线塔");
  sheet.getRow(2).getCell(headerIndex(sheet, "tower_type")).value = "耐张塔";
  const preview = await exchange.preview(user, "assets",
    Buffer.from(await book.xlsx.writeBuffer()), { mode: "update" });
  assert.deepEqual(preview.issues, []);
  assert.ok(preview.documents.some(doc => doc.kind === "physical" && doc.action === "update"));
  exchange.commit(user, preview.token, { request_key: "logical-physical-v2", atomic: true });
  assert.equal(s.catalog.get("physical", original.id).tower_type, "耐张塔");
  assert.equal(s.catalog.get("physical", original.id).version, original.version + 1);
});
test("independent physical workbook creates an unlinked entity with automatic identity", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  const beforeCount = s.catalog.list("physical").length;
  const preview = await exchange.preview(user, "assets",
    await makeWorkbook("assets", { physical: [{ tower_type: "钢管杆", model: "GG-2" }] }));
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.documents[0].kind, "physical");
  exchange.commit(user, preview.token, { request_key: "physical-new", atomic: true });
  assert.equal(s.catalog.list("physical").length, beforeCount + 1);
  assert.ok(s.catalog.list("physical").find(row => row.model === "GG-2")?.tower_code);
});


test("conflicting physical-attribute revisions from two shared logical circuits reject atomic Excel commit", async (t) => {
  const { s, user } = fixture(t), exchange = createExchange(s);
  const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
  const main = s.catalog.save(user, "lines", { name: "共享甲线", voltage_level_id: voltage.id });
  const second = s.catalog.save(user, "lines", { name: "共享乙线", voltage_level_id: voltage.id });
  const physical = s.catalog.save(user, "physical", { tower_type: "耐张塔", model: "ZM-1" });
  const first = s.catalog.save(user, "towers", {
    line_id: main.id, tower_no: "#18", physical_mode: "shared", physical_tower_id: physical.id,
  });
  const sibling = s.catalog.save(user, "towers", {
    line_id: second.id, tower_no: "#19", physical_mode: "shared", physical_tower_id: physical.id,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exchange.exportData(user, "assets", { ids: [main.id, second.id] }));
  const towers = workbook.getWorksheet("杆塔");
  assert.equal(towers.rowCount, 3);
  const typeColumn = headerIndex(towers, "tower_type");
  assert.ok(typeColumn > 0);
  towers.getRow(2).getCell(typeColumn).value = "直线塔";
  towers.getRow(3).getCell(typeColumn).value = "钢管杆";
  const before = s.catalog.get("physical", physical.id);
  const preview = await exchange.preview(user, "assets",
    Buffer.from(await workbook.xlsx.writeBuffer()), { mode: "update" });
  assert.ok(preview.issues.some(problem =>
    problem.reason.includes("同一物理杆塔存在互相矛盾")));
  assert.throws(() =>
    exchange.commit(user, preview.token, {
      request_key: "conflicting-shared-physical-excel", atomic: true,
    }), /整批提交包含预检错误/);
  assert.equal(s.catalog.get("physical", physical.id).tower_type, before.tower_type);
  assert.equal(s.catalog.get("physical", physical.id).version, before.version);
  assert.equal(s.catalog.get("towers", first.id).physical_tower_id, physical.id);
  assert.equal(s.catalog.get("towers", sibling.id).physical_tower_id, physical.id);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});
