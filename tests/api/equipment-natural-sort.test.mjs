import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";

test("logical tower sorting is natural across paginated results and ties are stable",t=>{
  const {s,save}=fixture(t);
  const voltage=save("voltages",{name:"220kV"});
  const line=save("lines",{name:"自然排序测试",voltage_level_id:voltage.id});
  for(const no of ["10","02","2","3","11","1","#10","#2","#3","A10","A2"])
    save("towers",{line_id:line.id,tower_no:no});
  const all=s.equipment.search("towers",{lineId:line.id,sort:"tower_no",direction:"asc",page_size:100});
  assert.deepEqual(all.items.slice(0,6).map(x=>x.tower_no),["1","02","2","3","10","11"]);
  assert.ok(all.items.findIndex(x=>x.tower_no==="#2") < all.items.findIndex(x=>x.tower_no==="#10"));
  assert.ok(all.items.findIndex(x=>x.tower_no==="A2") < all.items.findIndex(x=>x.tower_no==="A10"));
  const first=s.equipment.search("towers",{lineId:line.id,sort:"tower_no",direction:"asc",page_size:5,page:1});
  const second=s.equipment.search("towers",{lineId:line.id,sort:"tower_no",direction:"asc",page_size:5,page:2});
  assert.deepEqual([...first.items,...second.items].map(x=>x.id),all.items.slice(0,10).map(x=>x.id));
  assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,10);
  const reverse=s.equipment.search("towers",{lineId:line.id,sort:"tower_no",direction:"desc",page_size:100});
  assert.deepEqual(new Set(reverse.items.map(x=>x.id)),new Set(all.items.map(x=>x.id)));
  assert.notDeepEqual(reverse.items.map(x=>x.id),all.items.map(x=>x.id));
});
test("one physical tower with multiple circuits appears exactly once when filtered by line",t=>{
  const {s,save}=fixture(t);
  const voltage=save("voltages",{name:"110kV"});
  const a=save("lines",{name:"甲回",voltage_level_id:voltage.id});
  const b=save("lines",{name:"乙回",voltage_level_id:voltage.id});
  const physical=save("physical",{asset_no:"同塔多回-001"});
  save("towers",{line_id:a.id,tower_no:"21",physical_tower_id:physical.id,physical_mode:"shared"});
  save("towers",{line_id:b.id,tower_no:"21A",physical_tower_id:physical.id,physical_mode:"shared"});
  const all=s.equipment.search("physical",{page_size:100});
  const filter=s.equipment.search("physical",{lineId:a.id,page_size:100});
  assert.equal(all.items.filter(x=>x.id===physical.id).length,1);
  assert.equal(filter.items.filter(x=>x.id===physical.id).length,1);
  assert.equal(filter.items.find(x=>x.id===physical.id).current_circuits,2);
});

test("status active equipment filter is exact and excludes inactive/retired records",t=>{
  const {s,user,save}=fixture(t);
  const voltage=save("voltages",{name:"500kV"});
  const line=save("lines",{name:"在运过滤测试线路",voltage_level_id:voltage.id});
  const active=save("towers",{line_id:line.id,tower_no:"1"});
  const inactive=save("towers",{line_id:line.id,tower_no:"2",status:"inactive"});
  const result=s.equipment.search("towers",{
    lineId:line.id,filters:{"status":"active"},page_size:100,
  });
  assert.ok(result.items.some(row=>row.id===active.id));
  assert.ok(!result.items.some(row=>row.id===inactive.id));
});

test("physical related tower numbers sort by the smallest natural tower number across its associated circuits",t=>{
  const {s,save}=fixture(t);
  const voltage=save("voltages",{name:"220kV"});
  const a=save("lines",{name:"排序关联甲回",voltage_level_id:voltage.id});
  const b=save("lines",{name:"排序关联乙回",voltage_level_id:voltage.id});
  const a2=save("physical",{asset_no:"相关杆号2"});
  const a10=save("physical",{asset_no:"相关杆号10"});
  const a3=save("physical",{asset_no:"相关杆号3"});
  const shared=save("physical",{asset_no:"相关多回22"});
  save("towers",{line_id:a.id,tower_no:"2",physical_mode:"shared",physical_tower_id:a2.id});
  save("towers",{line_id:a.id,tower_no:"10",physical_mode:"shared",physical_tower_id:a10.id});
  save("towers",{line_id:a.id,tower_no:"3",physical_mode:"shared",physical_tower_id:a3.id});
  save("towers",{line_id:a.id,tower_no:"22",physical_mode:"shared",physical_tower_id:shared.id});
  save("towers",{line_id:b.id,tower_no:"4",physical_mode:"shared",physical_tower_id:shared.id});
  const byNumber=s.equipment.search("physical",{sort:"related_towers",direction:"asc",page_size:100});
  const related=byNumber.items.filter(row=>[a2.id,a10.id,a3.id,shared.id].includes(row.id))
    .map(row=>row.id);
  assert.deepEqual(related,[a2.id,a3.id,shared.id,a10.id],
    "shared's earliest related number 4, not its GROUP_CONCAT text 22, determines its position");
  const paged=s.equipment.search("physical",{sort:"related_towers",direction:"asc",page_size:2});
  assert.deepEqual(paged.items.map(x=>x.id),byNumber.items.slice(0,2).map(x=>x.id));
});
