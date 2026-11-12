import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

test("work object owns two orthogonal business dimensions and immutable formal history", t => {
  const {s,save,user}=fixture(t);
  const bird=save("objects",{
    name:"防鸟装置-归属测试",object_position:"body",attribution_unit:"logical_tower",
  });
  assert.equal(bird.object_position,"body");
  assert.equal(bird.attribution_unit,"logical_tower");
  assert.equal(Object.hasOwn(bird,"work_target_type"),false);
  assert.deepEqual(s.standards.objectHistory(bird.id).map(v=>[v.object_position,v.attribution_unit]),
    [["body","logical_tower"]]);
  const revised=s.catalog.save(user,"objects",{
    expected_version:bird.version_no,object_position:"corridor",
  },bird.id);
  assert.equal(revised.object_position,"corridor");
  assert.equal(revised.attribution_unit,"logical_tower");
  assert.deepEqual(s.standards.objectHistory(bird.id).map(v=>v.object_position),
    ["body","corridor"]);
});
test("object's physical/logical ownership alone governs work operation, object-position remains independent", t => {
  const {s,save,user,unit}=fixture(t);
  const logical=save("objects",{name:"防鸟装置-逻辑",object_position:"body",attribution_unit:"logical_tower"});
  const physical=save("objects",{name:"基础-物理",object_position:"body",attribution_unit:"physical_tower"});
  const tree=save("objects",{name:"树木-物理",object_position:"corridor",attribution_unit:"physical_tower"});
  const conductor=save("objects",{name:"导线-逻辑",object_position:"corridor",attribution_unit:"logical_tower"});
  for(const object of [logical,physical,tree,conductor]){
    const op=save("operations",{name:object.name+"操作",work_object_id:object.id,
      default_unit_id:unit.id});
    assert.equal(op.work_object_id,object.id);
    assert.equal(op.object_position,object.object_position);
    assert.equal(op.attribution_unit,object.attribution_unit);
    assert.equal(Object.hasOwn(op,"work_target_type"),false);
    assert.equal(Object.hasOwn(op,"allow_tower"),false);
    assert.equal(Object.hasOwn(op,"allow_span"),false);
    assert.equal(Object.hasOwn(op,"default_location_kind"),false);
    assert.ok(op.work_object_version_no>0);
    const version=s.standards.operationVersion(op.id,op.version);
    assert.equal(version.work_object_version_no,object.version_no);
  }
});
test("operation adopts a precise object version and does not drift after object edits",t=>{
  const {s,save,user,unit}=fixture(t);
  const obj=save("objects",{name:"受控作业对象",object_position:"body",attribution_unit:"logical_tower"});
  const op=save("operations",{name:"受控操作",work_object_id:obj.id,default_unit_id:unit.id});
  s.catalog.save(user,"objects",{expected_version:obj.version_no,object_position:"corridor"},obj.id);
  assert.equal(s.standards.operationVersion(op.id,1).object_position,"body");
  assert.equal(s.standards.getOperation(op.id).object_position,"body");
  const amended=s.catalog.save(user,"operations",{expected_version:op.version,adopt_current_object:true},op.id);
  assert.equal(amended.work_object_version_no,2);
  assert.equal(amended.object_position,"corridor");
  assert.equal(s.standards.operationVersion(op.id,1).object_position,"body");
});
test("attribution identity prevents multi-circuit duplicate counting while allowing independent logical tower work",t=>{
  const {s,save,unit,user}=fixture(t);
  const voltage=save("voltages",{name:"220kV"});
  const a=save("lines",{name:"甲回",voltage_level_id:voltage.id});
  const b=save("lines",{name:"乙回",voltage_level_id:voltage.id});
  const physical=save("physical",{asset_no:"共塔基位A"});
  const la=save("towers",{line_id:a.id,tower_no:"21",physical_mode:"shared",physical_tower_id:physical.id});
  const lb=save("towers",{line_id:b.id,tower_no:"21A",physical_mode:"shared",physical_tower_id:physical.id});
  const bird=save("objects",{name:"防鸟本体",object_position:"body",attribution_unit:"logical_tower"});
  const base=save("objects",{name:"基础本体",object_position:"body",attribution_unit:"physical_tower"});
  const birdOp=save("operations",{name:"防鸟安装",work_object_id:bird.id,default_unit_id:unit.id});
  const baseOp=save("operations",{name:"基础修理",work_object_id:base.id,default_unit_id:unit.id});
  const demand=s.demands.save(user,{operation_id:birdOp.id,problem_description:"双回都需要施工",
    completion_standard:"按图安装并验收",work_locations:[
      {location_kind:"logical_tower",logical_tower_id:la.id,quantity_scaled:20000},
      {location_kind:"logical_tower",logical_tower_id:lb.id,quantity_scaled:30000},
    ]});
  assert.equal(demand.work_locations.length,2);
  assert.equal(demand.quantity_scaled,50000);
  const physicalDemand=s.demands.save(user,{operation_id:baseOp.id,problem_description:"整基基础作业",completion_standard:"修理并验收",
    work_locations:[{location_kind:"physical_tower",physical_tower_id:physical.id,quantity_scaled:10000}]});
  assert.equal(physicalDemand.work_locations.length,1);
  assert.throws(()=>s.demands.save(user,{operation_id:baseOp.id,problem_description:"错误重复基位",
    work_locations:[
      {location_kind:"physical_tower",physical_tower_id:physical.id,quantity_scaled:10000},
      {location_kind:"physical_tower",physical_tower_id:physical.id,quantity_scaled:10000},
    ]}),/重复/);
  assert.throws(()=>s.demands.save(user,{operation_id:baseOp.id,problem_description:"错误的逻辑单位",
    work_locations:[{location_kind:"logical_tower",logical_tower_id:la.id,quantity_scaled:10000}]}),
    /归属单元|定位|设备/);
});
