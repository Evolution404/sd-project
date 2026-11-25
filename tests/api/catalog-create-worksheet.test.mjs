import assert from "node:assert/strict";
import test from "node:test";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import { fixture } from "../helpers.mjs";

test("equipment and material worksheets share domain writes and use stable topology references", t => {
  const { s, user, save, unit, towers } = fixture(t);
  const exchange = createExchange(s);
  const voltage = save("voltages", { name: "220kV" });
  let seq = 0;
  function commit(kind, rows) {
    const preview = exchange.previewAssetWorksheet(user, { kind, rows });
    assert.deepEqual(preview.issues, []);
    const request = { request_key: "online-assets-" + (++seq), atomic: true };
    const saved = exchange.commit(user, preview.token, request);
    assert.deepEqual(exchange.commit(user, preview.token, request), saved);
    return saved.results;
  }
  const [main] = commit("lines", [{ name: "网页主线", voltage_name: voltage.name, line_kind: "主线" }]);
  const physicalBefore = s.equipment.list("physical").length;
  const physicalRows = [{ asset_no: "网页单独实物甲" }, { asset_no: "网页单独实物乙", height_scaled: "14.4001" }];
  const previewPhysical = exchange.previewAssetWorksheet(user, { kind: "physical", rows: physicalRows });
  assert.deepEqual(previewPhysical.issues, []);
  assert.equal(s.equipment.list("physical").length, physicalBefore);
  const physical = commit("physical", physicalRows);
  assert.equal(s.equipment.get("physical", physical[1].id).height_scaled, 144001);
  const [junction, normal] = commit("towers", [
    { line_id: main.id, tower_no: "001", physical_tower_id: towers[0].id },
    { line_id: main.id, tower_no: "002" },
  ]);
  assert.equal(s.equipment.get("towers", junction.id).physical_tower_id, towers[0].id);
  assert.notEqual(s.equipment.get("towers", normal.id).physical_tower_id, towers[0].id);
  assert.equal(s.equipment.list("physical").length, physicalBefore + 3);
  const [branch] = commit("lines", [
    { name: "网页支线", voltage_name: voltage.name, line_kind: "支线", parent_line_id: main.id, junction_tower_id: junction.id },
  ]);
  const [tower] = commit("towers", [{ line_id: branch.id, tower_no: "A-01", physical_tower_id: towers[0].id }]);
  const [span] = commit("spans", [
    { line_id: branch.id, start_tower_id: junction.id, end_tower_id: tower.id, transmission_center_length_mm: "93.125" },
  ]);
  const spanRecord = s.equipment.get("spans", span.id);
  assert.equal(spanRecord.line_id, branch.id);
  assert.equal(spanRecord.start_tower_id, junction.id);
  assert.equal(spanRecord.end_tower_id, tower.id);
  assert.equal(spanRecord.transmission_center_length_mm, 93125);
  const bad = exchange.previewAssetWorksheet(user, { kind: "towers", rows: [
    { line_id: main.id, tower_no: "003" }, { line_id: main.id, tower_no: "001" },
  ] });
  assert.equal(bad.issues.length, 1);
  assert.throws(() => exchange.commit(user, bad.token, { request_key: "online-assets-invalid", atomic: true }), /全部未写入/);
  assert.equal(s.equipment.list("towers").some(row => row.tower_no === "003"), false);
  assert.throws(() => exchange.previewAssetWorksheet({ ...user, permissions: ["read"] }, { kind: "physical", rows: physicalRows }),
    error => error.status === 403);

  const materials = [{ name: "网页物资甲", unit_id: unit.id, model: "AA" }, { name: "网页物资乙", unit_id: "missing" }];
  const invalid = s.materials.createWorksheet(user, materials);
  assert.equal(invalid.issues[0].row, 2);
  assert.equal(s.materials.list().length, 0);
  materials[1].unit_id = unit.id;
  const proof = s.materials.createWorksheet(user, materials);
  assert.deepEqual(proof.issues, []);
  assert.equal(s.materials.list().length, 0);
  assert.throws(() => s.materials.createWorksheet(user, [{ ...materials[0], name: "已改变" }], proof.fingerprint), /重新预检/);
  const saved = s.materials.createWorksheet(user, materials, proof.fingerprint);
  assert.deepEqual(saved.ids.map(key => s.materials.get(key).unit_id), [unit.id, unit.id]);
});
