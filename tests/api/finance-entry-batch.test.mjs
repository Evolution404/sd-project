import assert from "node:assert/strict";
import test from "node:test";
import { approvedFixture } from "../helpers.mjs";

test("finance batches preserve permissions, rollback, versions, hierarchy and reconciliation caps", t => {
  const { s, user, project, node } = approvedFixture(t);
  const execute = (batch, fingerprint) => s.finance.entryBatch(user, project.id, batch, fingerprint);
  const row = (kind, ref, values, id) => ({ kind, ref, values, id });
  const nodes = { kind: "nodes", rows: [
    row("nodes", "1", { name: "批量材料费用", parent_id: null }),
    row("nodes", "2", { name: "批量交通费用", parent_id: null }),
  ] };
  const before = s.finance.costTree(user, project.id).length;
  const checkedNodes = execute(nodes);
  assert.equal(s.finance.costTree(user, project.id).length, before);
  const created = execute(nodes, checkedNodes.fingerprint).results;
  assert.equal(created.length, 2);
  const inactive = s.finance.node(user, project.id, { name: "独立停用科目", status: "inactive" });
  const rename = { kind: "nodes", rows: [
    row("nodes", "1", { name: "仍然停用", expected_version: inactive.version_no, parent_id: null }, inactive.id),
  ] };
  execute(rename, execute(rename).fingerprint);
  assert.equal(s.finance.costTree(user, project.id).find(item => item.id === inactive.id).status, "inactive");

  const info = { title: "测试实际费用", occurred_on: "2026-11-20", amount_fen: 12000, evidence: "票据", cost_node_id: node.id };
  const costs = { kind: "costs", rows: [
    row("costs", "1", info),
    row("costs", "2", { ...info, title: "另一条费用", occurred_on: "2026-02-31" }),
  ] };
  assert.deepEqual(execute(costs).issues.map(({ ref, field }) => [ref, field]), [["2", "occurred_on"]]);
  assert.equal(s.finance.costs(project.id).length, 0);
  costs.rows[1].values.occurred_on = "2026-11-21";
  const saved = execute(costs, execute(costs).fingerprint).results;
  const actuals = saved.map(({ id }) => s.finance.costHistory(project.id, id)[0]);
  const updates = { kind: "costs", rows: actuals.map((actual, index) =>
    row("costs", String(index + 1), { ...info, title: "更正" + index, expected_version: actual.version_no }, actual.entry_id)) };
  const checkedUpdates = execute(updates);
  s.finance.cost(user, project.id, { ...info, title: "另一并发版本", expected_version: actuals[1].version_no }, actuals[1].entry_id);
  assert.throws(() => execute(updates, checkedUpdates.fingerprint), error =>
    error.status === 422 && /版本冲突/.test(error.fields["rows.2"]));
  assert.equal(s.finance.costHistory(project.id, actuals[0].entry_id).length, 1);
  assert.throws(() => s.finance.entryBatch({ ...user, permissions: ["read"] }, project.id, costs), error => error.status === 403);

  const settlement = s.finance.saveAndSubmit(user, project.id, {
    approval_version_id: project.approval.id, basis: "批量核对夹具", mode: "itemized",
    items: [{ cost_node_id: node.id, amount_fen: 13000, evidence: "凭据" }],
  });
  s.finance.review(user, settlement.id, {
    action: "approve", expected_version: settlement.version.version_no, expected_event_seq: settlement.review.event_seq,
  });
  const source = s.finance.searchReconciliationItems(user, project.id, {
    page: 1, page_size: 20, q: "", filters: {},
  }).items[0];
  const match = { cost_version_id: actuals[0].id, settlement_item_version_id: source.id,
    reconciled_cost_fen: 7000, reconciled_settlement_fen: 6000, evidence: "逐行核对" };
  const reconciliations = { kind: "reconciliations", rows: [
    row("reconciliations", "1", match),
    row("reconciliations", "2", { ...match, reconciled_settlement_fen: 8000 }),
  ] };
  assert.deepEqual(execute(reconciliations).issues.map(issue => [issue.ref, issue.field]), [["2", "reconciled_cost_fen"]]);
  reconciliations.rows[1].values.reconciled_cost_fen = 5000;
  assert.deepEqual(execute(reconciliations).issues.map(issue => [issue.ref, issue.field]), [["2", "reconciled_settlement_fen"]]);
  assert.equal(s.finance.reconciliations(project.id).length, 0);
  reconciliations.rows[1].values.reconciled_settlement_fen = 7000;
  const proof = execute(reconciliations);
  assert.equal(s.finance.reconciliations(project.id).length, 0);
  assert.equal(execute(reconciliations, proof.fingerprint).results.length, 2);
  assert.equal(s.finance.summary(project.id).reconciled_cost_fen, 12000);
});
