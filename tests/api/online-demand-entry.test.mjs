import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../helpers.mjs";

test("web demand workbooks use shared preflight and an idempotent atomic commit", t => {
  const { s, user, operation, towers, unit } = fixture(t);
  const material = s.materials.save(user, { name: "网页批量夹具物资", unit_id: unit.id, status: "active" });
  const rows = {
    documents: [1, 2].map(i => ({
      import_ref: "XQ" + i, operation_id: operation.id, operation_version: operation.version,
      problem_description: "网页批量夹具" + i, completion_standard: "安装牢固", expected_on: null,
    })),
    work_locations: towers.slice(0, 2).map((tower, i) => ({
      import_ref: "XQ" + (i + 1), location_ref: "WZ1", location_kind: "物理杆塔",
      physical_tower_id: tower.id, quantity_scaled: i === 0 ? "2" : "1.4", work_mode: "停电",
    })),
    materials: [{ import_ref: "XQ1", material_id: material.id, quantity_scaled: "2", note: "夹具说明" }],
    sources: [{ import_ref: "XQ1", description: "网页夹具来源", discovered_on: "2026-11-21" }],
  };
  const request = () => ({ mode: "create", rows });
  const preview = s.exchange.previewDemandWorksheet(user, request());
  assert.ok(preview.issues.some(issue => issue.field === "quantity_scaled" && issue.sheet === "作业位置" && issue.row === 3));
  assert.throws(() => s.exchange.commit(user, preview.token, { request_key: "worksheet-invalid", atomic: true }), /全部未写入/);
  assert.equal(s.demands.search({ q: "网页批量夹具", page: 1, page_size: 20, filters: {} }).total, 0);

  rows.work_locations[1].quantity_scaled = "4";
  const ready = s.exchange.previewDemandWorksheet(user, request());
  assert.deepEqual(ready.issues, []);
  assert.throws(() => s.exchange.commit(user, ready.token, { request_key: "worksheet-nonatomic", atomic: false }), /必须整批提交/);
  const command = { request_key: "worksheet-create", atomic: true };
  const committed = s.exchange.commit(user, ready.token, command);
  assert.equal(committed.source, "worksheet");
  assert.equal(committed.results.length, 2);
  assert.deepEqual(s.exchange.commit(user, ready.token, command), committed);
  const created = committed.results.map(result => s.demands.get(result.id));
  assert.notEqual(created[0].demand_no, created[1].demand_no);
  assert.equal(created[0].sources[0].source_system, "manual");
  assert.equal(created[0].sources[0].discovered_on, "2026-11-21");
  assert.equal(created[0].materials[0].material_id, material.id);
  assert.equal(created[0].materials[0].quantity_scaled, 20000);
  assert.equal(created[0].work_locations[0].work_mode, "outage");
  assert.equal(created[1].work_locations[0].physical_tower_id, towers[1].id);
  assert.equal(created[1].work_locations[0].quantity_scaled, 40000);
});

test("web ordinary revisions keep details and reject a stale batch without partial writes", t => {
  const { s, user, demandInput } = fixture(t);
  const first = s.demands.save(user, { ...demandInput, work_locations: demandInput.work_locations.slice(0, 1) });
  const second = s.demands.save(user, { ...demandInput, work_locations: demandInput.work_locations.slice(1, 2) });
  const rows = { documents: [first, second].map(row => ({
    id: row.id, expected_version: row.current_version, import_ref: row.demand_no, target_object: "网页普通修订",
  })) };
  const data = { mode: "update", rows };
  assert.throws(() => s.exchange.previewDemandWorksheet({ ...user, permissions: ["read"] }, data),
    error => error.status === 403);
  assert.throws(() => s.exchange.previewDemandWorksheet(user, {
    mode: "update", rows: { ...rows, materials: [{ import_ref: first.demand_no }] },
  }), /不允许修改单据明细/);
  const preview = s.exchange.previewDemandWorksheet(user, data);
  assert.deepEqual(preview.issues, []);
  const changed = s.demands.save(user, { expected_version: second.current_version, target_object: "并发单条修订" }, second.id);
  assert.throws(() => s.exchange.commit(user, preview.token, { request_key: "worksheet-stale", atomic: true }), /全部未写入/);
  assert.equal(s.demands.get(first.id).current_version, first.current_version);
  assert.equal(s.demands.get(second.id).target_object, "并发单条修订");

  rows.documents[1].expected_version = changed.current_version;
  const ready = s.exchange.previewDemandWorksheet(user, data);
  const result = s.exchange.commit(user, ready.token, { request_key: "worksheet-valid-revision", atomic: true });
  assert.equal(result.results.length, 2);
  assert.equal(s.demands.get(first.id).target_object, "网页普通修订");
  assert.deepEqual(s.demands.get(first.id).work_locations, first.work_locations);
  assert.deepEqual(s.demands.get(first.id).sources, first.sources);
});
