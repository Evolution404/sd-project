import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
test("Schema113 real workflow, partial price, exclusive binding, three settlements and flexible close", (t) => {
  const { s, user, save, demandInput } = fixture(t);
  const demand = s.demands.save(user, demandInput);
  assert.equal(demand.quantity_scaled, 90000);
  assert.equal(demand.work_locations.length, 3);
  assert.equal(
    s.pricing.quote(user, demand.id, { expected_version: 1, confirm: true })
      .total_fen,
    48000,
  );
  s.demands.transition(user, demand.id, {
    expected_version: 1,
    expected_event_seq: 1,
    status: "active",
  });
  const framework = save("frameworks", {
    code: "F26",
    fiscal_year: 2026,
    name: "2026框架",
    limit_fen: 100000,
  });
  const project = s.projects.save(user, {
    code: "P001",
    name: "防鸟项目",
    framework_id: framework.id,
  });
  s.projects.link(user, project.id, {
    demand_id: demand.id,
    expected_version: 1,
  });
  const other = s.projects.save(user, {
    code: "P002",
    name: "其他项目",
    framework_id: framework.id,
  });
  assert.throws(
    () =>
      s.projects.link(user, other.id, {
        demand_id: demand.id,
        expected_version: 1,
      }),
    /关联/,
  );
  s.projects.stock(user, project.id, { expected_version: 1 });
  let p = s.projects.get(project.id),
    scope = p.scopes[0];
  p = s.projects.approvalDraft(user, p.id, {
    expected_version: 2,
    approved_budget_fen: 120000,
    scopes: [
      {
        project_scope_id: scope.id,
        demand_version: 1,
        locations: [
          { location_item_no: 1, approved_quantity_scaled: 30000 },
          { location_item_no: 2, approved_quantity_scaled: 20000 },
        ],
      },
    ],
  });
  const approval = p.approvals[0];
  assert.equal(s.pricing.summary(approval.id).total_fen, null);
  assert.equal(
    s.pricing.quote(user, demand.id, {
      expected_version: 1,
      approval_scope_version_id: approval.scopes[0].id,
      confirm: true,
    }).total_fen,
    30000,
  );
  p = s.projects.approve(user, p.id, approval.id, { expected_version: 2 });
  assert.equal(p.status, "approved");
  const node = s.finance.node(user, p.id, { name: "人工费" });
  const cost = s.finance.cost(user, p.id, {
    cost_node_id: node.id,
    title: "真实费用",
    occurred_on: "2026-11-08",
    amount_fen: 140000,
    evidence: "发票",
  });
  assert.equal(cost.amount_fen, 140000);
  for (const [index, quantity] of [20000, 30000, 0].entries()) {
    let bill = s.finance.saveDraft(user, p.id, {
      number: `JS${index + 1}`,
      approval_version_id: approval.id,
      items: [
        {
          cost_node_id: node.id,
          project_scope_id: scope.id,
          quantity_scaled: 10000,
          amount_fen: 40000,
          evidence: "结算依据",
        },
      ],
      resolutions: [
        {
          project_scope_id: scope.id,
          resolved_quantity_scaled: quantity,
          evidence: "巡视复核",
        },
      ],
    });
    bill = s.finance.submit(user, bill.id, {
      expected_version: 0,
      expected_edit_version: 1,
    });
    bill = s.finance.review(user, bill.id, {
      expected_version: 1,
      expected_event_seq: 1,
      action: "approve",
    });
    assert.equal(bill.review.action, "approve");
  }
  const summary = s.finance.summary(p.id);
  assert.equal(summary.settlement_fen, 120000);
  assert.equal(summary.demands[0].resolved_quantity_scaled, 50000);
  assert.equal(
    s.finance.close(user, p.id, { expected_version: 3 }).status,
    "closed",
  );
  s.projects.release(user, p.id, scope.id, { expected_event_seq: 1 });
  s.projects.link(user, other.id, {
    demand_id: demand.id,
    expected_version: 1,
  });
  assert.equal(s.demands.get(demand.id).binding.project_id, other.id);
  assert.equal(inspect(s).integrity().integrity[0].integrity_check, "ok");
});
