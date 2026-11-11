import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";

test("project workspace lazily loads only active approval and draft while preserving all formal history", (t) => {
  const { s, user, project, demand, scope, approval } = approvedFixture(t);
  const first = s.projects.workspace(project.id);
  assert.deepEqual(first.approvals.map(row => row.id), [approval.id]);
  assert.equal(first.approvals[0].scopes[0].demand_no, demand.demand_no);

  const baseline = s.projects.get(project.id);
  let next = s.projects.approvalDraft(user, project.id, {
    expected_version: baseline.version,
    expected_approval_version_id: approval.id,
    approved_budget_fen: approval.approved_budget_fen,
    scopes: [{
      project_scope_id: scope.id,
      demand_version: demand.current_version,
      locations: demand.work_locations.map((location, i) => ({
        location_item_no: i + 1,
        approved_quantity_scaled: location.quantity_scaled,
      })),
    }],
  });
  const draft = next.approvals.find(row => row.status === "draft");
  assert.ok(draft);
  assert.deepEqual(s.projects.workspace(project.id).approvals.map(row => row.id),
    [approval.id, draft.id]);
  next = s.projects.approve(user, project.id, draft.id, {
    expected_version: next.version,
  });
  const active = s.projects.workspace(project.id);
  assert.deepEqual(active.approvals.map(row => row.id), [draft.id]);
  assert.equal(active.approvals[0].status, "approved");
  assert.equal(next.approvals.length, 2);
  assert.equal(s.projects.get(project.id).approvals.length, 2);
  const historical = s.projects.approvalHistory(project.id);
  assert.deepEqual(historical.map(row => row.id), [approval.id, draft.id]);
  for (const row of historical) {
    assert.deepEqual(row.reference, s.pricing.summary(row.id));
    assert.equal(row.scopes[0].demand_no, demand.demand_no);
    assert.equal(row.scopes[0].locations.length, demand.work_locations.length);
  }
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});
