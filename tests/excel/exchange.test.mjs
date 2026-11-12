import { columnIndex } from "../workbook-helpers.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fixture, attribute } from "../helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import { makeWorkbook, attributeColumn } from "../../dist/server/modules/exchange/workbook.js";
test("demand maintenance export, diff, revision, idempotency and stale version", async (t) => {
  const { s, user, demandInput } = fixture(t),
    exchange = createExchange(s),
    demand = s.demands.save(user, demandInput);
  const buffer = await exchange.exportData(user, "demands", {
    ids: [demand.id],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const positions=workbook.getWorksheet("作业位置");
  positions.getRow(2).getCell(columnIndex(positions,"quantity_scaled")).value = 5;
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
        import_ref: demand.demand_no,
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
test("new workbook accepts business operation and equipment names with human decimal quantities", async (t) => {
  const { s, user } = fixture(t, { quantity_precision: 2 }),
    exchange = createExchange(s);
  const buffer = await makeWorkbook("demands", {
    documents: [
      {
        import_ref: "CODE-D001",
        operation_name: "安装防鸟装置",
        problem_description: "按现场设备编码录入",
        completion_standard: "安装牢固",
      },
    ],
    work_locations: [
      {
        import_ref: "CODE-D001",
        action: "upsert",
        location_kind: "physical_tower",
        asset_no: "T15",
        quantity_scaled: 25000,
        work_mode: "outage",
      },
    ],
  });
  const readable = new ExcelJS.Workbook();
  await readable.xlsx.load(buffer);
  const locationSheet = readable.getWorksheet("作业位置");
  assert.equal(locationSheet.getRow(2).getCell(columnIndex(locationSheet,"action")).value, "新增或修改");
  assert.equal(locationSheet.getRow(2).getCell(columnIndex(locationSheet,"location_kind")).value, "物理杆塔");
  assert.equal(locationSheet.getRow(2).getCell(columnIndex(locationSheet,"work_mode")).value, "停电");
  assert.equal(locationSheet.getColumn(columnIndex(locationSheet,"physical_tower_id")).hidden, true);
  assert.ok(locationSheet.getRow(2).getCell(columnIndex(locationSheet,"location_kind")).dataValidation);
  const preview = await exchange.preview(user, "demands", buffer);
  assert.equal(preview.issues.length, 0, JSON.stringify(preview.issues));
  const result = exchange.commit(user, preview.token, {
    request_key: "code-import-0001",
  });
  assert.equal(result.results.length, 1);
  assert.equal(s.demands.get(result.results[0].id).quantity_scaled, 25000);
  assert.equal(
    s.demands.get(result.results[0].id).work_locations[0].work_mode,
    "outage",
  );
});
test("required unified attributes share online and workbook validation",async t=>{
  const {s,user,operation,demandInput}=fixture(t);
  const field=attribute({key:"height",label:"作业高度",scope:"demand",type:"decimal",precision:2,pricing:false,requirement:"save"});
  s.standards.saveOperation(user,{expected_version:1,attributes_schema_json:[field]},operation.id);
  assert.throws(()=>s.demands.save(user,demandInput),/作业高度/);
  const exchange=createExchange(s);
  const bytes=await makeWorkbook("demands",{documents:[{import_ref:"EXTRA",operation_name:operation.name,problem_description:"现场附加事实",completion_standard:"牢固",[attributeColumn(field.key)]:"12.50"}],
    work_locations:[{import_ref:"EXTRA",location_kind:"physical_tower",asset_no:"T15",quantity_scaled:10000}]},{attributes:[field]});
  const preview=await exchange.preview(user,"demands",bytes);
  assert.deepEqual(preview.issues,[]);
  const result=exchange.commit(user,preview.token,{request_key:"extra-fields-0001",atomic:true});
  assert.equal(s.demands.get(result.results[0].id).attributes.height,"12.50");
});
test("workbook uses position attributes directly without a parallel pricing sheet",async t=>{
  const {s,user,operation}=fixture(t);
  const field=attribute({key:"terrain",label:"地形",options:[{value:"mountain",label:"山地"},{value:"plain",label:"平原"}]});
  s.standards.saveOperation(user,{expected_version:1,attributes_schema_json:[field]},operation.id);
  const exchange=createExchange(s);
  const bytes=await makeWorkbook("demands",{documents:[{import_ref:"FEATURE",operation_name:operation.name,problem_description:"现场条件",completion_standard:"牢固"}],
    work_locations:[{import_ref:"FEATURE",location_ref:"T15",location_kind:"physical_tower",asset_no:"T15",quantity_scaled:10000,[attributeColumn(field.key)]:"山地"}]},{attributes:[field]});
  const preview=await exchange.preview(user,"demands",bytes);
  assert.deepEqual(preview.issues,[]);
  const result=exchange.commit(user,preview.token,{request_key:"feature-code-001",atomic:true});
  assert.equal(result.results[0].import_ref,"FEATURE");
  assert.match(result.results[0].number,/^XQ-/);
  assert.equal(s.demands.get(result.results[0].id).work_locations[0].attributes.terrain,"mountain");
});
test("patched UUID dependency supports ExcelJS extended formatting and workbook roundtrip", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("格式回归");
  sheet.getCell("A1").value = 1;
  sheet.getCell("A2").value = 2;
  sheet.addConditionalFormatting({
    ref: "A1:A2",
    rules: [
      {
        type: "dataBar",
        gradient: false,
        cfvo: [{ type: "min" }, { type: "max" }],
        color: { argb: "FF006600" },
      },
    ],
  });
  const buffer = await workbook.xlsx.writeBuffer();
  assert.match(
    sheet.conditionalFormattings[0].rules[0].x14Id,
    /^\{[0-9A-F-]{36}\}$/,
  );
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  assert.equal(loaded.getWorksheet("格式回归").getCell("A2").value, 2);
});
