import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { makeWorkbook, parseWorkbook } from "../../server/exchange/workbook.mjs";
import { columnIndex } from "../workbook-helpers.mjs";
import ExcelJS from "exceljs";

test("span length: metadata uses metres while stored facts, history, and API are precise integer mm", (t) => {
  const { s, save, user } = fixture(t);
  const def = s.catalog.definitions.spans.fields.find(f => f.key === "transmission_center_length_mm");
  assert.equal(def.label, "输电中心管辖长度（米）");
  assert.equal(def.type, "length_m");
  const voltage = save("voltages", { name: "110kV" });
  const line = save("lines", { name: "测试档距米", voltage_level_id: voltage.id });
  const a = save("towers", { line_id: line.id, tower_no: "#1" });
  const b = save("towers", { line_id: line.id, tower_no: "#2" });
  const base = { line_id: line.id, start_tower_id: a.id, end_tower_id: b.id };
  const span = save("spans", { ...base, transmission_center_length_mm: 125750 });
  assert.equal(span.transmission_center_length_mm, 125750);
  assert.ok(s.catalog.search("spans", { q: "125.75" }).items.some(x => x.id === span.id));
  assert.ok(s.catalog.search("spans", { filters: { transmission_center_length_mm: "125.75" } }).items.some(x => x.id === span.id));
  assert.equal(s.catalog.search("spans", { filters: { transmission_center_length_mm: "125750" } }).total, 0);
  const next = s.catalog.save(user, "spans", { ...base, transmission_center_length_mm: 130125, expected_version: span.version }, span.id);
  assert.equal(next.transmission_center_length_mm, 130125);
  const history = s.repo.where("line_span_history", { span_id: span.id });
  assert.ok(history.some(row => row.transmission_center_length_mm === 125750));
  assert.ok(history.some(row => row.transmission_center_length_mm === 130125));
  assert.equal(s.catalog.search("spans", { filters: { transmission_center_length_mm: "130.125" } }).total, 1);
  assert.equal(s.catalog.search("spans", { filters: { transmission_center_length_mm: "125.75" } }).total, 0);
});

test("span length: missing is unknown; explicit zero is valid; Excel roundtrip uses metres to 3 decimals", async (t) => {
  const { s, save } = fixture(t);
  const voltage = save("voltages", { name: "220kV" });
  const line = save("lines", { name: "档距未核定", voltage_level_id: voltage.id });
  const a = save("towers", { line_id: line.id, tower_no: "1" });
  const b = save("towers", { line_id: line.id, tower_no: "2" });
  const span = save("spans", { line_id: line.id, start_tower_id: a.id, end_tower_id: b.id });
  assert.equal(span.transmission_center_length_mm, null);
  const zero = s.catalog.save(s.auth.login("admin", "Schema113-test-password").user, "spans", {
    expected_version: span.version, transmission_center_length_mm: 0,
  }, span.id);
  assert.equal(zero.transmission_center_length_mm, 0);
  const workbookBuffer = await makeWorkbook("assets", {
    documents: [{ name: "示例线路", voltage_name: "220kV" }],
    spans: [{ line_name: "示例线路", start_tower_no: "1", end_tower_no: "2",
      transmission_center_length_mm: 125750 }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer);
  const sheet = workbook.getWorksheet("档距");
  const column = columnIndex(sheet, "transmission_center_length_mm");
  assert.equal(sheet.getCell(1, column).value, "输电中心管辖长度（米）");
  assert.equal(Number(sheet.getRow(2).getCell(column).value), 125.75);
  const parsed = await parseWorkbook(workbookBuffer, "assets");
  assert.equal(parsed.rows.spans[0].transmission_center_length_mm, 125750);
});
