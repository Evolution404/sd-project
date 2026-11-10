import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, approvedFixture } from "../helpers.mjs";
test("priced initial approval draft can be withdrawn without erasing the final quotation and recreated as V1", (t) => {
  const { s, user, save, demandInput } = fixture(t),
    demand = s.demands.save(user, demandInput);
  s.demands.transition(user, demand.id, {
    expected_version: 1,
    expected_event_seq: 1,
    status: "active",
  });
  const framework = save("frameworks", {
    code: "F-WITHDRAW",
    fiscal_year: 2026,
    name: "撤回验收框架",
    limit_fen: 1000000,
  });
  let project = s.projects.save(user, {
    code: "P-WITHDRAW",
    name: "撤回验收项目",
    framework_id: framework.id,
  });
  s.projects.link(user, project.id, {
    demand_id: demand.id,
    expected_version: 1,
  });
  project = s.projects.stock(user, project.id, { expected_version: 1 });
  const input = {
    expected_version: 2,
    approved_budget_fen: 120000,
    scopes: [
      {
        project_scope_id: project.scopes[0].id,
        demand_version: 1,
        locations: [
          { location_item_no: 1, approved_quantity_scaled: 30000 },
          { location_item_no: 2, approved_quantity_scaled: 20000 },
        ],
      },
    ],
  };
  project = s.projects.approvalDraft(user, project.id, input);
  const first = project.approvals[0],
    quote = s.pricing.quote(user, demand.id, {
      expected_version: 1,
      approval_scope_version_id: first.scopes[0].id,
      confirm: true,
    });
  project = s.projects.discardApproval(user, project.id, first.id);
  assert.equal(project.approvals.length, 0);
  assert.equal(
    s.repo.find("reference_price_evaluations", "id", quote.id).status,
    "final",
  );
  assert.equal(
    s.repo.find("project_approval_versions", "id", first.id).status,
    "withdrawn",
  );
  assert.throws(
    () =>
      s.repo.update("project_approval_versions", "id", first.id, {
        status: "draft",
      }),
    /不可覆盖/,
  );
  assert.throws(
    () =>
      s.repo.remove(
        "project_approval_scope_versions",
        "id",
        first.scopes[0].id,
      ),
    /不可删除/,
  );
  project = s.projects.approvalDraft(user, project.id, input);
  assert.equal(project.approvals[0].version_no, 1);
  assert.notEqual(project.approvals[0].id, first.id);
  project = s.projects.approve(user, project.id, project.approvals[0].id, {
    expected_version: 2,
  });
  assert.equal(project.status, "approved");
  assert.equal(s.projects.history(project.id).approvals.length, 2);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});
test("formal project change is authored before approval and cannot reuse a stale approval baseline", (t) => {
  const { s, user, project, demand, scope, approval } = approvedFixture(t),
    input = {
      expected_version: 3,
      expected_approval_version_id: approval.id,
      approved_budget_fen: 150000,
      scopes: [
        {
          project_scope_id: scope.id,
          demand_version: 1,
          locations: [
            { location_item_no: 1, approved_quantity_scaled: 20000 },
            { location_item_no: 2, approved_quantity_scaled: 10000 },
          ],
        },
      ],
    };
  assert.throws(() => s.projects.approvalDraft(user, project.id, input),
    /请核对差异并明确确认/);
  input.confirm_changes = true;
  let current = s.projects.approvalDraft(user, project.id, input),
    change = current.approvals.find((item) => item.status === "draft");
  assert.equal(current.approval.id, approval.id);
  assert.equal(current.approval.approved_budget_fen, 120000);
  assert.equal(
    s.pricing.quote(user, demand.id, {
      expected_version: 1,
      approval_scope_version_id: change.scopes[0].id,
      confirm: true,
    }).total_fen,
    26000,
  );
  current = s.projects.approve(user, project.id, change.id, {
    expected_version: 3,
  });
  assert.equal(current.approval.version_no, 2);
  assert.equal(current.approval.approved_budget_fen, 150000);
  assert.throws(
    () => s.projects.approvalDraft(user, project.id, input),
    /批准基线已变化/,
  );
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});
