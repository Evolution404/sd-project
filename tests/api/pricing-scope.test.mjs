import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
test("complete demand 480 plus 200 plus one 50 project charge remains independent from budget", (t) => {
  const { s, user, save, demandInput, unit, object, operation } = fixture(t),
    first = s.demands.save(user, demandInput);
  s.demands.transition(user, first.id, {
    expected_version: 1,
    expected_event_seq: 1,
    status: "active",
  });
  const anotherOp = save("operations", {
      code: "inspect",
      name: "检查防鸟装置",
      default_unit_id: unit.id,
      work_object_id: object.id,
      completion_standard: "检查完毕",
    }),
    tower = save("physical", { tower_code: "T18" });
  save("prices", {
    code: "inspection-price",
    title: "检查固定价",
    operation_id: anotherOp.id,
    pricing_mode: "fixed",
    unit_price_fen: 20000,
    price_source: "测试依据",
    price_date: "2026-01-01",
    effective_on: "2026-01-01",
    basis: "合成定额",
  });
  const second = s.demands.save(user, {
    demand_no: "D002",
    operation_id: anotherOp.id,
    problem_description: "检查需求",
    expected_on:"2027-01-31",
    completion_standard: "检查完毕",
    work_locations: [
      {
        location_kind: "physical_tower",
        physical_tower_id: tower.id,
        quantity_scaled: 10000,
      },
    ],
  });
  s.demands.transition(user, second.id, {
    expected_version: 1,
    expected_event_seq: 1,
    status: "active",
  });
  const framework = save("frameworks", {
    code: "F-PRICE",
    name: "参考价验收框架",
    fiscal_year: 2026,
    limit_fen: 1000000,
  });
  let project = s.projects.save(user, {
    code: "P-PRICE",
    name: "组合范围项目",
    framework_id: framework.id,
  });
  s.projects.link(user, project.id, {
    demand_id: first.id,
    expected_version: 1,
  });
  s.projects.link(user, project.id, {
    demand_id: second.id,
    expected_version: 1,
  });
  project = s.projects.stock(user, project.id, { expected_version: 1 });
  project = s.projects.approvalDraft(user, project.id, {
    expected_version: 2,
    approved_budget_fen: 120000,
    scopes: [
      {
        project_scope_id: project.scopes.find(
          (scope) => scope.demand_id === first.id,
        ).id,
        demand_version: 1,
        locations: first.work_locations.map(loc=>({
          location_item_no: loc.item_no,approved_quantity_scaled:loc.quantity_scaled,
        })),
      },
      {
        project_scope_id: project.scopes.find(
          (scope) => scope.demand_id === second.id,
        ).id,
        demand_version: 1,
        locations: [{ location_item_no: 1, approved_quantity_scaled: 10000 }],
      },
    ],
  });
  const approval = project.approvals[0];
  s.pricing.quote(user, first.id, {
    expected_version: 1,
    approval_scope_version_id: approval.scopes.find(
      (scope) => scope.demand_id === first.id,
    ).id,
    confirm: true,
  });
  assert.equal(s.pricing.summary(approval.id).total_fen, null);
  assert.equal(s.pricing.summary(approval.id).subtotal_fen, 48000);
  s.pricing.quote(user, second.id, {
    expected_version: 1,
    approval_scope_version_id: approval.scopes.find(
      (scope) => scope.demand_id === second.id,
    ).id,
    confirm: true,
  });
  const transport = save("prices", {
    code: "transport",
    title: "项目运输费",
    operation_id: operation.id,
    pricing_scope: "project",
    pricing_mode: "fixed",
    unit_price_fen: 5000,
    price_source: "测试依据",
    price_date: "2026-01-01",
    effective_on: "2026-01-01",
    basis: "项目只计一次",
  });
  let charge = s.pricing.addCharge(user, {
    approval_version_id: approval.id,
    reference_price_version_id: transport.current_version_id,
    quantity_scaled: 10000,
    charge_scope_key: "transport",
  });
  assert.equal(s.pricing.summary(approval.id).total_fen, 73000);
  assert.throws(
    () =>
      s.pricing.addCharge(user, {
        approval_version_id: approval.id,
        reference_price_version_id: transport.current_version_id,
        quantity_scaled: 10000,
        charge_scope_key: "different-name",
      }),
    /UNIQUE/,
  );
  assert.throws(() =>
    s.pricing.reviseCharge(user, charge.id, { quantity_scaled: 0 }),
  );
  assert.equal(s.pricing.summary(approval.id).total_fen, 73000);
  charge = s.pricing.reviseCharge(user, charge.id, { quantity_scaled: 20000 });
  assert.equal(s.pricing.summary(approval.id).total_fen, 73000);
  s.pricing.removeCharge(user, charge.id);
  assert.equal(s.pricing.summary(approval.id).total_fen, 68000);
  charge = s.pricing.addCharge(user, {
    approval_version_id: approval.id,
    reference_price_version_id: transport.current_version_id,
    quantity_scaled: 10000,
  });
  assert.equal(s.pricing.summary(approval.id).total_fen, 73000);
  assert.equal(
    s.projects.approve(user, project.id, approval.id, { expected_version: 2 })
      .approval.approved_budget_fen,
    120000,
  );
  assert.throws(() => s.pricing.removeCharge(user, charge.id), /项目变更/);
  assert.ok(inspect(s).auditFor("reference_charges", charge.id).length === 0);
  assert.equal(s.pricing.summary(approval.id).total_fen, 73000);
});
