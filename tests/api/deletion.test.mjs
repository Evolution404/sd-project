import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture, fixture } from "../helpers.mjs";
test("logical master deletion cannot be bypassed and formal settlement deletion retains void history", (t) => {
  const { s, user, project, scope, approval, node, save } = approvedFixture(t);
  const item = save("materials", {
    code: "DELETE-M",
    name: "可删除物资",
    unit_id: s.catalog.list("units")[0].id,
  });
  s.catalog.remove(user, "materials", item.id, 1);
  assert.equal(s.catalog.list("materials").length, 0);
  assert.equal(s.catalog.list("materials", true).length, 1);
  assert.throws(
    () =>
      s.catalog.save(
        user,
        "materials",
        { name: "绕过删除", expected_version: 2 },
        item.id,
      ),
    /已删除/,
  );
  let bill = s.finance.saveDraft(user, project.id, {
    number: "DELETE-S",
    approval_version_id: approval.id,
    items: [
      {
        cost_node_id: node.id,
        project_scope_id: scope.id,
        quantity_scaled: 10000,
        amount_fen: 30000,
        evidence: "费用依据",
      },
    ],
    resolutions: [
      { project_scope_id: scope.id, resolved_quantity_scaled: 10000 },
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
  s.finance.removeSettlement(user, bill.id, {
    expected_version: 1,
    expected_edit_version: 0,
  });
  assert.throws(() => s.finance.removeSettlement(user, bill.id, {
    expected_version: 2, expected_edit_version: 0,
  }), /结算单已删除/);
  assert.throws(() => s.finance.review(user, bill.id, {
    expected_version: 2, expected_event_seq: 2, action: "reject",
  }), /结算单已删除/);
  assert.throws(() => s.finance.submit(user, bill.id, {
    expected_version: 2, expected_edit_version: 0,
  }), /结算单已删除/);
  assert.throws(() => s.finance.discardDraft(user, bill.id, {
    expected_edit_version: 0,
  }), /结算单已删除/);
  assert.equal(s.finance.allSettlements().length, 0);
  assert.equal(s.finance.history(bill.id).length, 2);
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  assert.equal(
    s.finance.summary(project.id).demands[0].resolved_quantity_scaled,
    0,
  );
  assert.equal(
    s.finance.close(user, project.id, { expected_version: 3 }).status,
    "closed",
  );
});
test("archive a price referencing an outdated feature after work-object and operation archival", (t) => {
  const { s, user, save, object, operation, demandInput } = fixture(t);
  const factor = save("factors", {
    name: "作业难度", fields_json: { kind: "enum", values: ["普通", "困难"] },
  });
  const operation2 = s.catalog.save(user, "operations", {
    pricing_features_json: [
      { factor_id: factor.id, factor_version: 1, source: "manual", required: true },
    ],
    expected_version: 1,
  }, operation.id);
  const rule = save("prices", {
    title: "困难等级按位置定价",
    operation_id: operation.id, pricing_mode: "fixed", unit_price_fen: 2000,
    price_source: "空库验收", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "测试依据",
    additional_conditions_json: {
      [factor.code]: { factor_version: 1, op: "eq", value: "普通" },
    },
  });
  const demand = s.demands.save(user, {
    ...demandInput,
    work_locations: demandInput.work_locations.map((location) => ({
      ...location,
      site_features_json: {
        [factor.code]: { factor_version: 1, value: "普通" },
      },
    })),
  });
  const confirmed = s.pricing.quote(user, demand.id, {
    expected_version: 1, confirm: true,
  });
  assert.equal(confirmed.complete, true);

  s.catalog.save(user, "factors", {
    name: "作业难度正式定义修订", expected_version: 1,
  }, factor.id);
  s.catalog.remove(user, "objects", object.id, 1);
  s.catalog.remove(user, "operations", operation.id, operation2.version);
  const removed = s.catalog.remove(user, "prices", rule.id, 1);
  assert.equal(removed.deleted, true);
  assert.equal(s.catalog.get("prices", rule.id, true).deleted, true);
  assert.equal(s.catalog.history("prices", rule.id).length, 1,
    "deletion must not insert a fake price revision");
  assert.equal(inspect(s).auditFor("prices", rule.id).filter((row) =>
    row.action === "delete").length, 1);
  assert.ok(s.catalog.list("prices").every((item) => item.id !== rule.id));
  assert.equal(s.pricing.quote(user, demand.id, { expected_version: 1 }).complete, false,
    "deleted rules cannot participate in new quotes");
  const historicalQuotes = s.demands.history(demand.id).reference_quotes;
  assert.ok(historicalQuotes.some((evaluation) => evaluation.id === confirmed.id),
    "previously confirmed price evaluations remain part of history");
  assert.throws(() => s.catalog.remove(user, "prices", rule.id, 1), /已删除/);
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});
test("deleted costs and cost nodes are read-only and cannot create duplicate delete audits", (t) => {
  const { s, user, project, node } = approvedFixture(t);
  const cost = s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "测试费用",
    amount_fen: 25000, occurred_on: "2026-11-09", evidence: "验收依据",
  });
  s.finance.removeCost(user, project.id, cost.entry_id, { expected_version: 1 });
  assert.equal(s.finance.costs(project.id).length, 0);
  const deletedCost = s.finance.costs(project.id, true)[0];
  assert.equal(deletedCost.deleted, true);
  assert.equal(deletedCost.version_no, 2);
  assert.throws(() => s.finance.removeCost(user, project.id, cost.entry_id,
    { expected_version: 2 }), /费用已删除/);
  assert.equal(inspect(s).auditFor("costs", cost.entry_id).filter(
    (record) => record.action === "delete").length, 1);

  s.finance.removeNode(user, project.id, node.id, { expected_version: 1 });
  const deletedNode = s.projects.get(project.id).cost_nodes.find((row) => row.id === node.id);
  assert.equal(deletedNode.deleted, true);
  assert.throws(() => s.finance.removeNode(user, project.id, node.id,
    { expected_version: 2 }), /费用科目已删除/);
  assert.equal(inspect(s).auditFor("cost_nodes", node.id).filter(
    (record) => record.action === "delete").length, 1);
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});
