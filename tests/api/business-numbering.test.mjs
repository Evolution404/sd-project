import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

test("business numbers are short, readable, searchable and allocated with their business records", t => {
  const { s, user, demand, project, framework, unit, demandInput } = approvedFixture(t);
  assert.equal(demand.demand_no, "XQ-000001");
  assert.equal(project.code, "XM-000001");
  assert.equal(framework.code, "ND-000001");
  assert.equal(unit.code, "DW-000001");
  assert.match(demand.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(demand.id, demand.demand_no);

  const tower = s.catalog.save(user, "physical", { asset_no: "短编号测试塔" });
  const nextInput = { ...demandInput, work_locations: [{
    location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000,
  }] };
  assert.throws(() => s.database.transaction(() => {
    const row = s.demands.save(user, { ...nextInput, problem_description: "未完成的登记" });
    assert.equal(row.demand_no, "XQ-000002");
    throw new Error("模拟提交失败");
  }), /模拟提交失败/);
  const next = s.demands.save(user, { ...nextInput, demand_no: "不由用户指定", problem_description: "下一张需求" });
  assert.equal(next.demand_no, "XQ-000002");
  const revision = s.demands.save(user, { expected_version: 1, expected_on: "2027-01-05" }, next.id);
  assert.equal(revision.demand_no, next.demand_no);

  const input = { approval_version_id: project.approval.id, mode: "project_total", amount_fen: 5000 };
  const bill = s.finance.saveDraft(user, project.id, input);
  assert.equal(bill.number, "JS-000001");
  s.finance.discardDraft(user, bill.id, { expected_version: 0, expected_edit_version: bill.draft.edit_version });
  const second = s.finance.saveDraft(user, project.id, input);
  assert.equal(second.number, "JS-000002");
  const query = value => parseListQuery(new URLSearchParams({ q: value.toLowerCase() }));
  assert.equal(s.demands.search(query(next.demand_no)).items[0].id, next.id);
  assert.equal(s.projects.search(query(project.code)).items[0].id, project.id);
  assert.equal(s.finance.search("settlements", query(second.number)).items[0].id, second.id);
});
