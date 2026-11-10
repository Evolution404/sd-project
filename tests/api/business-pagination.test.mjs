import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, approvedFixture } from "../helpers.mjs";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

const query = values => parseListQuery(new URLSearchParams(values));

test("demand SQL search filters full location snapshots before pagination and retains deleted history", t => {
  const { s, user, save, operation } = fixture(t);
  const ids = [];
  s.repo.transaction(() => {
    for (let index = 0; index < 45; index++) {
      const tower = save("physical", { asset_no: "分页位置" + index });
      const demand = s.demands.save(user, {
        operation_id: operation.id, problem_description: "分页需求" + String(index).padStart(3, "0"),
        completion_standard: "验收", sources: [{ description: "独立测试" }],
        work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
      });
      ids.push(demand.id);
    }
  });
  const page = s.demands.search(query({ q: "分页需求", sort: "problem_description", direction: "asc", page: "3", page_size: "20" }));
  assert.equal(page.total, 45);
  assert.equal(page.items.length, 5);
  assert.equal(page.items[0].problem_description, "分页需求040");
  assert.equal(page.items[0].work_locations.length, 1);
  const filtered = s.demands.search(query({ filters: JSON.stringify({ problem_description: "044" }) }));
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, ids[44]);
  const victim = s.demands.get(ids[44]);
  s.demands.transition(user, victim.id, { expected_version: victim.current_version, expected_event_seq: 1, status: "cancelled" });
  s.demands.remove(user, victim.id, { expected_version: victim.current_version });
  assert.equal(s.demands.search(query({ q: "分页需求044" })).total, 0);
  assert.equal(s.demands.search(query({ q: "分页需求044", deleted: "true" })).items[0].deleted, true);
  assert.equal(s.demands.search(query({ sort: 'name"; DROP TABLE demands', page: "1.5" })).page, 1);
  assert.equal(s.repo.integrity().foreignKeys.length, 0);
});

test("project SQL list keeps current approval and binding without loading all detail histories", t => {
  const { s, user, project, demand, framework } = approvedFixture(t);
  for (let index = 0; index < 40; index++)
    s.projects.save(user, { name: "分页项目" + String(index).padStart(3, "0"), framework_id: framework.id });
  const page = s.projects.search(query({ q: "分页项目", sort: "name", direction: "asc", page: "3", page_size: "15" }));
  assert.equal(page.total, 40);
  assert.equal(page.items.length, 10);
  assert.equal(page.items[0].name, "分页项目030");
  const current = s.projects.search(query({ q: project.name })).items[0];
  assert.equal(current.approval.approved_budget_fen, 120000);
  assert.equal(current.scopes[0].demand_id, demand.id);
  assert.equal(current.scopes[0].binding.project_id, project.id);
  assert.equal(current.approvals, undefined);
  assert.equal(current.profile_version, project.profile_version);
  const detail = s.projects.get(project.id);
  assert.equal(detail.approvals.length, 1);
  assert.equal(detail.approvals[0].scopes.length, 1);
  assert.equal(detail.approvals[0].scopes[0].demand_no, demand.demand_no);
  assert.ok(Array.isArray(detail.approvals[0].scopes[0].materials));
  assert.ok(Array.isArray(detail.approvals[0].scopes[0].locations));
  assert.equal(detail.scopes[0].demand_no, demand.demand_no);
  assert.equal(detail.scopes[0].demand_status, "active");
  assert.equal(detail.scopes[0].binding.project_scope_id, detail.scopes[0].id);
  assert.equal(detail.scopes[0].binding.project_id, project.id);
  assert.equal(detail.scopes[0].binding.demand_id, demand.id);
});

test("cross-project finance queries preserve formal amount, drafts and reference isolation", t => {
  const { s, user, project, approval, scope, node } = approvedFixture(t);
  const cost = s.finance.cost(user, project.id, { cost_node_id: node.id, title: "跨项目查询费用",
    occurred_on: "2026-11-10", amount_fen: 140000, evidence: "测试发票" });
  const found = s.finance.search("costs", query({ q: "跨项目查询费用" }));
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, cost.entry_id);
  assert.equal(found.items[0].project_id, project.id);
  assert.equal(found.items[0].amount_fen, 140000);
  const bill = s.finance.saveDraft(user, project.id, { approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id, quantity_scaled: 10000, amount_fen: 70000, evidence: "本次依据" }],
    resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 10000, evidence: "本次解决" }] });
  const draft = s.finance.search("settlements", query({ q: bill.number })).items[0];
  assert.equal(draft.status, "draft");
  assert.equal(draft.amount_fen, null);
  s.finance.submit(user, bill.id, { expected_version: 0, expected_edit_version: 1 });
  const submitted = s.finance.search("settlements", query({ q: bill.number })).items[0];
  assert.equal(submitted.amount_fen, 70000);
  assert.equal(submitted.status, "submit");
  assert.equal(s.finance.search("reconciliations", query({})).total, 0);
  assert.equal(s.projects.get(project.id).approval.approved_budget_fen, 120000);
});
