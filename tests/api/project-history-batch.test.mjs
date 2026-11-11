import { test } from "node:test";
import assert from "node:assert/strict";
import { projectHistoryRepository } from "../../dist/server/database/repositories/project-history.js";
import { approvedFixture } from "../helpers.mjs";

test("project history groups approvals, costs, settlement installments and cost nodes in fixed SQL reads", t => {
  const {s,user,project,scope,node}=approvedFixture(t);
  for(let i=0;i<12;i++) {
    s.finance.cost(user,project.id,{
      cost_node_id:node.id,
      title:"历史成本条目"+i,
      amount_fen:1000+i,
      occurred_on:"2026-11-11",
      evidence:"施工费用凭证"+i,
    });
  }
  for(let i=0;i<4;i++) {
    let statement=s.finance.saveDraft(user,project.id,{
      approval_version_id:project.approval.id,
      number:"HISTORY-INSTALLMENT-"+i,
      items:[{
        cost_node_id:node.id,project_scope_id:scope.id,
        amount_fen:6000,quantity_scaled:10000,evidence:"第"+i+"批",
      }],
      resolutions:[{project_scope_id:scope.id,
        resolved_quantity_scaled:10000,evidence:"第"+i+"批工程量"}],
    });
    statement=s.finance.submit(user,statement.id,{
      expected_version:0,expected_edit_version:1,
    });
    s.finance.review(user,statement.id,{
      expected_version:1,expected_event_seq:1,action:"approve",
    });
  }
  const result=s.projects.history(project.id);
  assert.equal(result.costs.length,12);
  assert.equal(result.settlements.length,4);
  assert.equal(result.settlements.flatMap(entry=>entry.versions).length,4);
  assert.equal(result.settlements[0].versions[0].items.length,1);
  assert.equal(result.settlements[0].versions[0].resolutions.length,1);
  assert.equal(result.settlements[0].versions[0].events.length,2);
  assert.equal(result.approvals.length,1);
  assert.deepEqual(s.repo.integrity().foreignKeys,[]);
});
test("history SQL query count never grows with project record count", () => {
  const calls=[];
  const db={
    query(sql,...args) {
      calls.push({sql,args});
      if(sql.includes("FROM project_approval_versions WHERE"))return Array.from({length:200},(_,i)=>({id:"ap-"+i,project_id:"p"}));
      if(sql.includes("FROM cost_entries WHERE"))return Array.from({length:500},(_,i)=>({id:"cost-"+i,project_id:"p"}));
      if(sql.includes("FROM settlements WHERE"))return Array.from({length:90},(_,i)=>({id:"bill-"+i,project_id:"p"}));
      if(sql.includes("FROM project_cost_nodes WHERE"))return Array.from({length:350},(_,i)=>({id:"node-"+i,project_id:"p"}));
      return [];
    },
  };
  const result=projectHistoryRepository(db).projectFullHistory("p");
  assert.equal(result.approvals.length,200);
  assert.equal(result.costs.length,500);
  assert.equal(result.settlements.length,90);
  assert.equal(result.cost_nodes.length,350);
  assert.equal(calls.length,15,"project history must use 15 fixed collection reads, not per-record SQL");
  assert.ok(calls.every(call=>call.args.every(arg=>arg==="p")),"SQL restricted to the requested project");
});
