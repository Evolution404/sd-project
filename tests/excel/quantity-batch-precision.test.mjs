import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";

test("Excel preflight rejects fractional sets by row, commits only legitimate selection, then supports corrected retry", async t => {
  const {s,user,operation,towers}=fixture(t);
  const exchange=createExchange(s);
  const documents=[
    {import_ref:"PREC-EXCEL-VALID",operation_name:operation.name,
     problem_description:"批量导入完整件",completion_standard:"验收完好"},
    {import_ref:"PREC-EXCEL-INVALID",operation_name:operation.name,
     problem_description:"不得安装半套",completion_standard:"验收完好"},
  ];
  const rows=[
    {import_ref:"PREC-EXCEL-VALID",location_kind:"physical_tower",
     asset_no:towers[0].asset_no,quantity_scaled:20000},
    {import_ref:"PREC-EXCEL-INVALID",location_kind:"physical_tower",
     asset_no:towers[1].asset_no,quantity_scaled:15000},
  ];
  const invalid=await exchange.preview(user,"demands",
    await makeWorkbook("demands",{documents,work_locations:rows}));
  assert.ok(invalid.issues.some(item=>/整数/.test(item.reason)),
    JSON.stringify(invalid.issues));
  assert.equal(s.demands.list().length,0,"preview never mutates business facts");
  assert.equal(invalid.documents.length,1,"invalid document is excluded from commit candidates");
  assert.ok(invalid.documents.some(item=>item.number==="PREC-EXCEL-VALID" && item.action==="create"));
  assert.throws(() => exchange.commit(user,invalid.token,
    {request_key:"bulk-prec-atomic-reject",atomic:true}), /整批提交包含预检错误/);
  assert.equal(s.demands.list().length,0,"atomic validation rejects entire workbook");
  const result=exchange.commit(user,invalid.token,{request_key:"bulk-prec-accepted-001",atomic:false});
  assert.equal(result.results.length,1);
  assert.ok(result.issues.some(item=>/整数/.test(item.reason)));
  assert.equal(s.demands.list().length,1,"only valid business document is imported");
  assert.equal(s.demands.get(result.results[0].id).quantity_scaled,20000);
  const corrected=await exchange.preview(user,"demands",
    await makeWorkbook("demands",{
      documents:[documents[1]],
      work_locations:[{...rows[1],quantity_scaled:20000}],
    }));
  assert.equal(corrected.issues.length,0,JSON.stringify(corrected.issues));
  const saved=exchange.commit(user,corrected.token,{request_key:"bulk-prec-correct-002",atomic:true});
  assert.equal(saved.issues.length,0);
  assert.equal(saved.results.length,1);
  const created=s.demands.get(saved.results[0].id);
  assert.equal(created.quantity_scaled,20000);
  assert.equal(s.demands.list().length,2);
  assert.deepEqual(inspect(s).integrity().foreignKeys,[]);
});
