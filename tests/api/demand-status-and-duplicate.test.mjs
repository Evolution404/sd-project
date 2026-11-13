import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture, approvedFixture} from "../helpers.mjs";
import {inspect} from "../inspector.mjs";

const query = state => ({
  page:1, page_size:30, q:"", sort:"created_at", direction:"desc",
  filters:state ? {display_status:state} : {}, deleted:false,
});

test("five demand display states use the lifecycle and binding, not a redundant stored status", t => {
  const {s,user,save,demandInput,demand:bound} = approvedFixture(t);
  const states = ["待确认","已退回","待承接","已取消"];
  for (const [index,state] of states.entries()) {
    const tower = save("physical",{asset_no:"STATUS-"+index,tower_material:"angle"});
    const row = s.demands.save(user,{
      ...demandInput,problem_description:"状态验收："+state,
      work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}],
    });
    if (state !== "待确认") s.demands.transition(user,row.id,{
      expected_version:1,expected_event_seq:1,
      status:state === "已退回" ? "returned" : state === "待承接" ? "active" : "cancelled",
    });
  }
  const all = s.demands.search(query());
  assert.equal(all.total,5);
  assert.deepEqual(new Set(all.items.map(x => x.display_status)),new Set([...states,"已承接"]));
  assert.equal(all.items.find(x => x.id === bound.id).display_status,"已承接");
  assert.ok(all.items.every(x => !Object.hasOwn(x,"handling_view")));
  assert.deepEqual(new Set(all.items.filter(x => x.status === "active").map(x => x.display_status)),
    new Set(["待承接","已承接"]));
  for (const state of [...states,"已承接"]) {
    const rows = s.demands.search(query(state));
    assert.equal(rows.total,1,state);
    assert.equal(rows.items[0].display_status,state);
  }
  assert.ok(s.demands.search(query("待确认")).items.every(x => x.status === "pending"));
  assert.ok(s.demands.search(query("已承接")).items.every(x => !!x.binding));
  assert.ok(s.demands.search(query("待承接")).items.every(x => !x.binding));
});

test("duplicate review supplies matching record IDs and stores mandatory independent rationale",t => {
  const {s,user,demandInput}=fixture(t);
  const original=s.demands.save(user,demandInput);
  assert.throws(() => s.demands.save(user,{...demandInput,problem_description:"另一现场任务"}),err => {
    assert.deepEqual(err.fields.duplicates,[original.demand_no]);
    assert.deepEqual(err.fields.duplicate_ids,[original.id]);
    return true;
  });
  assert.throws(() => s.demands.save(user,{
    ...demandInput,duplicate_review_tokens: {[original.id]:s.demands.review(original.id).duplicate_review_token},
    duplicate_decision:"separate",duplicate_matches:[original.demand_no],
  }),/疑似重复/);
  const saved=s.demands.save(user,{
    ...demandInput,duplicate_review_tokens: {[original.id]:s.demands.review(original.id).duplicate_review_token},
    duplicate_decision:"separate",duplicate_matches:[original.demand_no],
    duplicate_reason:"不同发现批次，分别组织现场处理和验收",
  });
  const reviews=inspect(s).list("demand_duplicate_reviews");
  assert.notEqual(saved.id,original.id);
  assert.equal(reviews.length,1);
  assert.equal(reviews[0].matched_demand_id,original.id);
  assert.match(reviews[0].reason,/不同发现批次/);
});

for (const change of ["version", "source", "lifecycle", "binding"]) {
  test(`duplicate decision refuses stale ${change} facts atomically and accepts a fresh review`, t => {
    const { s, user, save, demandInput } = fixture(t);
    const original = s.demands.save(user, demandInput);
    const reviewed = s.demands.review(original.id).duplicate_review_token;
    if (change === "version") s.demands.save(user, { ...demandInput, expected_version: 1,
      problem_description: "核对期间由另一人员更新的事实" }, original.id);
    if (change === "source") s.sources.revise(user, original.sources[0].id, { description: "核对期间更正的真实来源" });
    if (["lifecycle", "binding"].includes(change)) s.demands.transition(user, original.id,
      { expected_version: 1, expected_event_seq: 1, status: "active" });
    if (change === "binding") {
      const framework = save("frameworks", { name: "重复核对框架", fiscal_year: 2026, limit_fen: 1 });
      const project = s.projects.save(user, { framework_id: framework.id, name: "核对期间承接项目" });
      s.projects.link(user, project.id, { demand_id: original.id, expected_version: 1 });
    }
    const decision = { ...demandInput, problem_description: "独立现场问题", duplicate_decision: "separate",
      duplicate_matches: [original.demand_no], duplicate_reason: "不同发现事实，分别处置",
      duplicate_review_tokens: { [original.id]: reviewed } };
    const before = inspect(s).list("audit_events").length;
    assert.throws(() => s.demands.save(user, decision), error => error.status === 409 && /最新正式记录/.test(error.message));
    assert.equal(s.demands.list().length, 1);
    assert.equal(inspect(s).list("demand_duplicate_reviews").length, 0);
    assert.equal(inspect(s).list("audit_events").length, before);
    const current = s.demands.review(original.id).duplicate_review_token;
    const saved = s.demands.save(user, { ...decision, duplicate_review_tokens: { [original.id]: current } });
    assert.notEqual(saved.id, original.id);
    assert.equal(inspect(s).list("demand_duplicate_reviews").length, 1);
    assert.throws(() => s.demands.save(user, { ...decision, expected_version: 0 }, saved.id), /版本冲突/);
    assert.throws(() => s.demands.save(user, { ...decision, duplicate_matches: "invalid" }), /需求编号列表/);
  });
}
