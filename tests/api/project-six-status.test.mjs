import {test} from "node:test";
import assert from "node:assert/strict";
import {approvedFixture} from "../helpers.mjs";
import {projectDisplayStatus} from "../../dist/server/shared/project-display-status.js";

function query(status="") {
  return {page:1,page_size:30,q:"",deleted:false,sort:"created_at",direction:"desc",
    filters:status?{display_status:status}:{}};
}
function checkList(s, name, status) {
  const rows=s.projects.search(query(status));
  assert.ok(rows.items.some(row=>row.name===name), name+" missing from "+status);
  for(const row of rows.items) assert.equal(row.display_status,status);
}
function approvedScopeInput(project,demand,budget=120001) {
  return {
    expected_version:project.version,
    expected_approval_version_id:project.approval.id,
    approved_budget_fen:budget,confirm_changes:true,
    scopes:[{project_scope_id:project.scopes[0].id,demand_version:demand.current_version,
      locations:demand.work_locations.map(location=>({
        location_item_no:location.item_no,approved_quantity_scaled:location.quantity_scaled,
      }))}],
  };
}
test("six visible project states follow real draft lifecycle without a second stored project stage",t=>{
  const {s,user,save,framework,project:approved,demand,approval,demandInput}=approvedFixture(t);
  const reserved=s.projects.save(user,{name:"状态：储备",framework_id:framework.id});
  assert.equal(reserved.display_status,"储备");
  checkList(s,"状态：储备","储备");
  let toStock=s.projects.save(user,{name:"状态：立项",framework_id:framework.id});
  toStock=s.projects.stock(user,toStock.id,{expected_version:toStock.version});
  assert.equal(toStock.status,"stocked");
  assert.equal(toStock.display_status,"已入库");
  checkList(s,"状态：立项","已入库");

  const tower=save("physical",{asset_no:"SIX-STATE-100",tower_material:"angle"});
  const secondDemand=s.demands.save(user,{
    ...demandInput,problem_description:"六态回归新增作业",
    work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}],
  });
  s.demands.transition(user,secondDemand.id,{
    expected_version:secondDemand.current_version,expected_event_seq:1,status:"active",
  });
  toStock=s.projects.link(user,toStock.id,{demand_id:secondDemand.id,expected_version:secondDemand.current_version});
  const initialInput={
    expected_version:toStock.version,approved_budget_fen:110000,
    scopes:[{project_scope_id:toStock.scopes[0].id,demand_version:secondDemand.current_version,
      locations:[{location_item_no:1,approved_quantity_scaled:10000}]}],
  };
  toStock=s.projects.approvalDraft(user,toStock.id,initialInput);
  assert.equal(toStock.status,"stocked");
  assert.equal(toStock.display_status,"立项中");
  checkList(s,"状态：立项","立项中");
  assert.equal(s.projects.search(query("已入库")).items.some(row=>row.id===toStock.id),false);
  let draft=toStock.approvals.find(item=>item.status==="draft");
  toStock=s.projects.discardApproval(user,toStock.id,draft.id);
  assert.equal(toStock.display_status,"已入库","withdrawal restores stocked view");
  toStock=s.projects.approvalDraft(user,toStock.id,initialInput);
  draft=toStock.approvals.find(item=>item.status==="draft");
  toStock=s.projects.approve(user,toStock.id,draft.id,{expected_version:toStock.version});
  assert.equal(toStock.status,"approved");
  assert.equal(toStock.display_status,"已批准");
  checkList(s,"状态：立项","已批准");

  assert.equal(approved.display_status,"已批准");
  let change=s.projects.approvalDraft(user,approved.id,approvedScopeInput(approved,demand));
  const changeDraft=change.approvals.find(item=>item.status==="draft");
  assert.equal(change.status,"approved","draft must not mutate formal project stage");
  assert.equal(change.display_status,"变更中");
  assert.equal(change.approval.id,approval.id,"prior formally approved version remains active");
  assert.equal(change.approval.approved_budget_fen,approval.approved_budget_fen);
  checkList(s,approved.name,"变更中");
  assert.equal(s.projects.search(query("已批准")).items.some(row=>row.id===approved.id),false);
  assert.equal(s.projects.get(approved.id).display_status,"变更中");
  assert.equal(s.projects.workspace(approved.id).display_status,"变更中");
  const frameworkProjects=s.funding.details("frameworks",framework.id).projects;
  assert.equal(frameworkProjects.find(row=>row.id===approved.id).display_status,"变更中");
  assert.equal(frameworkProjects.find(row=>row.id===approved.id).approved_budget_fen,
    approval.approved_budget_fen,"funding must preserve the last formal approval, not draft budget");
  change=s.projects.discardApproval(user,approved.id,changeDraft.id);
  assert.equal(change.display_status,"已批准","withdrawal restores approved view");
  change=s.projects.approvalDraft(user,approved.id,approvedScopeInput(change,demand));
  const nextDraft=change.approvals.find(item=>item.status==="draft");
  change=s.projects.approve(user,approved.id,nextDraft.id,{expected_version:change.version});
  assert.equal(change.display_status,"已批准","formal change approval restores approved view");
  assert.equal(change.approval.version_no,2);
  change=s.finance.close(user,change.id,{expected_version:change.version});
  assert.equal(change.status,"closed");
  assert.equal(s.projects.get(change.id).display_status,"已结项");
  checkList(s,approved.name,"已结项");

  assert.equal(projectDisplayStatus("approved",[{status:"approved"},{status:"draft"}]),"变更中");
  assert.equal(projectDisplayStatus("closed",[{status:"draft"}]),"已结项");
  assert.ok(s.projects.search(query()).items.every(row=>!Object.hasOwn(row,"handling_view")));
});
