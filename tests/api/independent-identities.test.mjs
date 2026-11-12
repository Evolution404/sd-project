import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

function equipment(t) {
  const f = fixture(t),
    { save } = f;
  const voltage = save("voltages", { name: "220kV" });
  const line = save("lines", {
    name: "独立甲线",
    voltage_level_id: voltage.id,
  });
  const second = save("lines", {
    name: "独立乙线",
    voltage_level_id: voltage.id,
  });
  return { ...f, voltage, line, second };
}
test("catalog identities are server-owned and ordinary tower creation is a complete atomic operation", (t) => {
  const { s, user, line, second, voltage } = equipment(t);
  for (const [kind, definition] of Object.entries(s.catalog.definitions))
    for (const field of definition.rootFields.filter((field) =>
      field.key.endsWith("code"),
    ))
      assert.equal(field.systemManaged, true, kind);
  assert.match(line.line_code, /^LINES-/);
  assert.match(voltage.code, /^VOLTAGES-/);
  const before = inspect(s).list("physical_towers").length;
  const tower = s.catalog.save(user, "towers", {
    line_id: line.id,
    tower_no: "#1",
  });
  assert.equal(tower.status, "active");
  assert.equal(inspect(s).list("physical_towers").length, before + 1);
  assert.ok(tower.physical_tower_id);
  assert.match(tower.logical_code, /^TOWERS-/);
  assert.throws(
    () => s.catalog.save(user, "towers", { line_id: line.id, tower_no: "#1" }),
    /已有该杆塔号/,
  );
  const independent = s.catalog.save(user, "towers", { line_id: second.id, tower_no: "#1" });
  assert.notEqual(independent.physical_tower_id, tower.physical_tower_id);
  const third = s.catalog.save(user, "lines", { name: "明确共塔线", voltage_level_id: voltage.id });
  const shared = s.catalog.save(user, "towers", {
    line_id: third.id,
    tower_no: "#1",
    physical_tower_id: tower.physical_tower_id,
  });
  assert.equal(shared.physical_tower_id, tower.physical_tower_id);
  assert.equal(inspect(s).list("physical_towers").length, before + 2);
  assert.throws(() =>
    s.catalog.save(user, "towers", {
      line_id: line.id,
      tower_no: "#2",
      status: "invalid",
    }),
  );
  assert.equal(inspect(s).list("physical_towers").length, before + 2);
  const another = s.catalog.save(user, "towers", {
    line_id: second.id,
    tower_no: "#2",
  });
  assert.equal(another.sort_rank, 2);
  const spoofed = s.catalog.save(user, "lines", {
    line_code: "client-generated-code",
    name: "服务端身份线",
    voltage_level_id: voltage.id,
  });
  assert.notEqual(spoofed.line_code, "client-generated-code");
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});
test("whole physical replacement keeps original demand, quote and all circuit history", (t) => {
  const { s, user, line, second, operation } = equipment(t);
  const first = s.catalog.save(user, "towers", {
    line_id: line.id,
    tower_no: "#15",
    physical_properties: { tower_material: "angle" },
  });
  const other = s.catalog.save(user, "towers", {
    line_id: second.id,
    tower_no: "#15",
    physical_tower_id: first.physical_tower_id,
  });
  const demand = s.demands.save(user, {
    operation_id: operation.id,
    problem_description: "旧塔现场记录",
    completion_standard: "安装牢固",
    work_locations: [
      {
        location_kind: "physical_tower",
        physical_tower_id: first.physical_tower_id,
        quantity_scaled: 10000,
      },
    ],
  });
  const quote = s.pricing.quote(user, demand.id, {
    expected_version: 1,
    confirm: true,
  });
  const preview = s.catalog.replacementPreview(first.physical_tower_id);
  assert.throws(
    () =>
      s.catalog.replacePhysical(user, first.physical_tower_id, {
        expected_version: 1,
        bindings: [],
      }),
    /关联回路已变化/,
  );
  const replacement = s.catalog.replacePhysical(user, first.physical_tower_id, {
    expected_version: 1,
    bindings: preview.bindings,
    properties: { tower_material: "angle", height_scaled: 250000 },
  });
  assert.notEqual(replacement.id, first.physical_tower_id);
  assert.equal(
    s.catalog.get("physical", first.physical_tower_id).status,
    "retired",
  );
  for (const tower of [first, other]) {
    assert.equal(
      s.catalog.get("towers", tower.id).physical_tower_id,
      replacement.id,
    );
    const history = s.catalog.history("towers", tower.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].physical_tower_id, first.physical_tower_id);
  }
  assert.equal(
    s.demands.get(demand.id).work_locations[0].physical_tower_id,
    first.physical_tower_id,
  );
  assert.equal(s.demands.history(demand.id).reference_quotes[0].id, quote.id);
  assert.equal(
    inspect(s).auditFor("tower_replacements", first.physical_tower_id).length,
    1,
  );
});

test("current product schema keeps the equipment and work-object identities independent", t => {
  const {s} = fixture(t);
  const tables = s.database.connection.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('transmission_lines','logical_towers','physical_towers','operations','work_objects')"
  ).all().map(item=>item.name);
  assert.deepEqual(tables.sort(),["logical_towers","operations","physical_towers","transmission_lines","work_objects"]);
  const physical=s.database.connection.prepare("PRAGMA table_info(physical_towers)").all();
  assert.ok(physical.some(item=>item.name==="tower_nature"));
  assert.ok(!physical.some(item=>item.name==="erection_type"));
  assert.deepEqual(inspect(s).integrity().foreignKeys,[]);
});
