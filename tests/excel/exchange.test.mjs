import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fixture } from "../helpers.mjs";
import { createExchange } from "../../server/exchange/service.mjs";
import { makeWorkbook } from "../../server/exchange/workbook.mjs";
test("demand maintenance export, diff, revision, idempotency and stale version", async (t) => {
  const { s, user, demandInput } = fixture(t),
    exchange = createExchange(s),
    demand = s.demands.save(user, demandInput);
  const buffer = await exchange.exportData(user, "demands", {
    ids: [demand.id],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  workbook.getWorksheet("作业位置").getRow(2).getCell(7).value = 5;
  const edited = Buffer.from(await workbook.xlsx.writeBuffer());
  const preview = await exchange.preview(user, "demands", edited, {
    mode: "update",
  });
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  assert.equal(preview.summary.updated, 1);
  const result = exchange.commit(user, preview.token, {
    request_key: "excel-request-0001",
  });
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
  assert.equal(s.demands.get(demand.id).current_version, 2);
  assert.equal(s.demands.get(demand.id).quantity_scaled, 110000);
  assert.deepEqual(
    exchange.commit(user, preview.token, { request_key: "excel-request-0001" }),
    result,
  );
  const stale = await exchange.preview(user, "demands", edited, {
    mode: "update",
  });
  assert.ok(stale.issues.some((x) => x.field === "expected_version"));
  const report = await exchange.exportData(user, "demands", { report: true });
  await assert.rejects(
    () => exchange.preview(user, "demands", report),
    /业务报表/,
  );
});
test("formula cells are rejected and missing detail rows preserve existing positions", async (t) => {
  const { s, user, demandInput } = fixture(t),
    exchange = createExchange(s),
    demand = s.demands.save(user, demandInput);
  const buffer = await makeWorkbook("demands", {
    documents: [
      {
        demand_no: demand.demand_no,
        id: demand.id,
        expected_version: 1,
        problem_description: "新描述",
      },
    ],
  });
  const preview = await exchange.preview(user, "demands", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const result = exchange.commit(user, preview.token, {
    request_key: "excel-preserve-001",
    atomic: true,
  });
  assert.equal(result.issues.length, 0);
  assert.equal(s.demands.get(demand.id).work_locations.length, 3);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  workbook.getWorksheet("需求清单").getCell("E2").value = { formula: "1+1" };
  const invalid = await exchange.preview(
    user,
    "demands",
    Buffer.from(await workbook.xlsx.writeBuffer()),
  );
  assert.ok(invalid.issues.some((x) => x.reason.includes("公式")));
});
test("new workbook accepts exact operation and equipment codes with human decimal quantities", async (t) => {
  const { s, user } = fixture(t),
    exchange = createExchange(s);
  const buffer = await makeWorkbook("demands", {
    documents: [
      {
        demand_no: "CODE-D001",
        operation_code: "install",
        problem_description: "按现场设备编码录入",
        completion_standard: "安装牢固",
      },
    ],
    work_locations: [
      {
        demand_no: "CODE-D001",
        action: "upsert",
        location_kind: "physical_tower",
        location_code: "T15",
        quantity_scaled: 25000,
        work_mode: "outage",
      },
    ],
  });
  const readable = new ExcelJS.Workbook();
  await readable.xlsx.load(buffer);
  const locationSheet = readable.getWorksheet("作业位置");
  assert.equal(locationSheet.getCell("B2").value, "新增或修改");
  assert.equal(locationSheet.getCell("C2").value, "物理杆塔");
  assert.equal(locationSheet.getCell("H2").value, "停电");
  assert.equal(locationSheet.getColumn(4).hidden, true);
  assert.ok(locationSheet.getCell("C2").dataValidation);
  const preview = await exchange.preview(user, "demands", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const result = exchange.commit(user, preview.token, {
    request_key: "code-import-0001",
  });
  assert.equal(result.results.length, 1);
  assert.equal(s.demands.get(result.results[0].id).quantity_scaled, 25000);
  assert.equal(s.demands.get(result.results[0].id).work_locations[0].work_mode, "outage");
});
test("required operation-specific facts share online and workbook validation", async (t) => {
  const { s, user, operation, demandInput } = fixture(t);
  s.catalog.save(
    user,
    "operations",
    {
      ...operation,
      fields_json: [
        { key: "height", label: "作业高度", type: "number", required: true },
      ],
      expected_version: 1,
    },
    operation.id,
  );
  assert.throws(() => s.demands.save(user, demandInput), /作业高度/);
  const exchange = createExchange(s),
    buffer = await makeWorkbook("demands", {
      documents: [
        {
          demand_no: "EXTRA-D",
          operation_code: "install",
          problem_description: "现场附加事实",
          completion_standard: "牢固",
        },
      ],
      work_locations: [
        {
          demand_no: "EXTRA-D",
          location_kind: "physical_tower",
          location_code: "T15",
          quantity_scaled: 10000,
        },
      ],
      custom_fields: [
        { demand_no: "EXTRA-D", field_name: "作业高度", value: 12.5 },
      ],
    });
  const preview = await exchange.preview(user, "demands", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const result = exchange.commit(user, preview.token, {
    request_key: "extra-fields-0001",
  });
  assert.equal(s.demands.get(result.results[0].id).custom_fields.height, 12.5);
});
test("workbook price features use equipment and dictionary codes without manual version entry", async (t) => {
  const { s, user, save, operation } = fixture(t),
    factor = save("factors", {
      code: "terrain",
      name: "地形",
      fields_json: { kind: "enum", values: ["mountain", "plain"] },
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
          source: "manual",
          required: true,
        },
      ],
    },
    operation.id,
  );
  const exchange = createExchange(s),
    buffer = await makeWorkbook("demands", {
      documents: [
        {
          demand_no: "FEATURE-D",
          operation_code: "install",
          problem_description: "现场条件",
          completion_standard: "牢固",
        },
      ],
      work_locations: [
        {
          demand_no: "FEATURE-D",
          location_kind: "physical_tower",
          location_code: "T15",
          quantity_scaled: 10000,
        },
      ],
      site_features: [
        {
          demand_no: "FEATURE-D",
          location_code: "T15",
          factor_code: "terrain",
          value: "mountain",
        },
      ],
    });
  const preview = await exchange.preview(user, "demands", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const result = exchange.commit(user, preview.token, {
    request_key: "feature-code-001",
  });
  assert.deepEqual(
    s.demands.get(result.results[0].id).work_locations[0].site_features_json
      .terrain,
    { factor_version: 1, value: "mountain" },
  );
});
