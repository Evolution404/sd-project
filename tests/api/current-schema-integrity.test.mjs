import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createSystem } from "../../dist/server/bootstrap.js";
import { fixture } from "../helpers.mjs";

/** The development-stage authority is the current single schema, not old release upgrades. */
test("fresh database uses only the authoritative Schema113 and required unit adoption FKs", t => {
  const folder = mkdtempSync(join(tmpdir(), "sd-current-schema-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const s = createSystem(folder);
  try {
    const tables = s.database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
    assert.ok(tables.includes("dictionary_item_versions"));
    assert.ok(tables.includes("demand_material_version_items"));
    assert.ok(tables.includes("project_approval_material_items"));
    for (const name of ["demand_material_version_items", "project_approval_material_items"]) {
      const fields = s.database.connection.prepare(`PRAGMA table_info("${name}")`).all();
      assert.ok(fields.some(f => f.name === "unit_version" && f.notnull === 1), name);
      const keys = s.database.connection.prepare(`PRAGMA foreign_key_list("${name}")`).all();
      assert.ok(keys.some(f => f.table === "dictionary_item_versions" && f.from === "unit_id"), name);
      assert.ok(keys.some(f => f.table === "dictionary_item_versions" && f.from === "unit_version"), name);
    }
    assert.equal(inspect(s).integrity().integrity[0].integrity_check, "ok");
    assert.deepEqual(inspect(s).integrity().foreignKeys, []);
  } finally { s.close(); }
});

test("fresh schema refuses unexpected structure rather than running a legacy upgrade", t => {
  const folder = mkdtempSync(join(tmpdir(), "sd-schema-drift-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const instance = createSystem(folder);
  instance.close();
  const db = new DatabaseSync(join(folder, "schema113.sqlite"));
  db.exec("CREATE TABLE unexpected_extra(id TEXT PRIMARY KEY) STRICT");
  db.close();
  assert.throws(() => createSystem(folder), /Schema113结构与当前权威SQL不一致/);
  const check = new DatabaseSync(join(folder,"schema113.sqlite"), { readOnly: true });
  try {
    assert.equal(check.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE name='unexpected_extra'").get().total, 1);
  } finally { check.close(); }
});

test("tampered columns are rejected and original test database facts are not rewritten on opening", t => {
  const folder = mkdtempSync(join(tmpdir(), "sd-schema-unexpected-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const s = createSystem(folder);
  s.auth.initialize("admin","only-fixture-password");
  const { user } = s.auth.login("admin","only-fixture-password");
  const unit = s.catalog.save(user,"units",{name:"套",quantity_precision:0});
  s.close();
  const db = new DatabaseSync(join(folder,"schema113.sqlite"));
  db.exec("CREATE INDEX unexpected_index ON dictionary_items(code)");
  db.close();
  assert.throws(() => createSystem(folder), /Schema113结构与当前权威SQL不一致/);
  const read = new DatabaseSync(join(folder,"schema113.sqlite"),{readOnly:true});
  try {
    assert.equal(read.prepare("SELECT COUNT(*) AS total FROM dictionary_items WHERE id=?").get(unit.id).total,1);
  } finally { read.close(); }
});

test("shared tower physical nature is single authoritative fact with immutable history", t => {
  const { s,user,save } = fixture(t);
  const voltage = save("voltages",{name:"500kV"});
  const lines = ["性质甲线","性质乙线"].map(name=>save("lines",{name,voltage_level_id:voltage.id}));
  const first = save("towers",{line_id:lines[0].id,tower_no:"#001",physical_properties:{tower_nature:"straight"}});
  const shared = save("towers",{line_id:lines[1].id,tower_no:"#001",physical_tower_id:first.physical_tower_id});
  assert.equal(shared.tower_nature,"straight");
  const physical = s.catalog.get("physical",first.physical_tower_id);
  s.catalog.save(user,"physical",{expected_version:physical.version,tower_nature:"tension"},physical.id);
  assert.equal(s.catalog.get("towers",first.id).tower_nature,"tension");
  assert.equal(s.catalog.get("towers",shared.id).tower_nature,"tension");
  assert.equal(s.catalog.search("towers",{filters:{tower_nature:"耐"}}).total,2);
  assert.equal(s.catalog.search("towers",{filters:{tower_nature:"tension"}}).total,2);
  assert.equal(s.catalog.search("physical",{q:"耐张"}).total,1);
  const versions = inspect(s).where("physical_tower_history",{physical_tower_id:physical.id},"version");
  assert.deepEqual(versions.map(v=>v.tower_nature),["tension","straight"]);
  assert.throws(()=>s.catalog.save(user,"physical",{tower_nature:"guessed"}),/字典|不存在|约束/);
  assert.deepEqual(inspect(s).integrity().foreignKeys,[]);
});

test("unit version edits are append only and retain exact quantity precision", t => {
  const { s,user,unit } = fixture(t);
  const before = s.dictionaries.history("units",unit.id);
  assert.equal(before[0].quantity_precision,0);
  const revised = s.dictionaries.saveDictionary(user,"units",{
    expected_version:1,quantity_precision:2,
  },unit.id);
  assert.equal(revised.version,2);
  assert.equal(s.dictionaries.history("units",unit.id)[0].quantity_precision,0);
  assert.equal(s.dictionaries.history("units",unit.id)[1].quantity_precision,2);
  assert.throws(()=>s.dictionaries.saveDictionary(user,"units",{
    expected_version:1,quantity_precision:1,
  },unit.id),/版本冲突/);
});

test("current schema removes obsolete equipment fields without old-structure compatibility", t => {
  const folder=mkdtempSync(join(tmpdir(),"sd-current-equipment-"));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const s=createSystem(folder);
  try {
    for(const name of ["transmission_lines","line_history","physical_towers","physical_tower_history"]) {
      const fields=s.database.connection.prepare(`PRAGMA table_info("${name}")`).all();
      assert.ok(!fields.some(f=>f.name==="erection_type"),name);
    }
    assert.ok(readFileSync(new URL("../../server/database/schema/schema113.sql",import.meta.url),"utf8").includes("quantity_scaled"));
  } finally { s.close(); }
});
