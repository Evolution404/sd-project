import {test} from "node:test";
import assert from "node:assert/strict";
import {approvedFixture} from "../helpers.mjs";
import {inspect} from "../inspector.mjs";

test("all four roles cooperate on real costs and settlements without permission escalation", t => {
  const {s,user:admin,project,approval,scope,node}=approvedFixture(t);
  const accounts={admin};
  for(const role of ["editor","verifier","viewer"]) {
    s.auth.saveUser(admin,{username:"finance-"+role,password:"Finance-Role-Test-"+role,
      role,status:"active"});
    accounts[role]=s.auth.login("finance-"+role,"Finance-Role-Test-"+role).user;
  }
  const {editor,verifier,viewer}=accounts;
  assert.equal(editor.permissions.includes("write"),true);
  assert.equal(editor.permissions.includes("settlement.approve"),false);
  assert.equal(editor.permissions.includes("cost.confirm"),false);
  assert.equal(verifier.permissions.includes("write"),false);
  assert.equal(verifier.permissions.includes("settlement.approve"),true);
  assert.equal(verifier.permissions.includes("cost.confirm"),true);
  assert.deepEqual(viewer.permissions,["read"]);

  const makeCost={
    cost_node_id:node.id,title:"第1笔实际费用",amount_fen:14500,
    occurred_on:"2026-11-11",evidence:"现场费用核定依据",
  };
  assert.throws(()=>s.finance.cost(editor,project.id,makeCost),/权限/);
  assert.throws(()=>s.finance.cost(viewer,project.id,makeCost),/权限/);
  assert.equal(s.finance.costs(project.id).length,0,"unauthorized requests must not leave partial costs");
  const cost=s.finance.cost(verifier,project.id,makeCost);
  assert.equal(s.finance.costs(project.id).length,1);
  assert.equal(cost.confirmed_by,verifier.id);

  const draftInput={
    approval_version_id:approval.id,
    items:[{cost_node_id:node.id,project_scope_id:scope.id,
      quantity_scaled:10000,amount_fen:12500,evidence:"完整结算凭证"}],
    resolutions:[{project_scope_id:scope.id, location_item_no: 1,resolved_quantity_scaled:10000,
      evidence:"本次施工验收核实"}],
  };
  assert.throws(()=>s.finance.saveDraft(verifier,project.id,draftInput),/权限/);
  assert.throws(()=>s.finance.saveDraft(viewer,project.id,draftInput),/权限/);
  assert.equal(s.finance.settlements(project.id).length,0,"unauthorized drafts must not be created");

  const draft=s.finance.saveDraft(editor,project.id,draftInput);
  assert.ok(draft.draft);
  assert.equal(draft.version,null);
  assert.throws(()=>s.finance.submit(viewer,draft.id,{
    expected_version:0,expected_edit_version:1}),/权限/);
  assert.throws(()=>s.finance.submit(verifier,draft.id,{
    expected_version:0,expected_edit_version:1}),/权限/);
  assert.equal(s.finance.settlement(draft.id).version,null);
  const submitted=s.finance.submit(editor,draft.id,{
    expected_version:0,expected_edit_version:1});
  assert.equal(submitted.version.version_no,1);
  assert.equal(submitted.review.action,"submit");
  const review={expected_version:1,expected_event_seq:1,action:"approve"};
  assert.throws(()=>s.finance.review(editor,draft.id,review),/权限/);
  assert.throws(()=>s.finance.review(viewer,draft.id,review),/权限/);
  assert.equal(s.finance.settlement(draft.id).review.action,"submit",
    "unauthorized reviews must not mutate formal ledger");
  const approved=s.finance.review(verifier,draft.id,review);
  assert.equal(approved.review.action,"approve");
  assert.equal(approved.review.actor_id,verifier.id);
  assert.equal(s.finance.summary(project.id).settlement_fen,12500);
  assert.equal(s.finance.summary(project.id).actual_cost_fen,14500);

  assert.throws(()=>s.projectClosure.commit(editor,project.id,{preview_hash: "", expected_version:3}),/权限/);
  assert.throws(()=>s.projectClosure.commit(viewer,project.id,{preview_hash: "", expected_version:3}),/权限/);
  assert.equal(s.projects.get(project.id).status,"approved");
  assert.equal(inspect(s).integrity().foreignKeys.length,0);
});
