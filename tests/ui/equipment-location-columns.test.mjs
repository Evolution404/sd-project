import { test } from "node:test";
import assert from "node:assert/strict";
import { equipmentLocationColumns, equipmentLocationPreferenceKey,
  equipmentLocationQueryKind, equipmentLocationDisplay } from
  "../../web/src/modules/demands/composables/equipment-location-columns.ts";

const keys = type => equipmentLocationColumns(type).map(c=>c.key);
const labels = type => equipmentLocationColumns(type).map(c=>c.label);

test("three location kinds have independent structural schemas without composite identity columns", ()=>{
  assert.deepEqual([...new Set(["physical_tower","logical_tower","span"].map(equipmentLocationPreferenceKey))].length, 3);
  for (const kind of ["physical_tower","logical_tower","span"]) {
    const cols=equipmentLocationColumns(kind);
    assert.ok(cols.every(c=>c.key && c.label && typeof c.sortable==="boolean" && typeof c.filterable==="boolean"));
    assert.equal(keys(kind)[0],"selected");
    assert.ok(!labels(kind).includes("作业设备"));
    assert.ok(!labels(kind).includes("杆号或档距"));
    assert.ok(!keys(kind).includes("label"));
  }
  assert.deepEqual(labels("logical_tower").slice(1,4),["所属线路","电压等级","杆号"]);
  assert.ok(labels("physical_tower").includes("资产编号"));
  assert.ok(labels("physical_tower").includes("关联杆号"));
  assert.ok(!keys("physical_tower").includes("tower_no"));
  assert.ok(labels("span").includes("档距"));
  assert.ok(!keys("span").includes("tower_no"));
  assert.ok(keys("span").includes("start_tower_no"));
  assert.ok(keys("span").includes("end_tower_no"));
});

test("physical identity always uses physical repository regardless of line filter",()=>{
  assert.equal(equipmentLocationQueryKind("physical_tower","line-A"),"physical");
  assert.equal(equipmentLocationQueryKind("physical_tower",null),"physical");
  assert.equal(equipmentLocationQueryKind("logical_tower","line-A"),"towers");
  assert.equal(equipmentLocationQueryKind("span","line-A"),"spans");
});

test("display values are entity-specific with explicit missing-data states",()=>{
  assert.equal(equipmentLocationDisplay("logical_tower",{tower_no:"23"},"tower_no"),"23");
  assert.equal(equipmentLocationDisplay("physical_tower",{related_towers:"21、23"},"related_towers"),"21、23");
  assert.equal(equipmentLocationDisplay("span",{start_tower_no:"21",end_tower_no:"22"},"span"),"21 ~ 22");
  assert.equal(equipmentLocationDisplay("span",{start_tower_no:"21"},"span"),"档距端点待核实");
  assert.equal(equipmentLocationDisplay("physical_tower",{},"related_towers"),"未关联杆号");
  assert.equal(equipmentLocationDisplay("logical_tower",{},"tower_no"),"杆号待核实");
  assert.ok(!["undefined","null"].some(x=>
    equipmentLocationDisplay("span",{},"span").includes(x)));
});

test("only supported sortable and filterable fields expose capabilities",()=>{
  for(const kind of ["physical_tower","logical_tower","span"]) {
    const columns=equipmentLocationColumns(kind);
    assert.equal(columns[0].sortable,false);
    assert.equal(columns[0].filterable,false);
    for (const col of columns) {
      if(col.sortable) assert.ok(col.sortKey,"Sort requires a real backend query key");
      if(col.filterable) assert.ok(col.filterKey,"Filter requires a real backend query key");
    }
  }
  assert.equal(equipmentLocationColumns("physical_tower").find(c=>c.key==="related_towers").sortable,true);
  assert.equal(equipmentLocationColumns("physical_tower").find(c=>c.key==="related_towers").sortKey,"related_towers");
  assert.ok(labels("physical_tower").includes("杆塔性质"));
  assert.equal(equipmentLocationDisplay("physical_tower",{tower_nature:"straight"},"tower_nature"),"直线塔");
  assert.equal(equipmentLocationDisplay("physical_tower",{tower_nature:"tension"},"tower_nature"),"耐张塔");
  assert.equal(equipmentLocationDisplay("physical_tower",{tower_type:"angle"},"tower_type"),"角钢塔");
  assert.equal(equipmentLocationDisplay("physical_tower",{tower_type:"pipe"},"tower_type"),"钢管塔");
  assert.equal(equipmentLocationDisplay("physical_tower",{tower_type:"未定义型号"},"tower_type"),"未定义型号");
  assert.equal(equipmentLocationColumns("span").find(c=>c.key==="span").sortable,false);
});
