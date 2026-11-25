import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

test("project finance HTTP pages preserve drafts, formal history, deletion and exact project ownership", async t => {
  const { s, user, project, framework, node, scope } = approvedFixture(t);
  const other = s.projects.save(user, { name: "另一个项目", framework_id: framework.id });
  const otherNode = s.finance.node(user, other.id, { name: "其他项目费用" });
  s.finance.cost(user, other.id, {
    cost_node_id: otherNode.id, title: "其他项目费用", amount_fen: 999,
    occurred_on: "2026-11-17", evidence: "隔离查询凭据",
  });
  const costs = [], bills = [];
  for (let index = 0; index < 8; index++) {
    costs.push(s.finance.cost(user, project.id, {
      cost_node_id: node.id, title: "分页费用" + index, amount_fen: 1000 + index,
      occurred_on: "2026-11-17", evidence: "分页测试凭据",
    }));
    let bill = s.finance.saveDraft(user, project.id, {
      items: [{ cost_node_id: node.id, project_scope_id: scope.id,
        quantity_scaled: 10000, amount_fen: 500 + index, evidence: "分期结算" }],
      resolutions: [{ project_scope_id: scope.id, location_item_no: index < 3 ? 1 : 3, resolved_quantity_scaled: 10000,
        evidence: "分期完成量" }],
    });
    if (index < 4) {
      bill = s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: 1 });
      bill = s.finance.review(user, bill.id, {
        expected_version: 1, expected_event_seq: 1, action: index === 3 ? "return" : "approve",
        reason: "核实分期结算",
      });
    }
    bills.push(bill);
  }
  const revision = s.finance.saveDraft(user, project.id, {
    expected_version: 1, expected_edit_version: 0,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id,
      quantity_scaled: 10000, amount_fen: 700, evidence: "保留旧版的新草稿" }],
    resolutions: [{ project_scope_id: scope.id, location_item_no: 1, resolved_quantity_scaled: 10000,
      evidence: "本次修订完成量" }],
  }, bills[0].id);
  const reconciliation = s.finance.reconciliation(user, {
    expected_version: 0,
    cost_version_id: costs[0].id, settlement_item_version_id: bills[0].items[0].id,
    reconciled_cost_fen: 100, reconciled_settlement_fen: 100,
    evidence: "分页核对依据", is_final: false,
  });
  s.finance.removeCost(user, project.id, costs[7].entry_id, { expected_version: 1 });
  s.finance.removeSettlement(user, bills[7].id, { expected_version: 0, expected_edit_version: 1 });
  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.shutdown(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const login = await fetch(base + "/api/login", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Schema113-test-password" }) });
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
  async function read(path, parameters = {}) {
    const response = await fetch(base + "/api/" + path + "?" + new URLSearchParams(parameters), { headers });
    assert.equal(response.status, 200);
    return response.json();
  }
  // Any accidental fallback would read every row before the HTTP paginator.
  for (const method of ["costs", "settlements", "allSettlements", "reconciliations"])
    s.finance[method] = () => { throw Error("unbounded finance read " + method); };
  const first = await read(`projects/${project.id}/costs`, { page_size: "3", sort: "amount_fen", direction: "desc" });
  assert.equal(first.total, 7);
  assert.deepEqual(first.items.map(row => row.amount_fen), [1006, 1005, 1004]);
  assert.ok(first.items.every(row => row.project_id === project.id));
  assert.equal(first.items[0].cost_node_name, node.name);
  assert.equal(first.items[0].id, costs[6].id);
  const second = await read(`projects/${project.id}/costs`, { page: "2", page_size: "3", sort: "amount_fen", direction: "desc" });
  assert.deepEqual(second.items.map(row => row.amount_fen), [1003, 1002, 1001]);
  const filtered = await read(`projects/${project.id}/costs`, { filters: JSON.stringify({ title: "分页费用5" }) });
  assert.equal(filtered.total, 1);
  const deleted = await read(`projects/${project.id}/costs`, { deleted: "true" });
  assert.equal(deleted.total, 8);
  assert.equal(deleted.items.find(row => row.entry_id === costs[7].entry_id).deleted, true);
  const page = await read(`projects/${project.id}/settlements`, { page_size: "3", sort: "number", direction: "asc" });
  assert.equal(page.total, 7);
  assert.equal(page.items.length, 3);
  const all = await read("settlements", { deleted: "true" });
  assert.equal(all.total, 8);
  const current = all.items.find(row => row.id === revision.id);
  assert.equal(current.version.version_no, 1);
  assert.equal(current.items[0].amount_fen, 500);
  assert.equal(current.items[0].cost_node_name, node.name);
  assert.equal(current.draft.document.items[0].amount_fen, 700);
  assert.equal(current.review.action, "approve");
  assert.equal(current.resolutions[0].resolved_quantity_scaled, 10000);
  assert.equal(all.items.find(row => row.id === bills[3].id).review.reason, "核实分期结算");
  assert.equal(all.items.find(row => row.id === bills[7].id).deleted, true);
  const attempts = await read(`projects/${other.id}/settlements`, { filters: JSON.stringify({ project_id: project.id }) });
  assert.equal(attempts.total, 0);
  const reconciled = await read("reconciliations", { project_id: project.id, filters: JSON.stringify({ evidence: "分页核对" }) });
  assert.equal(reconciled.total, 1);
  assert.equal(reconciled.items[0].record_id, reconciliation.record_id);
  const otherReconciliations = await read("reconciliations", { project_id: other.id });
  assert.equal(otherReconciliations.total, 0);
  assert.deepEqual(s.finance.summary(project.id).actual_cost_fen, 7021);
});
