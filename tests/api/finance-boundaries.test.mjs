import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";

test("settled amounts, independently reported work, over-completion and reconciliation revisions remain distinct", (t) => {
  const { s, user, project, scope, approval, node, framework } = approvedFixture(t);
  const cost = s.finance.cost(user, project.id, {
    cost_node_id: node.id,
    title: "真实超预算费用",
    occurred_on: "2026-11-08",
    amount_fen: 140000,
    evidence: "真实发票",
  });
  function bill(number, amount, resolved) {
    let row = s.finance.saveDraft(user, project.id, {
      number,
      approval_version_id: approval.id,
      items: [
        {
          cost_node_id: node.id,
          project_scope_id: scope.id,
          quantity_scaled: 10000,
          amount_fen: amount,
          evidence: "本期真实依据",
        },
      ],
      resolutions: [
        {
          project_scope_id: scope.id,
          resolved_quantity_scaled: resolved,
          evidence: "本期现场复核",
        },
      ],
    });
    row = s.finance.submit(user, row.id, {
      expected_version: 0,
      expected_edit_version: 1,
    });
    return s.finance.review(user, row.id, {
      expected_version: 1,
      expected_event_seq: 1,
      action: "approve",
    });
  }
  const fee = bill("FEE-ONLY", 40000, 0);
  assert.equal(s.finance.summary(project.id).settlement_fen, 40000);
  assert.equal(
    s.finance.summary(project.id).demands[0].resolved_quantity_scaled,
    0,
  );
  const feeHistory = s.finance.history(fee.id);
  assert.equal(feeHistory.length, 1);
  assert.equal(feeHistory[0].items[0].id, fee.items[0].id);
  assert.equal(feeHistory[0].resolutions[0].resolved_quantity_scaled, 0);
  assert.deepEqual(feeHistory[0].events.map(event => event.action), ["submit", "approve"]);
  const work = bill("WORK-ZERO-AMOUNT", 0, 110000);
  assert.equal(work.items[0].amount_fen, 0);
  const summary = s.finance.summary(project.id);
  assert.equal(summary.actual_cost_fen, 140000);
  assert.equal(summary.settlement_fen, 40000);
  const agreement = s.catalog.save(user,"agreements",{name:"资金统计协议",framework_id:framework.id,limit_fen:1});
  const direct = s.funding.details("frameworks",framework.id);
  assert.equal(direct.summary.project_count,1);
  assert.equal(direct.summary.approved_budget_fen,120000);
  assert.equal(direct.summary.actual_cost_fen,140000);
  assert.equal(direct.summary.settlement_fen,40000);
  assert.equal(s.funding.details("agreements",agreement.id).summary.project_count,0);
  s.projects.save(user,{name:project.name,framework_id:framework.id,agreement_id:agreement.id,
    expected_version:project.profile_version,expected_funding_version:0},project.id);
  const linked = s.funding.details("agreements",agreement.id);
  assert.equal(linked.summary.project_count,1);
  assert.equal(linked.summary.approved_budget_fen,120000);
  assert.equal(linked.summary.actual_cost_fen,140000);
  assert.equal(linked.summary.settlement_fen,40000);
  assert.deepEqual(s.funding.details("frameworks",framework.id).summary,direct.summary,
    "assigning an agreement must preserve all framework totals without double counting");
  assert.equal(summary.demands[0].resolved_quantity_scaled, 110000);
  assert.equal(summary.demands[0].excess_quantity_scaled, 20000);
  let record = s.finance.reconciliation(user, {
    expected_version: 0,
    cost_version_id: cost.id,
    settlement_item_version_id: fee.items[0].id,
    reconciled_cost_fen: 30000,
    reconciled_settlement_fen: 40000,
    is_final: true,
    evidence: "正式核对差异",
  });
  assert.equal(s.finance.summary(project.id).reconciled_cost_fen, 30000);
  record = s.finance.reconciliation(user, {
    ...record,
    request_key: undefined,
    expected_version: 1,
    reconciled_cost_fen: 20000,
    evidence: "正式更正核对",
  });
  assert.equal(s.finance.summary(project.id).reconciled_cost_fen, 20000);
  s.finance.removeReconciliation(user, record.record_id, {
    expected_version: 2,
  });
  assert.equal(s.finance.summary(project.id).reconciled_cost_fen, 0);
  assert.equal(s.finance.reconciliationHistory(record.record_id).length, 3);
  assert.throws(() => s.finance.removeReconciliation(user, record.record_id,
    { expected_version: 3 }), /核对记录已删除/);
  assert.equal(inspect(s).auditFor("reconciliations", record.record_id)
    .filter((item) => item.action === "delete").length, 1);
  assert.equal(s.finance.reconciliations(project.id).length, 0);
  assert.equal(s.finance.reconciliations(project.id, true)[0].deleted, true);
  assert.throws(
    () =>
      inspect(s).update("settlement_item_versions", "id", fee.items[0].id, {
        amount_fen: 1,
      }),
    /不可|禁止/,
  );
  assert.equal(
    s.finance.close(user, project.id, { expected_version: 3 }).status,
    "closed",
  );
  const closed = s.projects.get(project.id);
  s.projects.remove(user, project.id, { expected_version: closed.version });
  assert.equal(s.demands.get(scope.demand_id).binding.project_id, project.id);
  assert.throws(() => s.projects.release(user, project.id, scope.id, { expected_event_seq: 1 }), /已结项.*正式批准范围/);
  assert.equal(s.demands.get(scope.demand_id).binding.project_id, project.id);
  const history = s.projects.history(project.id);
  assert.equal(history.costs.length, 1);
  assert.equal(history.settlements.length, 2);
});

test("nested cost history rejects a cost belonging to a different project", t => {
  const { s, user, project, framework, node } = approvedFixture(t);
  const second = s.projects.save(user, {
    name: "不能窥视其他项目费用的子项目",
    framework_id: framework.id,
  });
  const cost = s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "本项目正式费用", amount_fen: 34567,
    occurred_on: "2026-11-11", evidence: "权限测试凭据",
  });
  assert.equal(s.finance.costHistory(project.id, cost.entry_id).length, 1);
  assert.throws(
    () => s.finance.costHistory(second.id, cost.entry_id),
    /费用不存在于当前项目/,
  );
  assert.throws(
    () => s.finance.costHistory(second.id, "does-not-exist"),
    /费用不存在于当前项目/,
  );
});

test("nested settlement and reconciliation histories enforce owning project for every version", t => {
  const { s, user, project, framework, scope, node, approval } = approvedFixture(t);
  const other = s.projects.save(user, {
    name: "另一项目不可借项目路由读取正式结算", framework_id: framework.id,
  });
  const cost = s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "分次正式费用", amount_fen: 8000,
    occurred_on: "2026-11-11", evidence: "实际费用依据",
  });
  let bill = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id,
      quantity_scaled: 10000, amount_fen: 5000, evidence: "结算依据" }],
    resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 10000, evidence: "核实" }],
  });
  bill = s.finance.submit(user, bill.id,
    { expected_version: 0, expected_edit_version: 1 });
  bill = s.finance.review(user, bill.id,
    { expected_version: 1, expected_event_seq: 1, action: "approve" });
  const reconciliation = s.finance.reconciliation(user, {
    expected_version: 0, cost_version_id: cost.id,
    settlement_item_version_id: bill.items[0].id,
    reconciled_cost_fen: 4000, reconciled_settlement_fen: 5000,
    is_final: true, evidence: "正式差异核对",
  });
  assert.equal(s.finance.settlementForProject(project.id, bill.id).id, bill.id);
  assert.equal(s.finance.reconciliationHistoryForProject(project.id,
    reconciliation.record_id).length, 1);
  assert.throws(
    () => s.finance.settlementForProject(other.id, bill.id),
    /结算单不存在于当前项目/,
  );
  assert.throws(
    () => s.finance.reconciliationHistoryForProject(other.id,
      reconciliation.record_id),
    /核对记录不存在于当前项目/,
  );
  assert.throws(
    () => s.finance.reconciliationHistoryForProject(other.id, "missing-id"),
    /核对记录不存在/,
  );
  // A valid cost and a valid settlement from different projects cannot be paired.
  const secondNode = s.finance.node(user, other.id, {name:"另一项目末级费用科目"});
  const secondCost = s.finance.cost(user, other.id, {
    cost_node_id:secondNode.id,title:"另一项目真实费用",amount_fen:9000,
    occurred_on:"2026-11-11",evidence:"另一项目凭证",
  });
  assert.throws(() => s.finance.reconciliation(user, {
    expected_version:0,cost_version_id:secondCost.id,
    settlement_item_version_id:bill.items[0].id,
    reconciled_cost_fen:1000,reconciled_settlement_fen:1000,
    evidence:"跨项目非法核对",
  }), /费用与结算不属于同一项目/);
  assert.equal(s.finance.reconciliations(other.id).length,0,
    "cross-project rejection must not leave a reconciliation fact");
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("project totals and itemized installments share one effective ledger and preserve pending revisions", t => {
  const { s, user, project, scope, approval, node, framework } = approvedFixture(t);
  const request = { mode: "project_total", approval_version_id: approval.id, amount_fen: 5000 };
  assert.throws(() => s.finance.saveDraft(user, project.id, { ...request, amount_fen: 0 }), /本次结算金额/);
  assert.throws(() => s.finance.saveDraft(user, project.id, { ...request,
    items: [{ cost_node_id: node.id, amount_fen: 1, evidence: "明细" }] }), /不能包含费用明细/);
  const submit = (row) => s.finance.submit(user, row.id, {
    expected_version: row.version?.version_no || 0, expected_edit_version: row.draft.edit_version,
  });
  const approve = (row) => s.finance.review(user, row.id, {
    expected_version: row.version.version_no, expected_event_seq: row.review.event_seq, action: "approve",
  });
  let bill = s.finance.saveDraft(user, project.id, request);
  assert.equal(bill.draft.document.mode, "project_total");
  assert.match(s.finance.closeBlockReason(project.id), /未提交/);
  bill = submit(bill);
  assert.match(s.finance.closeBlockReason(project.id), /待审核/);
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  bill = approve(bill);
  let summary = s.finance.summary(project.id);
  assert.equal(bill.version.amount_fen, 5000);
  assert.deepEqual(bill.items, []);
  assert.deepEqual(bill.resolutions, []);
  assert.equal(summary.settlement_progress_percent, null);
  assert.equal(summary.demands[0].resolved_quantity_scaled, 0);
  assert.equal(s.funding.details("frameworks", framework.id).summary.projects_without_cost_basis, 1);

  s.finance.cost(user, project.id, { cost_node_id: node.id, amount_fen: 8000,
    title: "核定实际费用", occurred_on: "2026-11-11", evidence: "费用凭据" });
  const itemized = { mode: "itemized", items: [{ cost_node_id: node.id, project_scope_id: scope.id,
    quantity_scaled: 0, amount_fen: 4000, evidence: "分项凭据" }] };
  assert.throws(() => s.finance.saveDraft(user, project.id, { ...itemized, amount_fen: 2 }), /合计一致/);
  approve(submit(s.finance.saveDraft(user, project.id, itemized)));
  summary = s.finance.summary(project.id);
  assert.equal(summary.settlement_fen, 9000);
  assert.equal(summary.project_total_settlement_fen, 5000);
  assert.equal(summary.settlement_progress_percent, 112.5);
  assert.equal(summary.excess_settlement_fen, 1000);
  assert.equal(s.finance.costTree(user, project.id).find(item => item.id === node.id).settlement_fen, 4000);

  bill = submit(s.finance.saveDraft(user, project.id, { ...request, amount_fen: 3000,
    change_type: "revision", expected_version: 1, expected_edit_version: 0 }, bill.id));
  assert.equal(bill.effective_amount_fen, 5000);
  bill = s.finance.review(user, bill.id, { expected_version: 2, expected_event_seq: 1, action: "return", reason: "回查凭据" });
  assert.match(s.finance.closeBlockReason(project.id), /已退回待处理/);
  assert.equal(s.finance.summary(project.id).settlement_fen, 9000);
  bill = s.finance.resubmit(user, bill.id, { expected_version: 2, expected_event_seq: 2 });
  assert.equal(bill.version.version_no, 2);
  bill = approve(bill);
  assert.equal(bill.effective_amount_fen, 3000);
  assert.equal(s.finance.summary(project.id).settlement_progress_percent, 87.5);
  const funded = s.funding.details("frameworks", framework.id).summary;
  assert.equal(funded.settlement_progress_percent, 87.5);
  assert.equal(funded.projects_without_cost_basis, 0);
  assert.equal(s.finance.closeBlockReason(project.id), "");
  const closed = s.finance.close(user, project.id, { expected_version: project.version, reason: "确认实际差额" });
  assert.equal(closed.status, "closed");
});
