import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, approvedFixture } from "../helpers.mjs";

function draft(project, scope, node, qty, resolved = qty) {
  return {
    approval_version_id: project.approval.id,
    number: "QPREC-" + qty + "-" + resolved,
    items: [{
      cost_node_id: node.id,
      project_scope_id: scope.id,
      quantity_scaled: qty,
      amount_fen: 1000,
      evidence: "真实模拟费用与施工记录",
    }],
    resolutions: [{
      project_scope_id: scope.id,
      resolved_quantity_scaled: resolved,
      evidence: "现场验收签字依据",
    }],
  };
}
function expectPrecisionFailure(action, field) {
  assert.throws(action, problem => {
    assert.equal(problem.status,422);
    assert.match(problem.message,/整数|小数/);
    assert.match(String(problem.fields[field]),/整数|小数/);
    return true;
  });
}

test("project linking rejects partial quantity and approvals require complete formal demand", t => {
  const {s,user,save,demandInput} = fixture(t);
  const demand=s.demands.save(user,demandInput);
  s.demands.transition(user,demand.id,{
    expected_version:1,expected_event_seq:1,status:"active",
  });
  const framework=save("frameworks",{name:"数量精度框架",fiscal_year:2026,limit_fen:100000});
  let project=s.projects.save(user,{name:"数量精度项目",framework_id:framework.id});
  assert.throws(()=>s.projects.link(user,project.id,{
      demand_id:demand.id,expected_version:1,quantity_scaled:15000,
    }),error=>error.status===422 && /整体承接/.test(error.message));
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  const scope=project.scopes[0];
  const input={
    expected_version:2,
    approved_budget_fen:50000,
    scopes:[{
      project_scope_id:scope.id,
      demand_version:1,
      locations:[
        {location_item_no:1,approved_quantity_scaled:15000},
        {location_item_no:2,approved_quantity_scaled:20000},
      ],
    }],
  };
  assert.throws(()=>s.projects.approvalDraft(user,project.id,input),
    problem=>problem.status===422 && /全部位置/.test(problem.message));
  assert.equal(s.projects.get(project.id).approvals.length,0);
  const valid=s.projects.approvalDraft(user,project.id,{
    ...input,
    scopes:[{...input.scopes[0],
      locations:demand.work_locations.map(loc=>({
        location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled,
      }))}],
  });
  assert.equal(valid.approvals.length,1);
  assert.equal(valid.approvals[0].scopes[0].quantity_scaled,demand.quantity_scaled);
});

test("project approved materials use unit precision and persist adopted unit version", t => {
  const {s,user,save,demandInput,unit} = fixture(t);
  const material=save("materials",{name:"一套防鸟器",unit_id:unit.id});
  const demand=s.demands.save(user,demandInput);
  s.demands.transition(user,demand.id,{
    expected_version:1,expected_event_seq:1,status:"active",
  });
  const framework=save("frameworks",{name:"单位版本归档",fiscal_year:2026,limit_fen:100000});
  let project=s.projects.save(user,{name:"物资批准",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  const scope=project.scopes[0];
  const body={
    expected_version:2,approved_budget_fen:50000,
    scopes:[{
      project_scope_id:scope.id,demand_version:1,
      locations:demand.work_locations.map(loc=>({
        location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled,
      })),
      materials:[{material_id:material.id,quantity_scaled:15000}],
    }],
  };
  assert.throws(()=>s.projects.approvalDraft(user,project.id,body),/整数/);
  const written=s.projects.approvalDraft(user,project.id,{
    ...body,scopes:[{...body.scopes[0],
      materials:[{material_id:material.id,quantity_scaled:20000}]}],
  });
  assert.equal(written.approvals[0].scopes[0].materials[0].unit_version,1);
  assert.equal(written.approvals[0].scopes[0].materials[0].approved_quantity_scaled,20000);
});

test("finance resolves and prices exact adopted unit precision even after unit master changes", t => {
  const {s,user,project,scope,node,unit}=approvedFixture(t);
  expectPrecisionFailure(()=>s.finance.saveDraft(user,project.id,
    draft(project,scope,node,15000,20000)),"items.0.quantity_scaled");
  expectPrecisionFailure(()=>s.finance.saveDraft(user,project.id,
    draft(project,scope,node,20000,15000)),"resolutions.0.resolved_quantity_scaled");
  s.dictionaries.saveDictionary(user,"units",{expected_version:1,quantity_precision:2},unit.id);
  // Existing approved demand is pinned to integer unit version1, regardless of new version2.
  expectPrecisionFailure(()=>s.finance.saveDraft(user,project.id,
    draft(project,scope,node,2500,2500)),"resolutions.0.resolved_quantity_scaled");
  const statement=s.finance.saveDraft(user,project.id,
    draft(project,scope,node,100000,100000));
  assert.equal(statement.draft.document.resolutions[0].resolved_quantity_scaled,100000);
});

test("decimal units permit 0.25 work and reject unsupported 0.2501 in approval and settlement", t => {
  const {s,user,save,demandInput,unit}=fixture(t,{quantity_precision:2});
  const demand=s.demands.save(user,demandInput);
  s.demands.transition(user,demand.id,{
    expected_version:1,expected_event_seq:1,status:"active",
  });
  const framework=save("frameworks",{name:"面积精度框架",fiscal_year:2026,limit_fen:100000});
  let project=s.projects.save(user,{name:"面积工程",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  const scope=project.scopes[0];
  const originalLocations=demand.work_locations.map(loc=>({
    location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled,
  }));
  const input={
    expected_version:2,approved_budget_fen:50000,
    scopes:[{project_scope_id:scope.id,demand_version:1,
      locations:[{...originalLocations[0],approved_quantity_scaled:2501},...originalLocations.slice(1)]}],
  };
  assert.throws(()=>s.projects.approvalDraft(user,project.id,input),/2位小数/);
  project=s.projects.approvalDraft(user,project.id,{
    ...input,scopes:[{...input.scopes[0],locations:originalLocations}],
  });
  project=s.projects.approve(user,project.id,project.approvals[0].id,{expected_version:2});
  const node=s.finance.node(user,project.id,{name:"面积工程人工"});
  const body=draft(project,scope,node,2500,2500);
  assert.throws(()=>s.finance.saveDraft(user,project.id,{
    ...body,items:[{...body.items[0],quantity_scaled:2501}],
  }),/2位小数/);
  const settlement=s.finance.saveDraft(user,project.id,body);
  assert.equal(settlement.draft.document.resolutions[0].resolved_quantity_scaled,2500);
  assert.equal(unit.quantity_precision,2);
});
