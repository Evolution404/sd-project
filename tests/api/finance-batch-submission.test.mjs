import {test} from "node:test";
import assert from "node:assert/strict";
import {approvedFixture} from "../helpers.mjs";

test("64-row settlement submission uses one identity query, one approval query and fixed cost-node reads",t=>{
  const {s,user,project,scope,approval}=approvedFixture(t);
  const nodes=Array.from({length:64},(_,index)=>
    s.finance.node(user,project.id,{name:"验收计价科目"+index}));
  const draft=s.finance.saveDraft(user,project.id,{
    approval_version_id:approval.id,
    items:nodes.map(node=>({
      cost_node_id:node.id,project_scope_id:scope.id,
      quantity_scaled:10000,amount_fen:1,evidence:"第1期费用凭证",
    })),
    resolutions:[{project_scope_id:scope.id,resolved_quantity_scaled:640000,
      evidence:"64项独立计价的工程量核实"}],
  });
  const seen={identities:0,scopes:0,nodes:0};
  for (const [method,counter] of [["settlementItems","identities"],
    ["approvalScopes","scopes"],["projectCostNodes","nodes"]]) {
    const original=s.repo[method];
    s.repo[method]=(...args)=>{seen[counter]++;return original(...args)};
    t.after(()=>{s.repo[method]=original});
  }
  const written=s.finance.submit(user,draft.id,{
    expected_version:0,expected_edit_version:1,
  });
  assert.equal(written.items.length,64);
  assert.equal(written.resolutions.length,1);
  assert.deepEqual(seen,{identities:1,scopes:1,nodes:2});
  const history=s.finance.history(written.id);
  assert.equal(history[0].items.length,64);
  assert.equal(s.repo.integrity().foreignKeys.length,0);
});
