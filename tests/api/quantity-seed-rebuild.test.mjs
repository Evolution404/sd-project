import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureDemoDatabase } from "../../scripts/demo/seed-demo.mjs";
import { createSystem } from "../../dist/server/bootstrap.js";

function exact(rows, title) {
  assert.ok(rows.length > 0, title + " fixture should contain real facts");
  for (const row of rows) {
    assert.equal(row.unit_version > 0, true, title);
    const fields = JSON.parse(row.fields_json);
    assert.equal(Number.isInteger(fields.quantity_precision), true, title);
    assert.ok(fields.quantity_precision >= 0 && fields.quantity_precision <= 4, title);
    const divisor = 10 ** (4 - fields.quantity_precision);
    assert.equal(row.quantity_scaled % divisor, 0,
      title + ": " + JSON.stringify({ quantity: row.quantity_scaled,
        unit: row.unit_name, version: row.unit_version, precision: fields.quantity_precision }));
  }
}

function verify(s) {
  const db=s.database.connection;
  const units=db.prepare(`SELECT item.id,version.version,version.fields_json
    FROM dictionary_items item JOIN dictionary_item_versions version
      ON version.item_id=item.id WHERE item.type_id='unit'`).all();
  assert.equal(units.length,6);
  for(const unit of units){
    const parsed=JSON.parse(unit.fields_json);
    assert.ok(Object.hasOwn(parsed,"quantity_precision"),"formal unit history must define precision");
    assert.equal(Number.isInteger(parsed.quantity_precision),true);
    assert.ok(parsed.quantity_precision>=0 && parsed.quantity_precision<=4);
  }
  exact(db.prepare(`SELECT loc.quantity_scaled,d.unit_version,u.name AS unit_name,u.fields_json
    FROM demand_version_work_locations loc JOIN demand_versions d
      ON d.demand_id=loc.demand_id AND d.version=loc.demand_version
    JOIN dictionary_item_versions u ON u.item_id=d.unit_id AND u.version=d.unit_version`).all(),
    "demand work positions");
  exact(db.prepare(`SELECT item.quantity_scaled,item.unit_version,u.name AS unit_name,u.fields_json
    FROM demand_material_version_items item JOIN dictionary_item_versions u
      ON u.item_id=item.unit_id AND u.version=item.unit_version`).all(),
    "demand expected materials");
  exact(db.prepare(`SELECT scope.quantity_scaled,d.unit_version,u.name AS unit_name,u.fields_json
    FROM project_approval_scope_versions scope JOIN demand_versions d
      ON d.demand_id=scope.demand_id AND d.version=scope.demand_version
    JOIN dictionary_item_versions u ON u.item_id=d.unit_id AND u.version=d.unit_version`).all(),
    "project approved quantities");
  exact(db.prepare(`SELECT item.approved_quantity_scaled AS quantity_scaled,
      item.unit_version,u.name AS unit_name,u.fields_json
    FROM project_approval_material_items item JOIN dictionary_item_versions u
      ON u.item_id=item.unit_id AND u.version=item.unit_version`).all(),
    "project approved materials");
  exact(db.prepare(`SELECT settlement.resolved_quantity_scaled AS quantity_scaled,
      demand.unit_version,u.name AS unit_name,u.fields_json
    FROM settlement_scope_results settlement
    JOIN project_approval_scope_versions scope
      ON scope.id=settlement.approval_scope_version_id
    JOIN demand_versions demand
      ON demand.demand_id=scope.demand_id AND demand.version=scope.demand_version
    JOIN dictionary_item_versions u ON u.item_id=demand.unit_id
      AND u.version=demand.unit_version`).all(), "settlement resolved work");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
}

test("isolated current-Schema test data rebuild freezes explicit quantity precision throughout all business facts",t=>{
  const root=mkdtempSync(join(tmpdir(),"sd-rebuild-precision-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(let index=0;index<2;index++){
    const directory=join(root,"new-fixture-"+index);
    assert.equal(existsSync(directory),false);
    const fresh=ensureDemoDatabase(directory);
    assert.equal(fresh.created,true);
    const instance=createSystem(directory);
    try { verify(instance); } finally { instance.close(); }
  }
  assert.equal(existsSync(join(root,"schema113.sqlite")),false,
    "rebuild must not create or modify a global runtime database");
});
