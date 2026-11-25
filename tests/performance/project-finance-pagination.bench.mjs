import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { approvedFixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";
import { financeListRepository } from "../../dist/server/database/repositories/finance-lists.js";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

test("240 costs, 120 settlements and 60 reconciliations use bounded SQL pages", { timeout: 180000 }, t => {
  const { s, user, project, node, scope } = approvedFixture(t, { firstLocationQuantity: 120 * 10000 });
  s.database.transaction(() => {
    for (let index = 0; index < 240; index++) {
      const cost = s.finance.cost(user, project.id, {
        cost_node_id: node.id, title: "压力费用" + String(index).padStart(4, "0"),
        amount_fen: 1000 + index, occurred_on: "2026-11-17", evidence: "压力测试凭据",
      });
      if (index >= 120) continue;
      let bill = s.finance.saveDraft(user, project.id, {
        items: [{ cost_node_id: node.id, project_scope_id: scope.id,
          quantity_scaled: 10000, amount_fen: 500, evidence: "分期结算压力测试" }],
        resolutions: [{ project_scope_id: scope.id, location_item_no: 1, resolved_quantity_scaled: 10000,
          evidence: "压力测试工程量" }],
      });
      if (index >= 60) continue;
      bill = s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: 1 });
      bill = s.finance.review(user, bill.id, { expected_version: 1, expected_event_seq: 1, action: "approve" });
      s.finance.reconciliation(user, {
        expected_version: 0,
        cost_version_id: cost.id, settlement_item_version_id: bill.items[0].id,
        reconciled_cost_fen: 100, reconciled_settlement_fen: 100,
        evidence: "压力核对" + String(index).padStart(4, "0"), is_final: false,
      });
    }
  });
  let reads = 0;
  const store = inspect(s);
  const counted = {
    query(...args) { reads++; return store.query(...args); },
    get(...args) { reads++; return store.get(...args); },
  };
  const repository = financeListRepository(counted);
  const began = performance.now(), measurements = [];
  for (const size of [1, 30, 120]) {
    const query = parseListQuery(new URLSearchParams({ page_size: String(size), sort: "number", direction: "asc" }));
    reads = 0;
    const bills = repository.searchSettlementWorkflows(project.id, query);
    assert.equal(reads, 7);
    assert.equal(bills.total, 120);
    assert.equal(bills.items.length, size);
    measurements.push({ kind: "settlements", pageSize: size, reads });
    reads = 0;
    const costs = repository.searchProjectCosts(project.id, { ...query, sort: "amount_fen" });
    assert.equal(reads, 2);
    assert.equal(costs.total, 240);
    assert.equal(costs.items[0].amount_fen, 1000);
    assert.equal(costs.items.length, size);
    measurements.push({ kind: "costs", pageSize: size, reads });
    reads = 0;
    const reconciliations = repository.searchReconciliationVersions(project.id, { ...query, sort: "evidence" });
    assert.equal(reads, 2);
    assert.equal(reconciliations.total, 60);
    assert.equal(reconciliations.items.length, Math.min(size, 60));
    measurements.push({ kind: "reconciliations", pageSize: size, reads });
  }
  reads = 0;
  const empty = repository.searchSettlementWorkflows(project.id, parseListQuery(new URLSearchParams({ q: "不存在的结算" })));
  assert.equal(empty.total, 0);
  assert.equal(reads, 2);
  assert.deepEqual(inspect(s).integrity().foreignKeys, []);
  console.log("PROJECT_FINANCE_SQL_BENCH", JSON.stringify({ costs: 240, settlements: 120, reconciliations: 60,
    measurements, readElapsedMs: Math.round(performance.now() - began) }));
});
