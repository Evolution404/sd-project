import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture, fixture } from "../helpers.mjs";

function draftInput(approval, scope, node, amount = 12500) {
  return {
    approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id,
      quantity_scaled: 10000, amount_fen: amount, evidence: "正式施工计量凭据" }],
    resolutions: [{ project_scope_id: scope.id, location_item_no: 1,
      resolved_quantity_scaled: 10000, evidence: "本次实际完成量" }],
  };
}

test("bound demand cannot be returned by the API; unbound active demand remains returnable", t => {
  const { s, user, demand } = approvedFixture(t);
  assert.equal(s.demands.get(demand.id).status, "active");
  assert.ok(s.demands.get(demand.id).binding, "fixture demand must be linked");
  assert.throws(() => s.demands.transition(user, demand.id, {
    expected_version: 1, expected_event_seq: 2, status: "returned",
  }), /已由子项目承接/);
  assert.equal(s.demands.get(demand.id).status, "active");
});
test("unbound demand can return and be confirmed again", t => {
  const { s, user, demandInput } = fixture(t);
  const row = s.demands.save(user, demandInput);
  s.demands.transition(user, row.id, {
    expected_version: 1, expected_event_seq: 1, status: "active",
  });
  const returned = s.demands.transition(user, row.id, {
    expected_version: 1, expected_event_seq: 2, status: "returned",
  });
  assert.equal(returned.status, "returned");
  assert.equal(s.demands.transition(user, row.id, {
    expected_version: 1, expected_event_seq: 3, status: "active",
  }).status, "active");
});
test("settlement review is strictly sequential, return requires reason, same version can be resubmitted", t => {
  const { s, user, project, approval, scope, node } = approvedFixture(t);
  const input = draftInput(approval, scope, node);
  const initial = s.finance.saveDraft(user, project.id, input);
  const submitted = s.finance.submit(user, initial.id, {
    expected_version: 0, expected_edit_version: 1,
  });
  assert.equal(submitted.review.action, "submit");
  assert.throws(() => s.finance.saveDraft(user, project.id, {
    ...input, expected_version: 1, expected_edit_version: 0,
  }, initial.id), /正在?提交审核|正在审核|审核完成前/);
  assert.throws(() => s.finance.review(user, initial.id, {
    expected_version: 1, expected_event_seq: 1, action: "return",
  }), /退回原因/);
  assert.throws(() => s.finance.review(user, initial.id, {
    expected_version: 1, expected_event_seq: 1, action: "return", reason: "  ",
  }), /退回原因/);
  const returned = s.finance.review(user, initial.id, {
    expected_version: 1, expected_event_seq: 1, action: "return", reason: "补充发票说明",
  });
  assert.equal(returned.review.action, "return");
  assert.equal(returned.review.reason, "补充发票说明");
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  assert.throws(() => s.finance.resubmit(user, initial.id, {
    expected_version: 1, expected_event_seq: 1,
  }), /版本/);
  const resubmitted = s.finance.resubmit(user, initial.id, {
    expected_version: 1, expected_event_seq: 2,
  });
  assert.equal(resubmitted.review.action, "submit");
  assert.equal(resubmitted.version.id, submitted.version.id, "original immutable version reused");
  assert.equal(resubmitted.review.event_seq, 3);
  assert.equal(resubmitted.draft, null);
  assert.throws(() => s.finance.resubmit(user, initial.id, {
    expected_version: 1, expected_event_seq: 3,
  }), /只有审核退回/);
  const approved = s.finance.review(user, initial.id, {
    expected_version: 1, expected_event_seq: 3, action: "approve",
  });
  assert.equal(approved.review.action, "approve");
  assert.equal(s.finance.summary(project.id).settlement_fen, 12500);
  assert.deepEqual(s.finance.history(initial.id)[0].events.map(e => e.action),
    ["submit", "return", "submit", "approve"]);
});
test("returned settlement can instead be corrected through a new immutable version", t => {
  const { s, user, project, approval, scope, node } = approvedFixture(t);
  const base = draftInput(approval, scope, node, 12500);
  const initial = s.finance.saveDraft(user, project.id, base);
  s.finance.submit(user, initial.id, { expected_version: 0, expected_edit_version: 1 });
  s.finance.review(user, initial.id, {
    expected_version: 1, expected_event_seq: 1, action: "return", reason: "金额需复核",
  });
  const revised = s.finance.saveDraft(user, project.id, {
    ...draftInput(approval, scope, node, 13700),
    expected_version: 1, expected_edit_version: 0, change_type: "revision",
  }, initial.id);
  assert.ok(revised.draft);
  assert.throws(() => s.finance.resubmit(user, initial.id, {
    expected_version: 1, expected_event_seq: 2,
  }), /已有修订草稿/);
  const submitted = s.finance.submit(user, initial.id, {
    expected_version: 1, expected_edit_version: 1,
  });
  assert.equal(submitted.version.version_no, 2);
  assert.equal(submitted.review.action, "submit");
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  s.finance.review(user, initial.id, {
    expected_version: 2, expected_event_seq: 1, action: "approve",
  });
  assert.equal(s.finance.summary(project.id).settlement_fen, 13700);
  assert.equal(s.finance.history(initial.id).length, 2);
});
