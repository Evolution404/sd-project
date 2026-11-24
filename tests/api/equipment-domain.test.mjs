import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { createEquipment } from "../../dist/server/modules/equipment/service.js";
import { equipmentRepository } from "../../dist/server/database/repositories/equipment.js";
import { auditRepository } from "../../dist/server/database/repositories/audit.js";
import { createAudit } from "../../dist/server/platform/audit/service.js";

test("equipment repository reads stay bounded as a page grows and preserve all circuit labels", (t) => {
  const { s, user, save } = fixture(t);
  const voltage = save("voltages", { name: "220kV" });
  const line = save("lines", {
    name: "设备集合查询",
    voltage_level_id: voltage.id,
  });
  const shared = save("physical", { tower_nature: "straight" });
  for (let index = 0; index < 200; index++)
    save("towers", {
      line_id: line.id,
      tower_no: "#" + index,
      physical_tower_id: shared.id,
    });
  let calls = 0;
  const counted = new Proxy(inspect(s), {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args) => {
        if (["query", "get", "where", "find", "list"].includes(key)) calls++;
        return value(...args);
      };
    },
  });
  const equipment = createEquipment(
    equipmentRepository(counted),
    s.database,
    createAudit(auditRepository(counted)),
  );
  for (const pageSize of [1, 200]) {
    calls = 0;
    const result = equipment.search("towers", { page_size: pageSize });
    assert.equal(result.total, 200);
    assert.equal(result.items.length, pageSize);
    assert.equal(calls, 4);
    assert.equal(result.items[0].line_id_label, "设备集合查询");
    assert.equal(result.items[0].voltage_level_name, "220kV");
    assert.match(result.items[0].tower_no, /^#\d+$/);
    assert.equal(result.items[0].physical_tower_id_label, shared.tower_code);
    assert.equal(result.items[0].tower_nature, "straight");
  }
  calls = 0;
  assert.equal(equipment.list("towers").length, 200);
  assert.equal(calls, 2);
  calls = 0;
  const physical = equipment.search("physical", { q: "设备集合查询" });
  assert.equal(calls, 4);
  assert.equal(physical.items[0].bindings.length, 200);
  assert.equal(physical.items[0].current_circuits, 200);
  assert.deepEqual(
    s.catalog.get("physical", shared.id),
    s.equipment.get("physical", shared.id),
  );
  assert.throws(
    () =>
      equipment.save(
        { ...user, role: "viewer", permissions: ["read"] },
        "lines",
        { name: "越权" },
      ),
    /权限/,
  );
});

test("equipment validation and voltage revisions retain identities, audited versions and atomic rollback", (t) => {
  const { s, user, save } = fixture(t);
  const voltage = save("voltages", { name: "110kV" });
  const revised = s.equipment.save(
    user,
    "voltages",
    { name: "110千伏", expected_version: 1 },
    voltage.id,
  );
  assert.equal(revised.version, 2);
  assert.equal(revised.code, voltage.code);
  assert.equal(
    s.catalog
      .history("voltages", voltage.id)
      .filter((event) => event.action === "revise").length,
    1,
  );
  assert.throws(
    () =>
      s.equipment.save(
        user,
        "voltages",
        { name: "非法并发", expected_version: 1 },
        voltage.id,
      ),
    /版本冲突/,
  );
  const line = save("lines", {
    name: "独立设备流程",
    voltage_level_id: voltage.id,
  });
  const before = s.equipment.list("physical").length;
  assert.throws(
    () =>
      s.equipment.save(user, "towers", {
        line_id: line.id,
        tower_no: "",
        physical_properties: { tower_nature: "straight" },
      }),
    /杆塔号/,
  );
  assert.equal(s.equipment.list("physical").length, before);
  assert.throws(
    () => s.equipment.save(user, "physical", { tower_nature: "guessed" }),
    /字典|不存在|约束/,
  );
  const tower = save("towers", { line_id: line.id, tower_no: "#1" });
  s.equipment.save(
    user,
    "towers",
    { tower_no: "#2", expected_version: 1 },
    tower.id,
  );
  assert.equal(s.equipment.history("towers", tower.id).length, 2);
  s.equipment.remove(user, "towers", tower.id, 2);
  assert.equal(s.equipment.list("towers").length, 0);
  assert.equal(s.equipment.get("towers", tower.id, true).tower_no, "#2");
  assert.deepEqual(inspect(s).integrity().foreignKeys, []);
});

test("equipment worksheet bulk maintenance is bounded, versioned and atomic; structural fields are forbidden", t=>{
  const {s,user,save}=fixture(t);
  const a=save("physical",{asset_no:"BULK-A",model:"A"}),b=save("physical",{asset_no:"BULK-B",model:"B"});
  const change=(row,changes)=>({id:row.id,expected_version:row.version,changes});
  assert.throws(()=>s.equipment.bulk(user,"physical",{rows:[change(a,{model:"changed"}),change(b,{tower_code:"ILLEGAL"})]}),/不允许/);
  assert.equal(s.equipment.get("physical",a.id).model,"A");
  assert.throws(()=>s.equipment.bulk(user,"physical",{rows:[change(a,{model:"changed"}),{...change(b,{model:"changed"}),expected_version:999}]}),/版本冲突/);
  assert.equal(s.equipment.get("physical",a.id).version,a.version);
  assert.throws(()=>s.equipment.bulk(user,"physical",{rows:[change(a,{model:"changed"}),change(a,{model:"other"})]}),/重复/);
  assert.throws(()=>s.equipment.bulk(user,"physical",{rows:Array.from({length:101},()=>change(a,{model:"changed"}))}),/100/);
  assert.throws(()=>s.equipment.bulk({...user,role:"viewer",permissions:["read"]},"physical",{rows:[change(a,{model:"changed"})]}),/权限/);
  assert.throws(()=>s.equipment.bulk(user,"physical",{rows:[change(a,{model:"changed"}),change(b,{tower_material:"不存在的字典"})]}));
  assert.equal(s.equipment.get("physical",a.id).version,a.version);
  assert.equal(s.equipment.bulk(user,"physical",{rows:[change(a,{model:"A"})]}).count,0);
  assert.equal(s.equipment.bulk(user,"physical",{rows:[change(a,{model:"changed",height_scaled:120125}),change(b,{purpose:"ordinary"})]}).count,2);
  const changed=s.equipment.get("physical",a.id);
  assert.equal(changed.model,"changed");
  assert.equal(changed.height_scaled,120125);
  assert.equal(changed.asset_no,a.asset_no);
  assert.equal(changed.version,a.version+1);
  assert.equal(s.equipment.get("physical",b.id).purpose,"ordinary");
});

test("batch edits adopt valid voltage and ordinary asset fields without changing stable identities",t=>{
  const {s,user,save}=fixture(t);
  const v1=save("voltages",{name:"35kV"}),v2=save("voltages",{name:"110kV"});
  const line=save("lines",{name:"线路A",voltage_level_id:v1.id});
  const other=save("lines",{name:"线路B",voltage_level_id:v1.id});
  const a=save("physical",{asset_no:"旧铭牌"});
  const tower=save("towers",{line_id:line.id,tower_no:"001",physical_tower_id:a.id});
  const sibling=save("towers",{line_id:line.id,tower_no:"002"});
  const change=(row,changes)=>({id:row.id,expected_version:row.version,changes});
  assert.throws(()=>s.equipment.bulk(user,"lines",{rows:[change(line,{voltage_level_id:v2.id}),change(other,{voltage_level_id:"不存在"})]}));
  assert.equal(s.equipment.get("lines",line.id).voltage_level_id,v1.id);
  assert.equal(s.equipment.bulk(user,"lines",{rows:[change(line,{voltage_level_id:v2.id})]}).count,1);
  const revised=s.equipment.get("lines",line.id);
  assert.equal(revised.line_code,line.line_code);assert.equal(revised.voltage_level_id,v2.id);assert.equal(revised.version,line.version+1);
  assert.throws(()=>s.equipment.bulk(user,"lines",{rows:[change(revised,{line_kind:"branch"})]}),/不允许/);
  assert.equal(s.equipment.bulk(user,"physical",{rows:[change(a,{asset_no:"新铭牌"})]}).count,1);
  assert.equal(s.equipment.get("physical",a.id).tower_code,a.tower_code);
  assert.throws(()=>s.equipment.bulk(user,"towers",{rows:[change(tower,{tower_no:sibling.tower_no})]}),/重复/);
  assert.throws(()=>s.equipment.bulk(user,"towers",{rows:[change(tower,{sort_rank:0})]}),/正整数/);
  assert.equal(s.equipment.bulk(user,"towers",{rows:[change(tower,{tower_no:"003",sort_rank:3})]}).count,1);
  assert.equal(s.equipment.get("towers",tower.id).logical_code,tower.logical_code);
  assert.equal(s.equipment.get("towers",tower.id).tower_no,"003");
});
