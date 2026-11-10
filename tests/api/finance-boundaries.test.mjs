import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";

test("settled amounts, independently reported work, over-completion and reconciliation revisions remain distinct", (t) => {
  const { s, user, project, scope, approval, node } = approvedFixture(t);
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
  assert.equal(s.repo.auditFor("reconciliations", record.record_id)
    .filter((item) => item.action === "delete").length, 1);
  assert.equal(s.finance.reconciliations(project.id).length, 0);
  assert.equal(s.finance.reconciliations(project.id, true)[0].deleted, true);
  assert.throws(
    () =>
      s.repo.update("settlement_item_versions", "id", fee.items[0].id, {
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
  s.projects.release(user, project.id, scope.id, { expected_event_seq: 1 });
  assert.equal(s.demands.get(scope.demand_id).binding, null);
  const history = s.projects.history(project.id);
  assert.equal(history.costs.length, 1);
  assert.equal(history.settlements.length, 2);
});
