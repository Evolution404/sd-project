import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { quantityUnitRepository } from "../../dist/server/database/repositories/quantity-units.js";
import { projectReadRepository } from "../../dist/server/database/repositories/projects.js";

test("large material approvals validate adopted unit versions in one indexed batch", t => {
  const {s,user,save,unit,demandInput}=fixture(t);
  const materials=Array.from({length:80},(_,index)=>
    save("materials",{name:"物资批量精度验证"+String(index).padStart(3,"0"),unit_id:unit.id}));
  const demand=s.demands.save(user,demandInput);
  s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
  const framework=save("frameworks",{name:"80种物资批量项目",fiscal_year:2026,limit_fen:1000000});
  let project=s.projects.save(user,{name:"80种物资批准",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  const scope=project.scopes[0];
  const next=s.projects.approvalDraft(user,project.id,{
    expected_version:2,approved_budget_fen:123456,
    scopes:[{
      project_scope_id:scope.id,demand_version:1,
      locations:[{location_item_no:1,approved_quantity_scaled:10000}],
      materials:materials.map(item=>({material_id:item.id,quantity_scaled:10000})),
    }],
  });
  const approved=next.approvals[0].scopes[0].materials;
  assert.equal(approved.length,materials.length);
  assert.equal(new Set(approved.map(item=>item.material_version_id)).size,materials.length);
  assert.ok(approved.every(item=>item.unit_version===1 && item.approved_quantity_scaled===10000));
  assert.deepEqual(s.repo.integrity().foreignKeys,[]);
});

test("quantity-unit and approval link repositories make fixed-count indexed reads", () => {
  const statements=[];
  const store={query(sql,...args) {
    statements.push({sql,args});
    return [];
  }};
  const quantities=quantityUnitRepository(store);
  const approvals=projectReadRepository(store);
  quantities.materialUnits(Array.from({length:1200},(_,i)=>"material-"+i));
  approvals.projectScopeMaterialLinks(Array.from({length:1200},(_,i)=>"scope-"+i));
  assert.equal(statements.length,2);
  assert.ok(statements.every(statement=>statement.sql.includes("json_each(?)")));
  assert.equal(JSON.parse(statements[0].args[0]).length,1200);
  assert.equal(JSON.parse(statements[1].args[0]).length,1200);
});
