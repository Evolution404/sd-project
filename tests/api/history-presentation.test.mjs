import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedFixture } from "../helpers.mjs";
import { definitionTables } from "../../dist/server/shared/catalog-definition-display.js";
import { httpServer } from "../../dist/server/platform/http/server.js";

function fact(list, label) {
  return list.find(row => row.label === label)?.value;
}
const money = value => ({ format: "money", value });

test("demand history reads frozen quotes, revisions and project adoption in business terms", t => {
  const { s, user, demand, price, project } = approvedFixture(t);
  const preview = s.pricing.quote(user, demand.id, { expected_version: 1, pricing_date: "2026-11-20" });
  s.pricing.quote(user, demand.id, { expected_version: 1, pricing_date: "2026-11-20",
    confirm: true, preview_hash: preview.preview_hash });
  s.catalog.save(user, "prices", { expected_version: 1, title: "后来改名的价格规则" }, price.id);
  s.demands.save(user, { expected_version: 1, expected_on: "2027-01-31", reason: "配合现场窗口" }, demand.id);
  const target = { kind: "demands", id: demand.id };
  const page = s.history.get(user, target, { page: 1 });
  assert.equal(page.status, "已承接");
  assert.equal(fact(page.context, "当前正式版本"), "第 2 版");
  const revision = s.history.get(user, target, { page: 1, entry: "需求/2" }).selected;
  assert.deepEqual(revision.changes.find(change => change.label === "预计解决时间"), {
    label: "预计解决时间", before: "2026-12-31", after: "2027-01-31",
  });
  assert.equal(revision.reason, "配合现场窗口");
  const id = page.items.find(item => item.title === "确认参考报价").id;
  const quote = s.history.get(user, target, { page: 1, entry: id }).selected;
  assert.deepEqual(fact(quote.facts, "正式参考报价"), money(48000));
  assert.equal(quote.tables[0].rows[0][1], "每塔基费及套费");
  assert.equal(quote.tables[0].rows[0][2], "1");
  assert.equal(quote.links[0].target.entry, "需求/1");
  assert.equal(quote.links[1].target.entry, "参考价格规则/1");
  assert.match(JSON.stringify(quote.tables), /T15/);
  assert.doesNotMatch(JSON.stringify(quote), /engine_version|snapshot_json|calculation_trace|rule_version_no|password_hash/);
  assert.deepEqual(page.items.filter(row => row.category === "关联").map(row => row.title), ["子项目承接需求"]);
  const approval = s.history.get(user, { kind: "projects", id: project.id }, { page: 1, entry: "项目批准/1" }).selected;
  assert.equal(approval.tables.find(table => table.title === "批准作业位置").rows.length, 3);
  assert.equal(approval.links[0].target.entry, "需求/1");
  assert.equal(approval.tables.find(table => table.title === "本次范围变化").compare, false);
  assert.equal(approval.tables.find(table => table.title === "批准需求范围").compare, undefined);
});

test("price definition displays nested fees, rates and chosen option labels", () => {
  const tables = definitionTables("prices", {
    attributes_schema_json: '[{"key":"scene","label":"作业难度","options":[{"label":"常规","value":"standard"}]}]',
    additional_conditions_json: '{"scene":{"op":"eq","value":"standard"}}',
    fee_components_json: JSON.stringify([
      { coverage_key: "labor", formula_mode: "base_plus_unit", parameters: { base_fee_fen: 1250, unit_price_fen: 5000 } },
      { coverage_key: "transport", formula_mode: "rate", parameters: { rate_basis: "labor", rate_basis_points: 500 } },
      { coverage_key: "进场准备", formula_mode: "quantity_bracket", parameters: { brackets: [
        { min_quantity_scaled: 10000, max_quantity_scaled: null, base_fee_fen: 0, unit_price_fen: 5000 },
      ] } },
    ]),
  });
  const rows = name => tables.find(table => table.title === name)?.rows;
  assert.deepEqual(rows("现场适用条件"), [["作业难度", "等于", "常规"]]);
  assert.deepEqual(rows("费用分项参数"), [
    ["人工费", "单价或定额", money(5000)],
    ["人工费", "基础费", money(1250)],
    ["运输费", "费用计算基数", "人工费"],
    ["运输费", "费用计算比例", "5%"],
  ]);
  assert.equal(rows("费用分项整批数量阶梯")[0][2], "无上限");
});

test("formal settlement history distinguishes approved versions, returns, resubmissions and financial impact", t => {
  const { s, user, project, approval, node } = approvedFixture(t);
  s.finance.cost(user, project.id, { cost_node_id: node.id, title: "核定费用",
    amount_fen: 10000000, occurred_on: "2026-11-01", evidence: "费用凭证" });
  const target = { kind: "settlements", project: project.id };
  const draft = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id, mode: "project_total", amount_fen: 3000000,
  });
  target.id = draft.id;
  const submit = version => s.finance.submit(user, draft.id, {
    expected_version: version, expected_edit_version: s.finance.settlement(draft.id).draft.edit_version,
  });
  const review = (action, version, event, reason) => s.finance.review(user, draft.id, {
    action, expected_version: version, expected_event_seq: event, reason, effective_on: "2026-11-20",
  });
  submit(0);
  review("approve", 1, 1);
  s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id, mode: "project_total", amount_fen: 3600000, expected_version: 1, expected_edit_version: 0,
  }, draft.id);
  submit(1);
  review("return", 2, 1, "需要补充票据");
  let history = s.history.get(user, target, { page: 1, category: "办理" });
  assert.equal(history.status, "已退回");
  assert.equal(fact(history.context, "当前生效版本"), "第 1 版");
  assert.deepEqual(fact(history.context, "当前生效金额"), money(3000000));
  assert.equal(history.selected.reason, "需要补充票据");
  assert.deepEqual(fact(history.selected.facts, "申请金额"), money(3600000));
  s.finance.resubmit(user, draft.id, { expected_version: 2, expected_event_seq: 2 });
  review("approve", 2, 3);
  history = s.history.get(user, target, { page: 1, category: "金额" });
  assert.equal(fact(history.context, "当前生效版本"), "第 2 版");
  assert.deepEqual(fact(history.context, "当前生效金额"), money(3600000));
  assert.deepEqual(fact(history.selected.facts, "对项目已批准结算的净影响"), money(600000));
  assert.equal(s.finance.summary(project.id).settlement_progress_percent, 3000);
  assert.deepEqual(history.selected.tables, []);
  const all = s.history.get(user, target, { page: 1 });
  assert.equal(all.items.filter(row => row.title === "原版本重新送审").length, 1);
  assert.throws(() => s.history.get(user, { ...target, project: "wrong" }, { page: 1 }), /当前项目/);
});

test("history read endpoint enforces authentication, audit role and selection filters", async t => {
  const { s, user, demand } = approvedFixture(t);
  s.auth.saveUser(user, { username: "history-viewer", password: "History-test-viewer!", role: "viewer", status: "active" });
  const viewer = s.auth.login("history-viewer", "History-test-viewer!");
  const audit = s.audit.history("demands", demand.id)[0];
  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/history`;
  assert.equal((await fetch(`${base}/demands/${demand.id}`)).status, 401);
  const headers = { Cookie: `sd113=${viewer.token}` };
  const response = await fetch(`${base}/demands/${demand.id}?category=${encodeURIComponent("办理")}`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map(item => item.title), ["确认需求"]);
  assert.equal((await fetch(`${base}/audit/${audit.id}`, { headers })).status, 403);
  assert.equal((await fetch(`${base}/invalid/${demand.id}`, { headers })).status, 404);
});
