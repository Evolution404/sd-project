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
    ...demandInput,duplicate_decision:"separate",duplicate_matches:[original.demand_no],
  }),/疑似重复/);
  const saved=s.demands.save(user,{
    ...demandInput,duplicate_decision:"separate",duplicate_matches:[original.demand_no],
    duplicate_reason:"不同发现批次，分别组织现场处理和验收",
  });
  const reviews=inspect(s).list("demand_duplicate_reviews");
  assert.notEqual(saved.id,original.id);
  assert.equal(reviews.length,1);
  assert.equal(reviews[0].matched_demand_id,original.id);
  assert.match(reviews[0].reason,/不同发现批次/);
});
