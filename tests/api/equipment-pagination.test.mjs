import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

test("equipment catalog applies search, sorting and filters before SQL pagination", (t) => {
  const { s, user } = fixture(t);
  const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
  const lines = Array.from({ length: 64 }, (_, i) =>
    s.catalog.save(user, "lines", {
      name: "测试线路" + String(i).padStart(3, "0"),
      voltage_level_id: voltage.id,
    }));
  const first = s.catalog.search("lines", {
    q: "测试线路", page: 1, page_size: 10, sort: "name", direction: "asc",
  });
  assert.equal(first.total, 64);
  assert.equal(first.items.length, 10);
  assert.equal(first.items[0].name, "测试线路000");
  const last = s.catalog.search("lines", {
    q: "测试线路", page: 7, page_size: 10, sort: "name", direction: "asc",
  });
  assert.equal(last.items.length, 4);
  assert.equal(last.items[0].name, "测试线路060");
  const filtered = s.catalog.search("lines", {
    filters: JSON.stringify({ name: "测试线路050" }),
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].name, "测试线路050");
  const byVoltage = s.equipment.search("lines", { filters: { voltage_level_id: voltage.id }, page_size: 1 });
  assert.equal(byVoltage.total, 64);
  assert.equal(byVoltage.items.length, 1);
  assert.equal(s.equipment.search("lines", { filters: { voltage_level_id: voltage.id.slice(0, 10) } }).total, 0);
  const attemptedInjection = s.catalog.search("lines", {
    sort: "name; DROP TABLE physical_towers", page_size: 10,
  });
  assert.equal(attemptedInjection.total, 64 + s.catalog.list("lines").length - 64);
  const physical = s.catalog.save(user, "physical", { tower_material: "angle" });
  s.catalog.save(user, "towers", {
    line_id: lines[50].id, tower_no: "#18",
    physical_tower_id: physical.id, physical_mode: "shared",
  });
  const physicalResult = s.catalog.search("physical", {
    q: "测试线路050", filters: { related_towers: "#18" },
  });
  assert.equal(physicalResult.total, 1);
  assert.equal(physicalResult.items[0].current_circuits, 1);
  assert.equal(physicalResult.items[0].bindings[0].tower_no, "#18");
  const towerResult = s.catalog.search("towers", {
    lineId: lines[50].id, page_size: 20,
  });
  assert.equal(towerResult.total, 1);
  assert.equal(towerResult.items[0].tower_no, "#18");
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("span length bounds use inclusive metres with exact stored millimetres", (t) => {
  const { s, user, save } = fixture(t);
  const voltage = save("voltages", { name: "35kV测试" });
  const line = save("lines", { name: "长度范围合成线路", voltage_level_id: voltage.id, status: "active" });
  const towers = Array.from({ length: 4 }, (_, index) =>
    s.equipment.save(user, "towers", { line_id: line.id, tower_no: String(index + 1) }));
  const spans = [0, 130125, null].map((length, index) =>
    s.equipment.save(user, "spans", { line_id: line.id, start_tower_id: towers[index].id,
      end_tower_id: towers[index + 1].id, transmission_center_length_mm: length }));
  const query = filters => s.equipment.search("spans", { filters: { line_name: line.name, ...filters } });
  assert.deepEqual(query({ length_min: "130", length_max: "130.125" }).items.map(row => row.id), [spans[1].id]);
  assert.deepEqual(query({ length_max: "0" }).items.map(row => row.id), [spans[0].id]);
  assert.equal(query({ length_min: "130.126" }).total, 0);
  assert.throws(() => query({ length_min: "1.0001" }), /最多三位小数/);
  assert.throws(() => query({ length_min: "131", length_max: "130" }), /最短管辖长度不能超过/);
});
