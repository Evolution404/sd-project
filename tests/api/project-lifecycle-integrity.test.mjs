import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fixture,approvedFixture} from "../helpers.mjs";
import {inspect} from "../inspector.mjs";
import {projectActionHints} from "../../dist/server/modules/projects/actions.js";
import {httpServer} from "../../dist/server/platform/http/server.js";
function scopeInput(f) {
  return {project_scope_id:f.scope.id,demand_version:f.demand.current_version,
    locations:f.demand.work_locations.map(loc=>({location_item_no:loc.item_no,approved_quantity_scaled:loc.quantity_scaled}))};
}
function candidate(f,name="候选需求") {
  const tower=f.save("physical",{asset_no:randomUUID()});
  const d=f.s.demands.save(f.user,{operation_id:f.operation.id,problem_description:name,expected_on:"2027-01-31",
    work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}],sources:[{description:"隔离回归"}]});
  f.s.demands.transition(f.user,d.id,{expected_version:1,expected_event_seq:1,status:"active"});
  return {demand_id:d.id,demand_version:1,locations:[{location_item_no:1,approved_quantity_scaled:10000}]};
}
function change(f,scopes) {
  return f.s.projects.approvalDraft(f.user,f.project.id,{expected_version:f.project.version,
    expected_approval_version_id:f.project.approval.id,approved_budget_fen:120001,confirm_changes:true,scopes});
}
async function transport(t,f) {
  const server=httpServer(f.s);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {token}=f.s.auth.login("admin","Schema113-test-password");
  return async(path,input)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{
    method:"POST",headers:{Cookie:"sd113="+token,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(input)});
    return {status:response.status,data:await response.json()};};
}
test("approved ordinary links and closed financial writes fail through HTTP with zero mutations",async t=>{
  const f=approvedFixture(t),post=await transport(t,f),newDemand=candidate(f);
  for(const [path,input] of [["link",{demand_id:newDemand.demand_id,expected_version:1}],
    ["link-batch",{links:[{demand_id:newDemand.demand_id,expected_version:1}]}]]){
    const result=await post(`/projects/${f.project.id}/${path}`,input);
    assert.equal(result.status,409);assert.match(result.data.message,/正式变更/);
  }
  assert.equal(f.s.demands.get(newDemand.demand_id).binding,null);
  f.s.projectClosure.commit(f.user,f.project.id,{preview_hash: f.s.projectClosure.preview(f.user, f.project.id).preview_hash, expected_version:f.project.version});
  const before=inspect(f.s).list("cost_versions").length;
  for(const [path,input] of [["nodes",{name:"不得创建的费用科目"}],
    ["costs",{cost_node_id:f.node.id,title:"不得确认的费用",amount_fen:12345,occurred_on:"2026-11-16",evidence:"回归"}]]){
    const result=await post(`/projects/${f.project.id}/${path}`,input);
    assert.equal(result.status,409);assert.match(result.data.message,/已结项/);
  }
  assert.equal(inspect(f.s).list("cost_versions").length,before);
  assert.throws(()=>inspect(f.s).insert("cost_entries",{id:randomUUID(),project_id:f.project.id,cost_node_id:f.node.id,created_by:f.user.id,created_at:new Date().toISOString()}),/已结项/);
});
test("reserve approval draft is rejected in service and SQL without changing six-state facts",t=>{
  const f=fixture(t),d=f.s.demands.save(f.user,f.demandInput);
  f.s.demands.transition(f.user,d.id,{expected_version:1,expected_event_seq:1,status:"active"});
  const fw=f.save("frameworks",{name:"阶段回归",fiscal_year:2026,limit_fen:1});
  let p=f.s.projects.save(f.user,{name:"储备项目",framework_id:fw.id});
  p=f.s.projects.link(f.user,p.id,{demand_id:d.id,expected_version:1});
  assert.throws(()=>f.s.projects.approvalDraft(f.user,p.id,{expected_version:1,approved_budget_fen:1,scopes:[]}),e=>e.status===409&&/入库/.test(e.message));
  assert.throws(()=>inspect(f.s).insert("project_approval_versions",{id:randomUUID(),project_id:p.id,version_no:1,approved_budget_fen:1,snapshot_json:"{}",created_at:new Date().toISOString()}),/入库/);
  assert.equal(f.s.projects.get(p.id).display_status,"储备");
});
test("a quantity revision after drafting blocks approval and preserves the original baseline",t=>{
  const f=approvedFixture(t);let p=change(f,[scopeInput(f)]);const draft=p.approvals.find(a=>a.status==="draft");
  f.s.demands.save(f.user,{...f.demandInput,expected_version:1,work_locations:f.demandInput.work_locations.map((loc,i)=>({...loc,quantity_scaled:loc.quantity_scaled+(i===0?10000:0)}))},f.demand.id);
  assert.throws(()=>f.s.projects.approve(f.user,p.id,draft.id,{expected_version:p.version}),e=>e.status===409&&/版本已变化/.test(e.message));
  assert.equal(f.s.projects.get(p.id).approval.id,f.approval.id);
  assert.equal(inspect(f.s).find("project_change_orders","id",draft.change_order_id).status,"draft");
});
test("change candidates do not reserve ownership, withdrawal is clean, approval adds and releases atomically",t=>{
  const f=approvedFixture(t),addition=candidate(f);
  let p=change(f,[addition]);let draft=p.approvals.find(a=>a.status==="draft");
  assert.equal(draft.pending_scopes.length,1);assert.equal(f.s.demands.get(addition.demand_id).binding,null);
  assert.equal(p.approval.id,f.approval.id);
  p=f.s.projects.discardApproval(f.user,p.id,draft.id);
  assert.equal(f.s.demands.get(addition.demand_id).binding,null);
  p=change(f,[addition]);draft=p.approvals.find(a=>a.status==="draft");
  p=f.s.projects.approve(f.user,p.id,draft.id,{expected_version:p.version});
  assert.equal(f.s.demands.get(addition.demand_id).binding.project_id,p.id);
  assert.equal(f.s.demands.get(f.demand.id).binding,null);
  assert.equal(p.approvals.find(a=>a.id===f.approval.id).scopes.length,1);
  assert.equal(p.approvals.find(a=>a.id===draft.id).scopes.length,1);
  assert.deepEqual(inspect(f.s).integrity().foreignKeys,[]);
});
test("competing projects may propose the same candidate but only one approval obtains ownership",t=>{
  const f=approvedFixture(t),addition=candidate(f);
  let first=change(f,[scopeInput(f),addition]);const firstDraft=first.approvals.find(a=>a.status==="draft");
  let second=f.s.projects.save(f.user,{name:"并发承接者",framework_id:f.framework.id});
  second=f.s.projects.link(f.user,second.id,{demand_id:addition.demand_id,expected_version:1});
  assert.throws(()=>f.s.projects.approve(f.user,first.id,firstDraft.id,{expected_version:first.version}),e=>e.status===409);
  first=f.s.projects.get(first.id);
  assert.equal(first.approval.id,f.approval.id);
  assert.equal(f.s.demands.get(f.demand.id).binding.project_id,first.id);
  assert.equal(f.s.demands.get(addition.demand_id).binding.project_id,second.id);
  assert.equal(inspect(f.s).find("project_change_orders","id",firstDraft.change_order_id).status,"draft");
});
test("unsubmitted revision of an approved settlement blocks closure in service and database",t=>{
  const f=approvedFixture(t),input={approval_version_id:f.approval.id,items:[{cost_node_id:f.node.id,project_scope_id:f.scope.id,amount_fen:10000,quantity_scaled:10000,evidence:"回归"}],resolutions:[{project_scope_id:f.scope.id,resolved_quantity_scaled:0,evidence:"仅财务"}]};
  let bill=f.s.finance.saveDraft(f.user,f.project.id,input);
  bill=f.s.finance.submit(f.user,bill.id,{expected_version:0,expected_edit_version:1});
  bill=f.s.finance.review(f.user,bill.id,{expected_version:1,expected_event_seq:1,action:"approve"});
  f.s.finance.saveDraft(f.user,f.project.id,{...input,expected_version:1,expected_edit_version:0},bill.id);
  assert.throws(()=>f.s.projectClosure.commit(f.user,f.project.id,{preview_hash: f.s.projectClosure.preview(f.user, f.project.id).preview_hash, expected_version:f.project.version}),e=>e.status===409&&/修订草稿/.test(e.message));
  assert.equal(f.s.projects.get(f.project.id).status,"approved");
  const action=projectActionHints(f.user,f.s.projects.get(f.project.id),f.s.projectClosure.blockReason(f.project.id)).find(item=>item.key==="close");
  assert.equal(action.enabled,false);
  assert.match(action.reason,/修订草稿/);
  assert.equal(inspect(f.s).list("project_closures").length,0);
  const db=inspect(f.s);
  assert.throws(()=>db.transaction(()=>{
    db.insert("project_closures",{id:randomUUID(),project_id:f.project.id,
      approval_version_id:f.approval.id,close_snapshot_json:JSON.stringify(f.s.finance.summary(f.project.id)),closed_by:f.user.id,closed_at:new Date().toISOString()});
    db.insert("project_stage_events",{id:randomUUID(),project_id:f.project.id,
      stage:"closed",project_version:f.project.version+1,actor_id:f.user.id,created_at:new Date().toISOString()});
  }),/修订草稿/);
  assert.equal(db.list("project_closures").length,0);
  f.s.finance.discardDraft(f.user,bill.id,{expected_version:1,expected_edit_version:1});
  assert.equal(f.s.projectClosure.commit(f.user,f.project.id,{preview_hash: f.s.projectClosure.preview(f.user, f.project.id).preview_hash, expected_version:f.project.version}).status,"closed");
});

test("unpriced change candidates keep every reference-price summary incomplete",t=>{
  const f=approvedFixture(t),addition=candidate(f);
  const p=change(f,[scopeInput(f),addition]);
  const draft=p.approvals.find(ap=>ap.status==="draft");
  f.s.pricing.quote(f.user,f.demand.id,{expected_version:1,
    approval_scope_version_id:draft.scopes[0].id,confirm:true});
  for(const summary of [f.s.pricing.summary(draft.id),
    f.s.projects.get(p.id).approvals.find(ap=>ap.id===draft.id).reference,
    f.s.projects.workspace(p.id).approvals.find(ap=>ap.id===draft.id).reference]){
    assert.equal(summary.complete,false);
    assert.equal(summary.total_fen,null);
    assert.ok(summary.subtotal_fen>0);
    assert.ok(summary.missing.some(row=>row.demand_id===addition.demand_id));
  }
});
