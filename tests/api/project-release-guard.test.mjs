import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, approvedFixture } from "../helpers.mjs";

test("approved in-progress project refuses release before SQLite, preserving binding", t => {
  const { s, user, project, scope, demand } = approvedFixture(t);
  assert.throws(
    () => s.projects.release(user, project.id, scope.id, {expected_event_seq:1}),
    error => {
      assert.match(error.message, /已正式批准的在办项目不得解绑已批准需求，剩余需求仅在正式结项后释放/);
      assert.doesNotMatch(error.message, /ERR_SQLITE_ERROR|constraint failed/);
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(s.demands.get(demand.id).binding.project_id, project.id);
  assert.equal(s.projects.get(project.id).scopes.find(row=>row.id===scope.id).binding.project_id,project.id);
});

test("release before project approval remains allowed and demand can be re-adopted", t => {
  const {s,user,save,demandInput}=fixture(t);
  const demand=s.demands.save(user,demandInput);
  s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
  const framework=save("frameworks",{code:"RL-26",name:"解绑测试框架",fiscal_year:2026,limit_fen:150000});
  let project=s.projects.save(user,{code:"REL-A",name:"尚未批准项目",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  const scope=project.scopes[0];
  s.projects.release(user,project.id,scope.id,{expected_event_seq:1});
  assert.equal(s.demands.get(demand.id).binding,null);
  assert.equal(s.projects.get(project.id).scopes[0].binding,null);
});

test("approval draft containing a linked demand blocks release before formal approval", t => {
  const {s,user,save,demandInput}=fixture(t);
  const demand=s.demands.save(user,demandInput);
  s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
  const framework=save("frameworks",{code:"RL-27",name:"草稿测试框架",fiscal_year:2027,limit_fen:250000});
  let project=s.projects.save(user,{code:"REL-D",name:"存在立项草稿",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  const scope=project.scopes[0];
  project=s.projects.stock(user,project.id,{expected_version:1});
  s.projects.approvalDraft(user,project.id,{
    expected_version:2,approved_budget_fen:100000,
    scopes:[{project_scope_id:scope.id,demand_version:1,locations:demand.work_locations.map((loc,index)=>({
      location_item_no:index+1,approved_quantity_scaled:loc.quantity_scaled,
    }))}],
  });
  assert.throws(
    () => s.projects.release(user,project.id,scope.id,{expected_event_seq:1}),
    /仍有立项或变更草稿引用需求/,
  );
  assert.ok(s.demands.get(demand.id).binding);
});

test("closed project releases unfinished demand without rewriting its approval or link history", async t => {
  const { s, user, project, scope, demand } = approvedFixture(t);
  const preview = s.projectClosure.preview(user, project.id);
  assert.equal(preview.release_demands.length, 1);
  s.projectClosure.commit(user, project.id, {
    preview_hash: preview.preview_hash, expected_version: project.version,
  });
  assert.equal(s.demands.get(demand.id).binding, null);
  const { inspect } = await import("../inspector.mjs");
  assert.deepEqual(inspect(s).where("project_demand_link_events", {
    project_scope_id: scope.id,
  }).map(event => event.action), ["linked", "released"]);
  assert.equal(inspect(s).where("project_approval_scope_versions", {
    project_scope_id: scope.id,
  }).length, 1);
  assert.throws(() => s.projects.release(user, project.id, scope.id, { expected_event_seq: 1 }),
    error => error.status === 409 && /未关联|已结项/.test(error.message));
  assert.throws(() => inspect(s).insert("project_demand_link_events", {
    id: "rejected-closed-release", project_scope_id: scope.id, event_seq: 3,
    action: "released", actor_id: user.id, recorded_at: new Date().toISOString(),
  }), /交替|当前未关联/);
  const { httpServer } = await import("../../dist/server/platform/http/server.js");
  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const token = s.auth.login("admin", "Schema113-test-password").token;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/release/${scope.id}`, {
    method: "POST", headers: { Cookie: "sd113=" + token, "Content-Type": "application/json", "Idempotency-Key": "closed-release-block" },
    body: JSON.stringify({ expected_event_seq: 1 }),
  });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /未关联|已结项/);
  const successor = s.projects.save(user, { name: "接续治理项目", framework_id: project.framework_id });
  const next = s.projects.link(user, successor.id, { demand_id: demand.id,
    expected_version: demand.current_version });
  assert.equal(s.demands.get(demand.id).binding?.project_id, successor.id);
  assert.equal(next.scopes[0].proposed_quantity_scaled, demand.quantity_scaled);
});
