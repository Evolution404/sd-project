import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fixture } from "../helpers.mjs";

test("1,000 lines and 10,000 logical towers preserve SQL search and pagination correctness", { timeout: 180000 }, (t) => {
  const { s, user } = fixture(t);
  const voltage = s.catalog.save(user, "voltages", { name: "220kV" });
  const shared = s.catalog.save(user, "physical", { tower_type: "耐张塔" });
  const started = performance.now();
  s.repo.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      const lineId = "bench-line-" + i.toString().padStart(4, "0");
      const name = "压力线路" + i.toString().padStart(4, "0");
      s.repo.insert("transmission_lines", {
        id: lineId, line_code: "AUTO-L" + i, name,
        voltage_level_id: voltage.id, status: "active", created_by: user.id,
      });
      for (let j = 1; j <= 10; j++)
        s.repo.insert("logical_towers", {
          id: lineId + "-tower-" + j,
          logical_code: "AUTO-T" + i + "-" + j,
          line_id: lineId, physical_tower_id: j === 10 ? shared.id : null,
          tower_no: "#" + j, sort_rank: j,
          status: j === 10 ? "active" : "draft", created_by: user.id,
        });
    }
  });
  const generateMs = performance.now() - started;
  const began = performance.now();
  const lines = s.catalog.search("lines", {
    q: "压力线路", sort: "name", direction: "asc", page: 26, page_size: 20,
  });
  assert.equal(lines.total, 1000);
  assert.equal(lines.items[0].name, "压力线路0500");
  assert.equal(lines.items.length, 20);
  const towers = s.catalog.search("towers", {
    lineId: "bench-line-0500", page_size: 20, sort: "tower_no", direction: "desc",
  });
  assert.equal(towers.total, 10);
  assert.equal(towers.items[0].tower_no, "#9");
  const physical = s.catalog.search("physical", {
    q: "压力线路0500", page_size: 20,
  });
  assert.equal(physical.total, 1);
  assert.equal(physical.items[0].current_circuits, 1000);
  assert.equal(physical.items[0].bindings.length, 1000);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
  console.log("EQUIPMENT_SQL_BENCH_MS", JSON.stringify({
    records: 11000, generation: Math.round(generateMs),
    searchAndPagination: Math.round(performance.now() - began),
  }));
});
