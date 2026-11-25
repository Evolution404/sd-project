import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fixture } from "../helpers.mjs";

test("catalog transaction capacity at 100, 500 and 1,000 rows using logical tower and material commands", { timeout: 180000 }, t => {
  const { s, user, unit, save } = fixture(t);
  const voltage = save("voltages", { name: "220kV" });
  const probes = [];
  for (const size of [100, 500, 1000]) {
    const line = save("lines", { name: "容量线" + size, voltage_level_id: voltage.id });
    const rollback = new Error("rollback catalog capacity probe");
    const started = performance.now();
    assert.throws(() => s.database.transaction(() => {
      for (let index = 0; index < size; index++) save("towers", { line_id: line.id, tower_no: "T" + index });
      for (let index = 0; index < size; index++) s.materials.save(user, { name: "容量物资" + index, unit_id: unit.id });
      throw rollback;
    }), failure => failure === rollback);
    const durationMs = Math.round(performance.now() - started);
    assert.equal(s.equipment.list("towers").filter(row => row.line_id === line.id).length, 0);
    assert.equal(s.materials.list().length, 0);
    assert.equal(s.equipment.list("physical").length, 3);
    if (size === 100) assert.ok(durationMs < 3500, "100 active rows must fit the write budget");
    probes.push({ size, durationMs, physicalRowsPerLogicalTower: 1, rolledBack: true });
  }
  console.log("CATALOG_ENTRY_CAPACITY", JSON.stringify(probes));
});
