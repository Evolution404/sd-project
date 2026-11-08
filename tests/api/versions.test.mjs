import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
test("quantity revisions retain adopted operation and unit definitions after master changes", (t) => {
  const { s, user, operation, demandInput, unit } = fixture(t);
  const demand = s.demands.save(user, demandInput);
  s.catalog.save(
    user,
    "units",
    { name: "新单位名称", expected_version: 1 },
    unit.id,
  );
  s.catalog.save(
    user,
    "operations",
    {
      ...operation,
      name: "新版安装定义",
      default_unit_version: 2,
      expected_version: 1,
    },
    operation.id,
  );
  const revised = s.demands.save(
    user,
    { ...demand, expected_version: 1, problem_description: "现场事实修订" },
    demand.id,
  );
  assert.equal(revised.operation_version, 1);
  assert.equal(revised.unit_version, 1);
  assert.equal(revised.unit_snapshot, "套");
  assert.equal(revised.operation_snapshot, "安装防鸟装置");
  assert.equal(s.demands.history(demand.id).versions.length, 2);
});
test("duplicate creation requires a concrete human decision and records the original matches", (t) => {
  const { s, user, demandInput } = fixture(t);
  s.demands.save(user, demandInput);
  assert.throws(
    () => s.demands.save(user, { ...demandInput, demand_no: "D002" }),
    /疑似重复/,
  );
  const separate = s.demands.save(user, {
    ...demandInput,
    demand_no: "D002",
    duplicate_decision: "separate",
    duplicate_matches: ["D001"],
  });
  assert.equal(separate.demand_no, "D002");
  assert.equal(s.repo.list("demand_duplicate_reviews").length, 1);
});
test("voltage rename is auditable and optimistic, and source corrections retain original evidence", (t) => {
  const { s, user, save, demandInput } = fixture(t),
    voltage = save("voltages", { code: "220", name: "220kV" });
  const changed = s.catalog.save(
    user,
    "voltages",
    { name: "220千伏", status: "active", expected_version: 1 },
    voltage.id,
  );
  assert.equal(changed.name, "220千伏");
  assert.equal(changed.version, 2);
  assert.equal(s.catalog.history("voltages", voltage.id).length, 2);
  assert.throws(
    () =>
      s.catalog.save(
        user,
        "voltages",
        { name: "旧版本覆盖", expected_version: 1 },
        voltage.id,
      ),
    /版本冲突/,
  );
  const demand = s.demands.save(user, demandInput),
    source = demand.sources[0];
  s.sources.revise(user, source.id, { description: "已核实的来源更正" });
  assert.equal(
    s.demands.get(demand.id).sources[0].description,
    "已核实的来源更正",
  );
  assert.equal(s.demands.history(demand.id).sources.length, 2);
  assert.equal(
    s.repo.find("source_records", "id", source.id).description,
    "现场巡视记录",
  );
  const current = s.demands.get(demand.id).sources[0];
  s.sources.remove(user, current.id);
  assert.equal(s.demands.get(demand.id).sources.length, 0);
  assert.equal(s.demands.history(demand.id).sources.length, 2);
});
test("deleting referenced equipment preserves real operating status while excluding new selections", (t) => {
  const { s, user, save, towers } = fixture(t),
    voltage = save("voltages", { code: "110", name: "110kV" }),
    line = save("lines", {
      line_code: "LINE-01",
      name: "测试线路",
      voltage_level_id: voltage.id,
    });
  const logical = save("towers", {
    logical_code: "LOG-01",
    line_id: line.id,
    physical_tower_id: towers[0].id,
    tower_no: "#15",
    sort_rank: 1,
    status: "active",
  });
  s.catalog.remove(user, "physical", towers[0].id, 1);
  assert.equal(
    s.repo.find("physical_towers", "id", towers[0].id).status,
    "active",
  );
  assert.equal(s.catalog.list("physical").length, 2);
  const revised = s.catalog.save(
    user,
    "towers",
    { ...logical, operations_team: "新运维班组", expected_version: 1 },
    logical.id,
  );
  assert.equal(revised.operations_team, "新运维班组");
  assert.throws(
    () =>
      save("towers", {
        logical_code: "LOG-02",
        line_id: line.id,
        physical_tower_id: towers[0].id,
        tower_no: "#16",
        sort_rank: 2,
        status: "active",
      }),
    /已删除/,
  );
});
test("versioned price features are inferred from declared asset sources and checked against shared dictionary values", (t) => {
  const { s, user, save, operation, demandInput } = fixture(t);
  const factor = save("factors", {
    code: "tower-type",
    name: "塔型条件",
    fields_json: {
      kind: "enum",
      values: ["angle", "suspension"],
      asset_field: "tower_type",
    },
  });
  s.catalog.save(
    user,
    "operations",
    {
      ...operation,
      expected_version: 1,
      pricing_features_json: [
        {
          factor_id: factor.id,
          factor_version: 1,
          source: "asset",
          required: true,
        },
      ],
    },
    operation.id,
  );
  const demand = s.demands.save(user, demandInput);
  assert.equal(
    demand.work_locations[0].site_features_json["tower-type"].value,
    "angle",
  );
  const wrong = {
    ...demandInput,
    demand_no: "WRONG-FACT",
    work_locations: demandInput.work_locations.map((loc) => ({
      ...loc,
      site_features_json: {
        "tower-type": { factor_version: 1, value: "suspension" },
      },
    })),
  };
  assert.throws(() => s.demands.save(user, wrong), /台账事实不一致/);
});
test("explicit historical equipment correction preserves deletion and permits real retirement", (t) => {
  const { s, user, towers } = fixture(t);
  s.catalog.remove(user, "physical", towers[0].id, 1);
  assert.throws(
    () =>
      s.catalog.save(
        user,
        "physical",
        { status: "retired", expected_version: 1 },
        towers[0].id,
      ),
    /已删除|不存在/,
  );
  const corrected = s.catalog.save(
    user,
    "physical",
    { status: "retired", expected_version: 1, historical_update: true },
    towers[0].id,
  );
  assert.equal(corrected.status, "retired");
  assert.equal(corrected.deleted, true);
  assert.equal(
    s.catalog.list("physical").some((row) => row.id === towers[0].id),
    false,
  );
  assert.equal(s.catalog.history("physical", towers[0].id).length, 2);
});
test("quantity revision retains adopted span history until explicit current-definition adoption", (t) => {
  const { s, user, save, unit, towers } = fixture(t);
  const voltage = save("voltages", { code: "span-110", name: "110kV" });
  const line = save("lines", {
    line_code: "span-line",
    name: "档距测试线",
    voltage_level_id: voltage.id,
  });
  const logical = towers.map((tower, index) =>
    save("towers", {
      logical_code: `SPAN-T${index}`,
      tower_no: `#${index + 1}`,
      sort_rank: index + 1,
      line_id: line.id,
      physical_tower_id: tower.id,
      status: "active",
    }),
  );
  const span = save("spans", {
    line_id: line.id,
    start_tower_id: logical[0].id,
    end_tower_id: logical[1].id,
    status: "active",
  });
  const object = save("objects", {
    code: "span-object",
    name: "导线",
    work_target_type: "line",
  });
  const operation = save("operations", {
    code: "span-op",
    name: "处理导线",
    completion_standard: "缺陷处理完成",
    work_object_id: object.id,
    default_unit_id: unit.id,
    work_target_type: "line",
    allow_tower: 0,
    allow_span: 1,
    default_location_kind: "span",
  });
  const demand = s.demands.save(user, {
    operation_id: operation.id,
    problem_description: "导线缺陷",
    work_locations: [
      { location_kind: "span", span_id: span.id, quantity_scaled: 10000 },
    ],
    sources: [{ description: "巡视记录" }],
  });
  s.catalog.save(
    user,
    "spans",
    { ...span, end_tower_id: logical[2].id, expected_version: 1 },
    span.id,
  );
  const changed = s.demands.save(
    user,
    {
      ...demand,
      work_locations: demand.work_locations.map((loc) => ({
        ...loc,
        quantity_scaled: 20000,
      })),
      expected_version: 1,
    },
    demand.id,
  );
  assert.equal(changed.work_locations[0].span_version, 1);
  const adopted = s.demands.save(
    user,
    {
      ...changed,
      expected_version: 2,
      work_locations: changed.work_locations.map((loc) => ({
        ...loc,
        adopt_current_definition: true,
      })),
    },
    demand.id,
  );
  assert.equal(adopted.work_locations[0].span_version, 2);
});
test("adopted material definitions survive unrelated revisions after current material changes and logical deletion", (t) => {
  const { s, user, save, unit, demandInput } = fixture(t);
  const material = save("materials", {
    code: "VERSION-M",
    name: "旧物资名称",
    model: "A",
    unit_id: unit.id,
  });
  let demand = s.demands.save(user, {
    ...demandInput,
    materials: [{ material_id: material.id, quantity_scaled: 10000 }],
  });
  const version = demand.materials[0].material_version_id;
  s.catalog.save(
    user,
    "materials",
    { name: "新物资名称", model: "B", expected_version: 1 },
    material.id,
  );
  s.catalog.remove(user, "materials", material.id, 2);
  demand = s.demands.save(
    user,
    { ...demand, problem_description: "仅修订现场说明", expected_version: 1 },
    demand.id,
  );
  assert.equal(demand.materials[0].material_version_id, version);
  assert.equal(demand.materials[0].material_name, "旧物资名称");
  assert.equal(demand.materials[0].model, "A");
  assert.equal(s.demands.history(demand.id).versions.length, 2);
});
