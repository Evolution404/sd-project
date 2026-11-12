import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { createEquipment } from "../../dist/server/modules/equipment/service.js";
import { equipmentRepository } from "../../dist/server/database/repositories/equipment.js";
import { auditRepository } from "../../dist/server/database/repositories/audit.js";
import { createAudit } from "../../dist/server/platform/audit/service.js";

test("equipment repository reads stay bounded as a page grows and preserve all circuit labels", (t) => {
  const { s, user, save } = fixture(t);
  const voltage = save("voltages", { name: "220kV" });
  const line = save("lines", {
    name: "设备集合查询",
    voltage_level_id: voltage.id,
  });
  const shared = save("physical", { tower_nature: "straight" });
  for (let index = 0; index < 200; index++)
    save("towers", {
      line_id: line.id,
      tower_no: "#" + index,
      physical_tower_id: shared.id,
    });
  let calls = 0;
  const counted = new Proxy(inspect(s), {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args) => {
        if (["query", "get", "where", "find", "list"].includes(key)) calls++;
        return value(...args);
      };
    },
  });
  const equipment = createEquipment(
    equipmentRepository(counted),
    s.database,
    createAudit(auditRepository(counted)),
  );
  for (const pageSize of [1, 200]) {
    calls = 0;
    const result = equipment.search("towers", { page_size: pageSize });
    assert.equal(result.total, 200);
    assert.equal(result.items.length, pageSize);
    assert.equal(calls, 4);
    assert.match(result.items[0].line_id_label, /设备集合查询 · 220kV/);
    assert.match(result.items[0].physical_tower_id_label, /#199/);
    assert.equal(result.items[0].tower_nature, "straight");
  }
  calls = 0;
  assert.equal(equipment.list("towers").length, 200);
  assert.equal(calls, 2);
  calls = 0;
  const physical = equipment.search("physical", { q: "设备集合查询" });
  assert.equal(calls, 4);
  assert.equal(physical.items[0].bindings.length, 200);
  assert.equal(physical.items[0].current_circuits, 200);
  assert.deepEqual(
    s.catalog.get("physical", shared.id),
    s.equipment.get("physical", shared.id),
  );
  assert.throws(
    () =>
      equipment.save(
        { ...user, role: "viewer", permissions: ["read"] },
        "lines",
        { name: "越权" },
      ),
    /权限/,
  );
});

test("equipment validation and voltage revisions retain identities, audited versions and atomic rollback", (t) => {
  const { s, user, save } = fixture(t);
  const voltage = save("voltages", { name: "110kV" });
  const revised = s.equipment.save(
    user,
    "voltages",
    { name: "110千伏", expected_version: 1 },
    voltage.id,
  );
  assert.equal(revised.version, 2);
  assert.equal(revised.code, voltage.code);
  assert.equal(
    s.catalog
      .history("voltages", voltage.id)
      .filter((event) => event.action === "revise").length,
    1,
  );
  assert.throws(
    () =>
      s.equipment.save(
        user,
        "voltages",
        { name: "非法并发", expected_version: 1 },
        voltage.id,
      ),
    /版本冲突/,
  );
  const line = save("lines", {
    name: "独立设备流程",
    voltage_level_id: voltage.id,
  });
  const before = s.equipment.list("physical").length;
  assert.throws(
    () =>
      s.equipment.save(user, "towers", {
        line_id: line.id,
        tower_no: "",
        physical_properties: { tower_nature: "straight" },
      }),
    /杆塔号/,
  );
  assert.equal(s.equipment.list("physical").length, before);
  assert.throws(
    () => s.equipment.save(user, "physical", { tower_nature: "guessed" }),
    /字典|不存在|约束/,
  );
  const tower = save("towers", { line_id: line.id, tower_no: "#1" });
  s.equipment.save(
    user,
    "towers",
    { tower_no: "#2", expected_version: 1 },
    tower.id,
  );
  assert.equal(s.equipment.history("towers", tower.id).length, 2);
  s.equipment.remove(user, "towers", tower.id, 2);
  assert.equal(s.equipment.list("towers").length, 0);
  assert.equal(s.equipment.get("towers", tower.id, true).tower_no, "#2");
  assert.deepEqual(inspect(s).integrity().foreignKeys, []);
});
