import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "../helpers.mjs";

test("settlement detail projects the adopted location identities for physical towers, logical towers and spans",t=>{
  const {s,user,save,unit,operation,towers}=fixture(t);
  const voltage=save("voltages",{name:"220kV"});
  const line=save("lines",{name:"合成冻结验收线",voltage_level_id:voltage.id});
  const start=save("towers",{line_id:line.id,tower_no:"12",physical_tower_id:towers[0].id});
  const end=save("towers",{line_id:line.id,tower_no:"13"});
  const span=save("spans",{line_id:line.id,start_tower_id:start.id,end_tower_id:end.id,status:"active"});
  const logical=save("objects",{name:"逻辑对象验收",object_position:"body",attribution_unit:"logical_tower"});
  const corridor=save("objects",{name:"通道对象验收",object_position:"corridor",attribution_unit:"logical_tower"});
  const logicalOp=save("operations",{name:"逻辑对象作业",work_object_id:logical.id,default_unit_id:unit.id,completion_standard:"合格"});
  const spanOp=save("operations",{name:"档距对象作业",work_object_id:corridor.id,default_unit_id:unit.id,completion_standard:"合格"});
  const demands=[
    [operation.id,{location_kind:"physical_tower",physical_tower_id:towers[0].id}],
    [logicalOp.id,{location_kind:"logical_tower",logical_tower_id:start.id}],
    [spanOp.id,{location_kind:"span",span_id:span.id}],
  ].map(([operation_id,location],i)=>{
    const d=s.demands.save(user,{operation_id,problem_description:"冻结位置测试"+i,expected_on:"2026-12-31",
      work_locations:[{...location,quantity_scaled:10000}]});
    s.demands.transition(user,d.id,{expected_version:1,expected_event_seq:1,status:"active"});
    return d;
  });
  const framework=save("frameworks",{fiscal_year:2026,name:"冻结位置测试框架",limit_fen:100000});
  let project=s.projects.save(user,{name:"冻结位置测试项目",framework_id:framework.id});
  for(const d of demands)project=s.projects.link(user,project.id,{demand_id:d.id,expected_version:project.version});
  project=s.projects.stock(user,project.id,{expected_version:project.version});
  project=s.projects.approvalDraft(user,project.id,{expected_version:project.version,approved_budget_fen:10000,
    scopes:project.scopes.map(scope=>({project_scope_id:scope.id,demand_version:1,locations:[{location_item_no:1,approved_quantity_scaled:10000}]}))});
  project=s.projects.approve(user,project.id,project.approvals[0].id,{expected_version:project.version});
  const bill=s.finance.saveDraft(user,project.id,{mode:"project_total",amount_fen:10000,basis:"位置证据",
    resolutions:project.scopes.map(scope=>({project_scope_id:scope.id,location_item_no:1,resolved_quantity_scaled:10000}))});
  const read=()=>Object.fromEntries(s.finance.settlementDetails(bill.id,project.id).document_details.resolutions.map(r=>[r.position.location_kind,r.position]));
  const original=read();
  assert.equal(original.physical_tower.asset_no,"T15");
  assert.ok(original.physical_tower.physical_code);
  assert.equal(original.logical_tower.line_name,"合成冻结验收线");
  assert.equal(original.logical_tower.tower_no,"12");
  assert.equal(original.span.line_name,"合成冻结验收线");
  assert.equal(original.span.start_tower_no,"12");
  assert.equal(original.span.end_tower_no,"13");
  s.catalog.save(user,"physical",{expected_version:towers[0].version,asset_no:"T15-新铭牌"},towers[0].id);
  s.catalog.save(user,"lines",{expected_version:line.version,name:"合成冻结验收更名线"},line.id);
  assert.deepEqual(read(),original);
  s.finance.submit(user,bill.id,{expected_version:0,expected_edit_version:1});
  s.finance.review(user,bill.id,{expected_version:1,expected_event_seq:1,action:"approve"});
  assert.deepEqual(read(),original);
  const other=s.projects.save(user,{name:"其他项目",framework_id:framework.id});
  assert.throws(()=>s.finance.settlementDetails(bill.id,other.id),e=>e.status===404);
});
