import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, approvedFixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";

let towerSequence=0;
function addDemand(s,user,save,operation,expected_on=null) {
  const tower=save("physical",{tower_code:"RESOLVE-DATE-"+(++towerSequence)});
  const result=s.demands.save(user,{
    operation_id:operation.id,
    problem_description:"预计解决时间规则验证（独立位置）",
    expected_on,
    work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}],
    sources:[{description:"隔离测试来源"}],
  });
  s.demands.transition(user,result.id,{
    expected_version:1,expected_event_seq:1,status:"active",
  });
  return s.demands.get(result.id);
}
test("expected_on remains nullable before approval; all linked demands must be complete, not only selected scopes",t=>{
  const {s,user,save,operation,demandInput}=fixture(t);
  const first=s.demands.save(user,demandInput);
  s.demands.transition(user,first.id,{expected_version:1,expected_event_seq:1,status:"active"});
  const unselected=addDemand(s,user,save,operation);
  assert.equal(unselected.expected_on,null);
  const framework=save("frameworks",{name:"预计解决时间验收框架",fiscal_year:2026,limit_fen:1000000});
  let project=s.projects.save(user,{name:"所有关联需求必填验收",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:first.id,expected_version:1});
  project=s.projects.link(user,project.id,{demand_id:unselected.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  project=s.projects.approvalDraft(user,project.id,{
    expected_version:2,approved_budget_fen:120000,
    scopes:[{project_scope_id:project.scopes.find(x=>x.demand_id===first.id).id,demand_version:1,
      locations:first.work_locations.map(loc=>({location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled}))}],
  });
  const draft=project.approvals[0];
  assert.equal(draft.status,"draft","unfinished planning must not block composing an approval draft");
  assert.throws(()=>s.projects.approve(user,project.id,draft.id,{expected_version:2}),
    e=>e.status===422 && /预计解决时间/.test(e.message) && e.message.includes(unselected.demand_no));
  assert.equal(s.projects.get(project.id).status,"stocked");
  assert.equal(inspect(s).find("project_approval_versions","id",draft.id).status,"draft");
  assert.throws(()=>inspect(s).update("project_approval_versions","id",draft.id,{
    status:"approved",approved_by:user.id,approved_at:new Date().toISOString(),
  }),/预计解决时间/,"SQLite must enforce approval from all currently bound demands");
  assert.equal(inspect(s).find("project_approval_versions","id",draft.id).status,"draft");
  const corrected=s.demands.save(user,{
    expected_version:1,expected_on:"2027-04-30",
  },unselected.id);
  assert.equal(corrected.current_version,2);
  const approved=s.projects.approve(user,project.id,draft.id,{expected_version:2});
  assert.equal(approved.status,"approved");
  assert.equal(approved.scopes.filter(x=>x.binding).length,2);
  assert.equal(approved.approvals.filter(a=>a.status==="approved").length,1);
  assert.equal(inspect(s).integrity().foreignKeys.length,0);
});

test("selected demand date change after draft requires a new snapshot, including NULL-to-date changes",t=>{
  const {s,user,save,operation}=fixture(t);
  const planned=addDemand(s,user,save,operation,null);
  const framework=save("frameworks",{name:"草稿日期一致性框架",fiscal_year:2026,limit_fen:500000});
  let project=s.projects.save(user,{name:"草稿日期一致性项目",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:planned.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  const scope=project.scopes.find(row=>row.binding);
  const input={expected_version:2,approved_budget_fen:20000,scopes:[{
    project_scope_id:scope.id,demand_version:1,
    locations:[{location_item_no:1,approved_quantity_scaled:10000}],
  }]};
  project=s.projects.approvalDraft(user,project.id,input);
  const oldDraft=project.approvals.find(ap=>ap.status==="draft");
  assert.ok(oldDraft);
  assert.equal(oldDraft.scopes[0].demand_version,1);
  assert.equal(JSON.parse(inspect(s).find("project_approval_scope_versions","id",oldDraft.scopes[0].id).snapshot_json).expected_on,null);
  const dated=s.demands.save(user,{expected_version:1,expected_on:"2027-07-31",
    reason:"落实预计解决时间"},planned.id);
  assert.equal(dated.current_version,2);
  assert.throws(()=>s.projects.approve(user,project.id,oldDraft.id,{expected_version:2}),
    e=>e.status===409 && /重新编制草稿/.test(e.message));
  assert.throws(()=>inspect(s).update("project_approval_versions","id",oldDraft.id,{
    status:"approved",approved_by:user.id,approved_at:new Date().toISOString(),
  }),/需求正式版本已变化/);
  assert.equal(inspect(s).find("project_approval_versions","id",oldDraft.id).status,"draft");
  project=s.projects.discardApproval(user,project.id,oldDraft.id);
  project=s.projects.approvalDraft(user,project.id,{...input,scopes:[{
    ...input.scopes[0],demand_version:2,
  }]});
  const refreshed=project.approvals.find(ap=>ap.status==="draft");
  const adopted=JSON.parse(inspect(s).find("project_approval_scope_versions","id",refreshed.scopes[0].id).snapshot_json);
  assert.equal(adopted.expected_on,"2027-07-31");
  const approved=s.projects.approve(user,project.id,refreshed.id,{expected_version:2});
  assert.equal(approved.status,"approved");
  assert.equal(inspect(s).integrity().foreignKeys.length,0);
});

test("an already dated selected demand moving to a later date invalidates an open draft only",t=>{
  const {s,user,save,operation}=fixture(t);
  const demand=addDemand(s,user,save,operation,"2027-07-31");
  const framework=save("frameworks",{name:"日期变更项目框架",fiscal_year:2026,limit_fen:500000});
  let project=s.projects.save(user,{name:"日期变更项目",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  project=s.projects.stock(user,project.id,{expected_version:1});
  project=s.projects.approvalDraft(user,project.id,{
    expected_version:2,approved_budget_fen:20000,scopes:[{
      project_scope_id:project.scopes[0].id,demand_version:1,
      locations:[{location_item_no:1,approved_quantity_scaled:10000}],
    }],
  });
  const oldDraft=project.approvals[0];
  s.demands.save(user,{expected_version:1,expected_on:"2027-08-31",reason:"计划延期"},demand.id);
  assert.throws(()=>s.projects.approve(user,project.id,oldDraft.id,{expected_version:2}),
    e=>e.status===409 && /重新编制草稿/.test(e.message));
  assert.equal(inspect(s).find("project_approval_versions","id",oldDraft.id).status,"draft");
});

test("a formal change cannot approve a stale selected-demand date or prematurely approve its change order",t=>{
  const {s,user,project,demand,scope,approval}=approvedFixture(t);
  const priorApproval=project.approval.id;
  let changed=s.projects.approvalDraft(user,project.id,{
    expected_version:project.version,expected_approval_version_id:priorApproval,
    approved_budget_fen:project.approval.approved_budget_fen+1000,
    confirm_changes:true,reason:"原批准预算调整",
    scopes:[{project_scope_id:scope.id,demand_version:1,
      locations:demand.work_locations.map(loc=>({
        location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled,
      }))}],
  });
  const pending=changed.approvals.find(row=>row.status==="draft");
  assert.ok(pending?.change_order_id);
  const amended=s.demands.save(user,{expected_version:1,expected_on:"2027-09-30",
    reason:"原停电计划发生调整"},demand.id);
  assert.equal(amended.current_version,2);
  assert.throws(()=>s.projects.approve(user,project.id,pending.id,{
    expected_version:changed.version,
  }),e=>e.status===409 && /重新编制草稿/.test(e.message));
  assert.equal(s.projects.get(project.id).approval.id,priorApproval);
  assert.equal(inspect(s).find("project_approval_versions","id",pending.id).status,"draft");
  assert.notEqual(inspect(s).find("project_change_orders","id",pending.change_order_id).status,
    "approved","failed change must not commit a formal decision");
});

test("approved bound demand date may be revised but never cleared, history and approved scope remain immutable",t=>{
  const {s,user,project,demand}=approvedFixture(t);
  const originalApproval=project.approval.id;
  assert.equal(demand.expected_on,"2026-12-31");
  assert.throws(()=>s.demands.save(user,{expected_version:1,expected_on:null},demand.id),
    e=>e.status===422 && /预计解决时间/.test(e.message));
  const edited=s.demands.save(user,{expected_version:1,expected_on:"2027-05-15",reason:"停电计划调整"},demand.id);
  assert.equal(edited.current_version,2);
  assert.equal(edited.expected_on,"2027-05-15");
  assert.equal(s.projects.get(project.id).approval.id,originalApproval);
  const old=inspect(s).get("SELECT expected_on FROM demand_versions WHERE demand_id=? AND version=1",demand.id);
  assert.equal(old.expected_on,"2026-12-31");
  const accepted=inspect(s).get("SELECT expected_on FROM demand_versions WHERE demand_id=? AND version=2",demand.id);
  assert.equal(accepted.expected_on,"2027-05-15");
  assert.throws(()=>inspect(s).insert("demand_revisions",{
    id:"malicious-date-removal",demand_id:demand.id,version:3,
    snapshot_json:JSON.stringify({expected_on:null}),reason:"direct-bypass",
    changed_by:user.id,changed_at:new Date().toISOString(),
  }),/预计解决时间/,"direct SQLite revision must not clear approved demand plan");
  assert.equal(s.demands.get(demand.id).current_version,2);
  assert.equal(inspect(s).integrity().foreignKeys.length,0);
});

test("approved project cannot acquire an undated demand through the old single-link path",t=>{
  const {s,user,save,operation,project}=approvedFixture(t);
  const missing=addDemand(s,user,save,operation);
  assert.throws(()=>s.projects.link(user,project.id,{
    demand_id:missing.id,expected_version:1,
  }),/正式变更/);
  assert.equal(s.demands.get(missing.id).binding,null);
  assert.equal(s.projects.get(project.id).scopes.filter(x=>x.binding).length,1);
});

test("closed project releases unfinished demand for formal revision without changing signed history",t=>{
  const {s,user,project,demand}=approvedFixture(t);
  s.projectClosure.commit(user,project.id,{preview_hash: s.projectClosure.preview(user, project.id).preview_hash, expected_version:project.version});
  assert.equal(s.demands.get(demand.id).binding,null);
  const amended=s.demands.save(user,{
    expected_version:1,expected_on:"2027-02-25",reason:"结项后重新核定剩余需求计划",
  },demand.id);
  assert.equal(amended.current_version,2);
  assert.equal(amended.expected_on,"2027-02-25");
  assert.equal(s.projects.get(project.id).approvals[0].scopes[0].demand_version,1);
});
