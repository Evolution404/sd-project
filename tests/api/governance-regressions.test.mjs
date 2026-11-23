import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { approvedFixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";

const query = { page: 1, page_size: 30, q: "", filters: {}, sort: "created_at", direction: "desc", deleted: false };

function submit(s, user, bill) {
  return s.finance.submit(user, bill.id, {
    expected_version: bill.version?.version_no ?? 0,
    expected_edit_version: bill.draft.edit_version,
  });
}

function review(s, user, bill, action, reason) {
  return s.finance.review(user, bill.id, {
    expected_version: bill.version.version_no,
    expected_event_seq: bill.review.event_seq,
    action, reason,
  });
}

test("concurrent cost changes invalidate a close preview and leave no closure", t => {
  const { s, user, project, node, approval } = approvedFixture(t);
  const expense = { cost_node_id: node.id, title: "测试费用", amount_fen: 10000, occurred_on: "2026-11-11", evidence: "测试凭据" };
  s.finance.cost(user, project.id, expense);
  const bill = s.finance.saveDraft(user, project.id, {
    mode: "project_total", amount_fen: 5000, approval_version_id: approval.id,
  });
  review(s, user, submit(s, user, bill), "approve");
  const reviewed = s.projectClosure.preview(user, project.id);
  assert.equal(reviewed.summary.settlement_progress_percent, 4.17);
  s.finance.cost(user, project.id, { ...expense, title: "并发核定费用" });
  assert.throws(() => s.projectClosure.commit(user, project.id, reviewed), { status: 409 });
  assert.equal(s.projects.history(project.id).closures.length, 0);
  const fresh = s.projectClosure.preview(user, project.id);
  s.projectClosure.commit(user, project.id, fresh);
  assert.equal(JSON.parse(s.projects.history(project.id).closures.at(-1).close_snapshot_json)
    .settlement_progress_percent, 4.17);
});

test("effective statement lines survive return, cost corrections cannot over-apply, and void status matches both lists", t => {
  const { s, user, project, node, approval, scope } = approvedFixture(t);
  const expense = { cost_node_id: node.id, title: "测试费用", amount_fen: 10000, occurred_on: "2026-11-11", evidence: "测试凭据" };
  const cost = s.finance.cost(user, project.id, expense);
  const input = { mode: "itemized", approval_version_id: approval.id, items: [
    { cost_node_id: node.id, project_scope_id: scope.id, amount_fen: 10000, quantity_scaled: 10000, evidence: "模拟明细" },
  ] };
  let bill = s.finance.saveDraft(user, project.id, input);
  bill = review(s, user, submit(s, user, bill), "approve");
  const effective = bill.items[0].id;
  bill = s.finance.saveDraft(user, project.id, {
    ...input, expected_version: 1, expected_edit_version: 0, change_type: "revision",
  }, bill.id);
  bill = submit(s, user, bill);
  for (const action of ["pending", "returned"]) {
    if (action === "returned") bill = review(s, user, bill, "return", "模拟退回");
    const choices = s.finance.searchReconciliationItems(user, project.id, query).items;
    assert.ok(choices.some(item => item.id === effective && item.cost_node_name === "人工费"));
  }
  s.finance.reconciliation(user, {
    expected_version: 0, cost_version_id: cost.id, settlement_item_version_id: effective,
    reconciled_cost_fen: 10000, reconciled_settlement_fen: 10000, evidence: "测试依据",
  });
  assert.throws(() => s.finance.cost(user, project.id,
    { ...expense, expected_version: 1, amount_fen: 8000 }, cost.entry_id), { status: 409 });
  assert.equal(s.finance.summary(project.id).unreconciled_cost_fen, 0);
  assert.throws(() => inspect(s).insert("cost_versions", {
    ...cost, id: randomUUID(), request_key: randomUUID(), version_no: 2, amount_fen: 8000,
  }), /更正后金额低于已核对金额/);
  bill = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id, expected_version: 2, expected_edit_version: 0,
    change_type: "void", reason: "测试正式注销",
  }, bill.id);
  bill = review(s, user, submit(s, user, bill), "approve");
  assert.equal(bill.status, "voided");
  const filters = { ...query, filters: { status: "已注销" } };
  assert.equal(s.finance.search("settlements", filters).total, 1);
  assert.equal(s.finance.searchSettlements(project.id, filters).total, 1);
  assert.equal(s.finance.searchReconciliationItems(user, project.id, query).total, 0);
});

test("an unfinished project change is reported before close and cannot create a closure", t => {
  const { s, user, project, approval, scope, demand } = approvedFixture(t);
  const change = s.projects.approvalDraft(user, project.id, {
    expected_version: project.version, expected_approval_version_id: approval.id,
    approved_budget_fen: 121000, confirm_changes: true,
    scopes: [{ project_scope_id: scope.id, demand_version: demand.current_version,
      locations: demand.work_locations.map(location => ({
        location_item_no: location.item_no, approved_quantity_scaled: location.quantity_scaled,
      })) }],
  });
  const queue = s.projects.handlingQueue(user, "change", query);
  assert.equal(queue.items.find(row => row.id === project.id)?.reason, "");
  const preview = s.projectClosure.preview(user, project.id);
  assert.match(preview.reason, /尚有未完成/);
  assert.throws(() => s.projectClosure.commit(user, change.id, preview), { status: 409 });
  assert.equal(s.projects.history(project.id).closures.length, 0);
});
