import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";

/** The only authorized handoff is: effective settlement -> formal close -> immutable release. */
test("one demand is exclusively owned; formal partial close releases exact per-position remainder", t => {
  const { s, user, save, project: first, scope: firstScope, demand, framework } = approvedFixture(t);
  const later = s.projects.save(user, {
    code: "P-CONTINUE-02", name: "二期接续项目", framework_id: framework.id,
  });
  assert.throws(() => s.projects.link(user, later.id, {
    demand_id: demand.id, expected_version: 1,
  }), /已关联|已承接|其他子项目/);

  // First project completes 2,2,1, leaving 1,0,3 respectively.
  let bill = s.finance.saveDraft(user, first.id, {
    number: "CONTINUE-A1", approval_version_id: first.approval.id,
    mode: "project_total", amount_fen: 1000,
    resolutions: [
      { project_scope_id: firstScope.id, location_item_no: 1, resolved_quantity_scaled: 20000, evidence: "一号塔现场核对" },
      { project_scope_id: firstScope.id, location_item_no: 2, resolved_quantity_scaled: 20000, evidence: "二号塔现场核对" },
      { project_scope_id: firstScope.id, location_item_no: 3, resolved_quantity_scaled: 10000, evidence: "三号塔现场核对" },
    ],
  });
  bill = s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: 1 });
  bill = s.finance.review(user, bill.id, {
    expected_version: 1, expected_event_seq: 1, action: "approve",
  });
  assert.equal(bill.review.action, "approve");
  assert.deepEqual(s.demands.get(demand.id).work_locations.map(x => x.remaining_quantity_scaled),
    [10000, 0, 30000]);
  assert.throws(() => s.projects.link(user, later.id, {
    demand_id: demand.id, expected_version: 1,
  }), /已关联|已承接|其他子项目/, "in-progress project must remain exclusive even if work partially done");

  const close = s.projectClosure.preview(user, first.id);
  assert.deepEqual(close.summary.locations.map(x => x.remaining_quantity_scaled),
    [10000, 0, 30000]);
  assert.deepEqual(close.release_demands.map(x => x.remaining_quantity_scaled), [40000]);
  assert.equal(s.projectClosure.commit(user, first.id, {
    expected_version: first.version, preview_hash: close.preview_hash,
  }).status, "closed");
  assert.equal(s.demands.get(demand.id).binding, null,
    "formal closure must end current active binding but not delete history");
  const firstHistory = inspect(s).where("project_demand_link_events", {
    project_scope_id: firstScope.id,
  });
  assert.deepEqual(firstHistory.map(x => x.action), ["linked", "released"]);
  assert.equal(inspect(s).where("project_approval_scope_versions", {
    project_scope_id: firstScope.id,
  }).length, 1, "first project's signed approval remains immutable");

  let next = s.projects.link(user, later.id, {
    demand_id: demand.id, expected_version: 1,
  });
  const secondScope = next.scopes.find(x => x.demand_id === demand.id);
  assert.ok(secondScope);
  assert.equal(secondScope.proposed_quantity_scaled, 40000);
  next = s.projects.stock(user, next.id, { expected_version: 1 });
  assert.throws(() => s.projects.approvalDraft(user, next.id, {
    expected_version: 2, approved_budget_fen: 70000,
    scopes: [{ project_scope_id: secondScope.id, demand_version: 1,
      locations: [{ location_item_no: 1, approved_quantity_scaled: 10000 }] }],
  }), /全部未解决位置|完整承接|必须完整/, "second project must not cherry-pick just one outstanding location");

  next = s.projects.approvalDraft(user, next.id, {
    expected_version: 2, approved_budget_fen: 70000,
    scopes: [{ project_scope_id: secondScope.id, demand_version: 1,
      locations: [
        { location_item_no: 1, approved_quantity_scaled: 10000 },
        { location_item_no: 3, approved_quantity_scaled: 30000 },
      ] }],
  });
  assert.deepEqual(next.approvals[0].scopes[0].locations.map(x => x.location_item_no), [1, 3]);
  next = s.projects.approve(user, next.id, next.approvals[0].id, { expected_version: 2 });
  assert.equal(next.status, "approved");

  let remainingBill = s.finance.saveDraft(user, next.id, {
    number: "CONTINUE-B1", approval_version_id: next.approval.id,
    mode: "project_total", amount_fen: 1000,
    resolutions: [
      { project_scope_id: secondScope.id, location_item_no: 1, resolved_quantity_scaled: 10000, evidence: "一号塔补齐" },
      { project_scope_id: secondScope.id, location_item_no: 3, resolved_quantity_scaled: 30000, evidence: "三号塔补齐" },
    ],
  });
  remainingBill = s.finance.submit(user, remainingBill.id, {
    expected_version: 0, expected_edit_version: 1,
  });
  s.finance.review(user, remainingBill.id, {
    expected_version: 1, expected_event_seq: 1, action: "approve",
  });
  assert.deepEqual(s.demands.get(demand.id).work_locations.map(x => x.remaining_quantity_scaled),
    [0, 0, 0]);
  assert.equal(s.finance.summary(first.id).demands[0].resolved_quantity_scaled, 50000);
  assert.equal(s.finance.summary(next.id).demands[0].resolved_quantity_scaled, 40000);

  const closeB = s.projectClosure.preview(user, next.id);
  assert.equal(closeB.release_demands.length, 0, "fully solved demand has no remainder to release");
  s.projectClosure.commit(user, next.id, {
    expected_version: next.version, preview_hash: closeB.preview_hash,
  });
  assert.throws(() => s.projects.link(user, first.id, {
    demand_id: demand.id, expected_version: 1,
  }), /已结项|状态|已关联|已全部解决/);
  assert.equal(inspect(s).integrity().integrity[0].integrity_check, "ok");
});
