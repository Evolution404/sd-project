import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRow, detailIdentity, mergeDetails, differences } from "../../dist/server/modules/exchange/details.js";

test("Excel details preserve absent rows, stable business identity, order and frozen facts", () => {
  const old = [
    { material_id: "m1", material_name: "原物资", quantity_scaled: 50000, adopted_version: 2 },
    { material_id: "m2", material_name: "第二项", quantity_scaled: 10000 },
    { material_id: "m3", material_name: "第三项", quantity_scaled: 20000 },
  ];
  const next = mergeDetails("materials", old, [
    { material_id: "m1", quantity_scaled: 30000, action: "upsert", _sheet: "物资", _row: 2 },
    { material_id: "m2", action: "delete", _sheet: "物资", _row: 3 },
    { material_id: "m4", material_name: "新物资", action: "upsert" },
  ]);
  assert.deepEqual(next.map(item => item.material_id), ["m1", "m3", "m4"]);
  assert.equal(next[0].adopted_version, 2);
  assert.equal(next[0].quantity_scaled, 30000);
  assert.equal(next[1].quantity_scaled, 20000);
  assert.ok(!("action" in next[0]));
  assert.ok(!("_sheet" in next[0]));
  assert.equal(old[0].quantity_scaled, 50000);
  assert.equal(cleanRow({ name: "保留", _row: 8 }).name, "保留");
  assert.equal(detailIdentity("work_locations", { location_kind: "physical_tower", physical_tower_id: "tower" }), "physical_tower/tower");
  assert.deepEqual(differences({ value: 1, _row: 1 }, { value: 2, _row: 9 }),
    [{ field: "value", before: 1, after: 2 }]);
});

test("Excel detail deletion requires an existing identity and unknown actions fail", () => {
  assert.throws(() => mergeDetails("items", [], [
    { cost_node_id: "c1", project_scope_id: "s1", action: "delete" },
  ]), /删除明细不存在/);
  assert.throws(() => mergeDetails("resolutions", [], [
    { project_scope_id: "s1", action: "erase" },
  ]), /未知明细动作/);
});

test("25,000 detail upserts remain linear and do not overwrite missing formal entries", () => {
  const old = Array.from({ length: 25000 }, (_, i) => ({
    cost_node_id: "node" + i, project_scope_id: "scope", quantity_scaled: 10000,
  }));
  const updates = Array.from({ length: 25000 }, (_, i) => ({
    cost_node_id: "node" + i, project_scope_id: "scope", amount_fen: i + 1,
  }));
  const start = performance.now();
  const result = mergeDetails("items", old, updates);
  assert.equal(result.length, 25000);
  assert.equal(result[20000].amount_fen, 20001);
  assert.equal(result[20000].quantity_scaled, 10000);
  assert.ok(performance.now() - start < 4000, "批量明细合并不得退化为二次方扫描");
});
