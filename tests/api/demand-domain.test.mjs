import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

function page(query = {}) {
  return parseListQuery(new URLSearchParams(query));
}

test("project-demand selector searches all 260 eligible identities without hidden truncation", (t) => {
  const { s, user, save, operation } = fixture(t);
  const physical = s.database.transaction(() => Array.from({length:260},(_,n)=>
    save("physical",{asset_no:"批量杆塔-"+String(n).padStart(3,"0"),tower_type:"angle"})
  ));
  const created = s.database.transaction(() => physical.map((tower,index) => s.demands.save(user,{
    operation_id:operation.id,
    problem_description:"候选规模专项 "+String(index).padStart(3,"0"),
    completion_standard:"安装牢固",
    work_locations:[{
      location_kind:"physical_tower",
      physical_tower_id:tower.id,
      quantity_scaled:10000
    }]
  })));
  const first = s.demands.searchCandidates(page({page:"1",page_size:"50"}), true);
  assert.equal(first.total,260);
  assert.equal(first.items.length,50);
  const last = s.demands.searchCandidates(page({page:"6",page_size:"50"}),true);
  assert.equal(last.total,260);
  assert.equal(last.items.length,10);
  const allIds = new Set(Array.from({length:6},(_,n)=>
    s.demands.searchCandidates(page({page:String(n+1),page_size:"50"}),true).items
  ).flat().map(x=>x.id));
  assert.equal(allIds.size,260);
  assert.equal(s.demands.searchCandidates(page({page_size:"50"})).total,0,"unconfirmed candidates are hidden by default");
  const accepted = s.demands.transition(user,created[0].id,{
    status:"active", expected_version:1,expected_event_seq:1
  });
  assert.equal(accepted.status,"active");
  const active = s.demands.searchCandidates(page({page_size:"50"}));
  assert.equal(active.total,1);
  assert.equal(active.items[0].id,accepted.id);
  assert.equal(s.demands.searchCandidates(page({q:"候选规模专项 259"}),true).items[0].id,created[259].id);
  assert.equal(s.demands.searchCandidates(page({q:operation.name}),true).total,260);

  const framework=save("frameworks",{code:"P4CAND", fiscal_year:2026,name:"候选验证框架",limit_fen:100000});
  const project=s.projects.save(user,{name:"候选关联项目",framework_id:framework.id});
  s.projects.link(user,project.id,{demand_id:accepted.id,expected_version:1});
  assert.equal(s.demands.searchCandidates(page({page_size:"50"})).total,0,
    "a demand already bound to a project must disappear from candidate results");
  assert.equal(s.demands.searchCandidates(page({page_size:"50"}),true).total,259);
  assert.equal(s.demands.get(accepted.id).binding.project_id,project.id);
});

test("source correction retains original provenance and demand history reads remain intact", t=>{
  const {s,user,demandInput} = fixture(t);
  const demand=s.demands.save(user,demandInput);
  const source=demand.sources[0];
  const revised=s.sources.revise(user,source.id,{description:"现场证据已复核"});
  assert.notEqual(revised.id,source.id);
  assert.equal(s.demands.get(demand.id).sources.length,1);
  assert.equal(s.demands.get(demand.id).sources[0].description,"现场证据已复核");
  const history=s.demands.history(demand.id);
  assert.equal(history.sources.length,2);
  assert.equal(history.versions.length,1);
  assert.ok(history.sources.some(s=>s.id===source.id && s.superseded));
  assert.throws(()=>s.sources.revise(user,source.id,{description:"覆盖旧版"}),/已有更正版/);
});
