import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";
import {parseProjectLinkBatch} from "../../dist/server/modules/projects/requests.js";
import {inspect} from "../inspector.mjs";

function prepare(t,number=3){
  const {s,user,save,operation}=fixture(t);
  const framework=save("frameworks",{name:"需求批量关联事务框架",fiscal_year:2026,limit_fen:200000});
  const project=s.projects.save(user,{name:"需求批量关联验收项目",framework_id:framework.id});
  const demands=[];
  for(let index=0;index<number;index++){
    const tower=save("physical",{tower_code:"BATCH-SELECT-"+index});
    const demand=s.demands.save(user,{
      operation_id:operation.id,
      problem_description:"批量待承接需求"+index,
      work_locations:[{
        location_kind:"physical_tower",physical_tower_id:tower.id,
        quantity_scaled:10000+(index%4)*10000,
      }],
      sources:[{description:"验收模拟巡视记录"+index}],
    });
    s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
    demands.push(demand);
  }
  return {s,user,save,framework,project,demands};
}
function links(demands){
  return demands.map(row=>({demand_id:row.id,expected_version:row.current_version}));
}
test("batch link adopts several full demands with one request and immutable quantity facts",t=>{
  const {s,user,project,demands}=prepare(t,4);
  const result=s.projects.linkMany(user,project.id,{links:links(demands)});
  assert.equal(result.scopes.filter(row=>row.binding).length,4);
  for(const demand of demands){
    const link=result.scopes.find(row=>row.demand_id===demand.id);
    assert.ok(link?.binding);
    assert.equal(link.proposed_quantity_scaled,demand.quantity_scaled);
    assert.equal(s.demands.get(demand.id).binding?.project_id,project.id);
  }
  assert.deepEqual(inspect(s).integrity().foreignKeys,[]);
});
test("a stale or already-bound demand rejects ALL batch links without partial records",t=>{
  const {s,user,save,framework,project,demands}=prepare(t,3);
  assert.throws(()=>s.projects.linkMany(user,project.id,{links:[
    links(demands)[0],{...links(demands)[1],expected_version:999},links(demands)[2],
  ]}),/版本|更新|冲突/);
  assert.equal(s.projects.get(project.id).scopes.length,0);
  assert.ok(demands.every(row=>!s.demands.get(row.id).binding));
  const other=s.projects.save(user,{name:"其他项目",framework_id:framework.id});
  s.projects.link(user,other.id,links(demands)[2]);
  assert.throws(()=>s.projects.linkMany(user,project.id,{links:links(demands)}),/关联|承接/);
  assert.equal(s.projects.get(project.id).scopes.length,0);
  assert.equal(s.demands.get(demands[0].id).binding,null);
  assert.equal(s.demands.get(demands[1].id).binding,null);
});
test("batch DTO rejects duplicates, fractional fulfillment and invalid group sizes",()=>{
  const first={demand_id:"d1",expected_version:1};
  assert.throws(()=>parseProjectLinkBatch({links:[first,first]}),/重复/);
  assert.throws(()=>parseProjectLinkBatch({links:[{...first,quantity_scaled:5000}]}),/整体承接/);
  assert.throws(()=>parseProjectLinkBatch({links:[]}),/1～100/);
  assert.throws(()=>parseProjectLinkBatch({links:[{demand_id:"d1"}]}),/版本/);
  assert.throws(()=>parseProjectLinkBatch({links:Array.from({length:101},(_,i)=>({
    demand_id:"D"+i,expected_version:1,
  }))}),/1～100/);
});
test("authenticated HTTP batch route is atomic and rejects stale second item",async t=>{
  const {s,user,project,demands}=prepare(t,2);
  const server=httpServer(s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>new Promise(resolve=>server.close(resolve)));
  const base="http://127.0.0.1:"+server.address().port;
  const login=await fetch(base+"/api/login",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"admin",password:"Schema113-test-password"}),
  });
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  let requestNo=0;
  async function post(entries){
    return fetch(base+"/api/projects/"+project.id+"/link-batch",{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie,
        "Idempotency-Key":"batch-link-contract-"+(++requestNo)},
      body:JSON.stringify({links:entries}),
    });
  }
  const failed=await post([links(demands)[0],{...links(demands)[1],expected_version:33}]);
  assert.notEqual(failed.status,200);
  assert.equal(s.projects.get(project.id).scopes.length,0);
  const ok=await post(links(demands));
  const responseText=await ok.text();
  assert.equal(ok.status,200,responseText);
  const result=JSON.parse(responseText);
  assert.equal((result.scopes??result.data?.scopes??[]).length,2);
  assert.equal(s.projects.get(project.id).scopes.length,2);
});
