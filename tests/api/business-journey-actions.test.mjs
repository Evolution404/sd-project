import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, approvedFixture } from "../helpers.mjs";
import { projectActionHints } from "../../dist/server/modules/projects/actions.js";

test("atomic new project plus demand acceptance creates one association and a formal project", t => {
  const { s, user, save, demandInput } = fixture(t);
  const demand = s.demands.save(user, demandInput);
  s.demands.transition(user, demand.id, {
    expected_version: demand.current_version, expected_event_seq: 1, status: "active",
  });
  const framework = save("frameworks", { name: "旅程资金框架", fiscal_year: 2026, limit_fen: 500000 });
  const created = s.projects.createFromDemand(user, {
    name: "由需求直接承接的项目", framework_id: framework.id,
    demand_id: demand.id, expected_demand_version: demand.current_version,
  });
  assert.equal(created.name, "由需求直接承接的项目");
  assert.equal(created.scopes.length, 1);
  assert.equal(created.scopes[0].demand_id, demand.id);
  assert.equal(s.demands.get(demand.id).binding.project_id, created.id);
  const auditCount = inspect(s).auditFor("projects", created.id).length;
  assert.equal(auditCount, 1, "project creation has one formal audit entry");
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("stale or prebound demand cannot leave half-created projects", t => {
  const { s, user, save, demandInput } = fixture(t);
  const demand = s.demands.save(user, demandInput);
  const framework = save("frameworks", { name: "框架", fiscal_year: 2026, limit_fen: 500000 });
  assert.throws(() => s.projects.createFromDemand(user, {
    name: "禁止创建", framework_id: framework.id,
    demand_id: demand.id, expected_demand_version: 1,
  }), /确认需求有效/);
  assert.equal(s.projects.list().length, 0);
  s.demands.transition(user, demand.id, {
    expected_version: 1, expected_event_seq: 1, status: "active",
  });
  assert.throws(() => s.projects.createFromDemand(user, {
    name: "版本冲突", framework_id: framework.id,
    demand_id: demand.id, expected_demand_version: 99,
  }), /版本冲突/);
  assert.equal(s.projects.list().length, 0);
});

test("project action hints change with formal phase and actor permissions", t => {
  const { s, user, save, demandInput } = fixture(t);
  const framework = save("frameworks", { name: "动作提示框架", fiscal_year: 2026, limit_fen: 500000 });
  const project = s.projects.save(user, { name: "动作提示项目", framework_id: framework.id });
  const readOnly = { ...user, role: "viewer", permissions: ["read"] };
  const first = projectActionHints(user, s.projects.workspace(project.id));
  assert.equal(first[0].key, "link");
  assert.equal(first[0].enabled, true);
  assert.equal(projectActionHints(readOnly, s.projects.workspace(project.id))[0].enabled, false);
  const demand = s.demands.save(user, demandInput);
  s.demands.transition(user, demand.id, { expected_version: 1, expected_event_seq: 1, status: "active" });
  s.projects.link(user, project.id, { demand_id: demand.id, expected_version: 1 });
  assert.equal(projectActionHints(user, s.projects.workspace(project.id))[0].key, "stock");
  s.projects.stock(user, project.id, { expected_version: 1 });
  assert.equal(projectActionHints(user, s.projects.workspace(project.id))[0].key, "approval");
});

test("annual framework and execution agreement aggregate only approved settlements once", t => {
  const { s, user, project, framework, scope, node, approval } = approvedFixture(t);
  const agreement = s.funding.save(user, "agreements", {
    name: "汇总结算协议", framework_id: framework.id, limit_fen: 100000,
  });
  s.projects.fund(user, project.id, {
    agreement_id: agreement.id, expected_version: project.funding?.version_no ?? 0,
  });
  s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "实际发生的费用",
    occurred_on: "2026-11-11", amount_fen: 80000, evidence: "现场费用",
  });
  let bill = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id,
      amount_fen: 50000, quantity_scaled: 10000, evidence: "分次结算" }],
    resolutions: [{ project_scope_id: scope.id, location_item_no: 1,
      resolved_quantity_scaled: 10000, evidence: "实际解决数量" }],
  });
  // Pending and draft records must not increase approved settlements.
  assert.equal(s.funding.details("frameworks", framework.id).summary.settlement_fen, 0);
  bill = s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: 1 });
  assert.equal(s.funding.details("frameworks", framework.id).summary.settlement_fen, 0);
  s.finance.review(user, bill.id, {
    expected_version: 1, expected_event_seq: 1, action: "approve",
  });
  const frameworkFacts = s.funding.details("frameworks", framework.id);
  const agreementFacts = s.funding.details("agreements", agreement.id);
  for (const facts of [frameworkFacts, agreementFacts]) {
    assert.equal(facts.summary.settlement_fen, 50000);
    assert.equal(facts.summary.actual_cost_fen, 80000);
    assert.equal(facts.summary.project_count, 1);
    assert.equal(facts.projects[0].settlement_fen, 50000);
  }
  assert.equal(frameworkFacts.summary.settlement_fen, s.finance.summary(project.id).settlement_fen);
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});
