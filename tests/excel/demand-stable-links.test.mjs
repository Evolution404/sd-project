import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fixture, attribute } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";
import { columnIndex } from "../workbook-helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import {
  makeWorkbook,
  attributeColumn,
} from "../../dist/server/modules/exchange/workbook.js";

test("stable demand and position references survive insertion, independent sorting and editable headers", async (t) => {
  const { s, user, operation } = fixture(t);
  const field = attribute({
    key: "bird",
    label: "鸟害等级",
    requirement: "save",
  });
  s.standards.saveOperation(
    user,
    { expected_version: 1, attributes_schema_json: [field] },
    operation.id,
  );
  const exchange = createExchange(s);
  const documents = ["A", "B"].map((import_ref) => ({
    import_ref,
    operation_name: operation.name,
    problem_description: "需求" + import_ref,
    completion_standard: "牢固",
    primary_source: "来源" + import_ref,
  }));
  const rows = [
    {
      import_ref: "A",
      location_ref: "A15",
      location_kind: "physical_tower",
      asset_no: "T15",
      quantity_scaled: 10000,
      [attributeColumn("bird")]: "普通",
    },
    {
      import_ref: "A",
      location_ref: "A16",
      location_kind: "physical_tower",
      asset_no: "T16",
      quantity_scaled: 20000,
      [attributeColumn("bird")]: "困难",
    },
    {
      import_ref: "B",
      location_ref: "B17",
      location_kind: "physical_tower",
      asset_no: "T17",
      quantity_scaled: 30000,
      [attributeColumn("bird")]: "普通",
    },
  ];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await makeWorkbook(
      "demands",
      { documents, work_locations: rows },
      { attributes: [field] },
    ),
  );
  const root = workbook.getWorksheet("需求清单"),
    locations = workbook.getWorksheet("作业位置");
  const rootValues = root.getRows(2, 2).map((row) => row.values.slice());
  root.getRow(2).values = rootValues[1];
  root.getRow(3).values = rootValues[0];
  const values = locations.getRows(2, 3).map((row) => row.values.slice());
  locations.getRow(2).values = values[2];
  locations.getRow(3).values = values[0];
  locations.getRow(4).values = values[1];
  locations.spliceRows(3, 0, []);
  root.getCell(1, columnIndex(root, "problem_description")).value = "现场问题";
  const before = inspect(s).list("demands").length;
  const preview = await exchange.preview(
    user,
    "demands",
    Buffer.from(await workbook.xlsx.writeBuffer()),
  );
  assert.deepEqual(preview.issues, []);
  assert.equal(inspect(s).list("demands").length, before);
  const result = exchange.commit(user, preview.token, {
    request_key: "stable-association-001",
    atomic: true,
  });
  const a = s.demands.get(
      result.results.find((row) => row.import_ref === "A").id,
    ),
    b = s.demands.get(result.results.find((row) => row.import_ref === "B").id);
  assert.equal(a.work_locations.length, 2);
  assert.equal(a.quantity_scaled, 30000);
  assert.equal(b.quantity_scaled, 30000);
  assert.equal(
    a.work_locations.find(
      (row) => row.location_snapshot_json.asset_no === "T16",
    ).attributes.bird,
    "困难",
  );
  assert.equal(a.sources[0].description, "来源A");
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(
    await exchange.exportData(user, "demands", { ids: [a.id] }),
  );
  const exportedLocations = exported.getWorksheet("作业位置");
  exportedLocations.getCell(
    2,
    columnIndex(exportedLocations, attributeColumn("bird")),
  ).value = "__CLEAR__";
  const missing = await exchange.preview(
    user,
    "demands",
    Buffer.from(await exported.xlsx.writeBuffer()),
  );
  assert.ok(missing.issues.some((row) => row.reason.includes("鸟害等级")));
});

test("duplicate or orphan references reject their documents and partial source maintenance preserves omitted provenance", async (t) => {
  const { s, user, demandInput, operation } = fixture(t),
    exchange = createExchange(s);
  const demand = s.demands.save(user, {
    ...demandInput,
    sources: [{ description: "第一来源" }, { description: "第二来源" }],
  });
  const bytes = await makeWorkbook("demands", {
    documents: [
      {
        import_ref: "A",
        id: demand.id,
        demand_no: demand.demand_no,
        expected_version: 1,
        problem_description: "更正问题",
      },
    ],
    sources: [
      {
        import_ref: "A",
        id: demand.sources.find((row) => row.description === "第一来源").id,
        description: "第一来源更正",
      },
    ],
  });
  const preview = await exchange.preview(user, "demands", bytes);
  assert.deepEqual(preview.issues, []);
  exchange.commit(user, preview.token, {
    request_key: "partial-source-maintenance",
    atomic: true,
  });
  assert.deepEqual(
    s.demands
      .get(demand.id)
      .sources.map((row) => row.description)
      .sort(),
    ["第一来源更正", "第二来源"],
  );
  const updated = s.demands.get(demand.id);
  const deletion = await exchange.preview(
    user,
    "demands",
    await makeWorkbook("demands", {
      documents: [
        {
          import_ref: "A",
          id: demand.id,
          demand_no: demand.demand_no,
          expected_version: 2,
        },
      ],
      sources: [
        {
          import_ref: "A",
          id: updated.sources.find((row) => row.description === "第二来源").id,
          action: "delete",
        },
      ],
    }),
  );
  assert.deepEqual(deletion.issues, []);
  exchange.commit(user, deletion.token, {
    request_key: "explicit-source-delete",
    atomic: true,
  });
  assert.equal(s.demands.get(demand.id).sources.length, 1);
  assert.ok(s.demands.history(demand.id).sources.some((row) => row.deleted));
  const root = {
    import_ref: "A",
    operation_name: operation.name,
    problem_description: "新需求",
    completion_standard: "牢固",
  };
  const invalid = await exchange.preview(
    user,
    "demands",
    await makeWorkbook("demands", {
      documents: [root, root],
      work_locations: [
        {
          import_ref: "unknown",
          location_ref: "P",
          location_kind: "physical_tower",
          asset_no: "T15",
          quantity_scaled: 10000,
        },
      ],
    }),
  );
  assert.ok(invalid.issues.some((row) => row.reason.includes("重复")));
  assert.ok(invalid.issues.some((row) => row.reason.includes("未对应")));
  assert.throws(
    () =>
      exchange.commit(user, invalid.token, {
        request_key: "invalid-ref-atomic",
        atomic: true,
      }),
    /全部未写入/,
  );
});

test("optional attribute clear publishes a true empty new snapshot without resurrecting the previous object keys", (t) => {
  const { s, user, operation, demandInput } = fixture(t);
  const field = attribute({
    key: "note",
    label: "治理说明",
    scope: "demand",
    type: "text",
    requirement: "optional",
    pricing: false,
  });
  s.standards.saveOperation(
    user,
    { expected_version: 1, attributes_schema_json: [field] },
    operation.id,
  );
  const demand = s.demands.save(user, {
    ...demandInput,
    attributes: { note: "需要移除" },
  });
  const revised = s.demands.save(
    user,
    { expected_version: 1, attributes: {} },
    demand.id,
  );
  assert.deepEqual(revised.attributes, {});
  const versions = s.demands.history(demand.id).versions;
  assert.equal(
    JSON.parse(versions[0].snapshot_json).attributes.note,
    "需要移除",
  );
  assert.deepEqual(JSON.parse(versions[1].snapshot_json).attributes, {});
  assert.throws(
    () =>
      inspect(s).run(
        "UPDATE demand_version_work_locations SET attributes_json='{}' WHERE demand_id=?",
        demand.id,
      ),
    /不可覆盖/,
  );
});

test('maintenance export preserves adopted schemas when an attribute changes level in a later operation version', async t => {
  const {s,user,operation,demandInput}=fixture(t), exchange=createExchange(s);
  const field=attribute({key:'context',label:'治理分类',requirement:'save'});
  s.standards.saveOperation(user,{expected_version:1,attributes_schema_json:[field]},operation.id);
  const old=s.demands.save(user,{...demandInput,work_locations:[{...demandInput.work_locations[0],attributes:{context:'普通'}}]});
  s.standards.saveOperation(user,{expected_version:2,attributes_schema_json:[{...field,scope:'demand'}]},operation.id);
  const current=s.demands.save(user,{...demandInput,attributes:{context:'困难'},work_locations:[demandInput.work_locations[1]]});
  const result=await exchange.preview(user,'demands',await exchange.exportData(user,'demands',{ids:[old.id,current.id]}),{mode:'update'});
  assert.deepEqual(result.issues,[]);
  assert.equal(result.summary.unchanged,2);
  assert.equal(s.demands.get(old.id).operation_version,2);
  assert.equal(s.demands.get(current.id).operation_version,3);
});
