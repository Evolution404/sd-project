import {test} from "node:test";
import assert from "node:assert/strict";
import {approvedFixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

test("candidate APIs do not truncate large catalogues before eligibility filtering and pagination",async t=>{
 const f=approvedFixture(t),{s,user,framework,project,operation,demand}=f;
 // The valid approved project was created before the 320 reserve projects.
 for(let i=0;i<320;i++)s.projects.save(user,{name:"候选测试储备"+String(i).padStart(3,"0"),framework_id:framework.id});
 // Distinct physical assets make the records true independent business demands.
 for(let i=0;i<265;i++){
   const tower=f.save("physical",{asset_no:"候选位置"+i});
   const row=s.demands.save(user,{operation_id:operation.id,problem_description:"候选测试需求"+String(i).padStart(3,"0"),
     expected_on:"2026-12-31",completion_standard:"安装牢固",sources:[{description:"专项候选验收"}],
     work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}]});
   if(i%2===0)s.demands.transition(user,row.id,{expected_version:1,expected_event_seq:1,status:"active"});
 }
 const server=httpServer(s);
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 t.after(()=>new Promise(ok=>server.shutdown(ok)));
 const origin="http://127.0.0.1:"+server.address().port;
 const login=await fetch(origin+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({username:"admin",password:"Schema113-test-password"})});
 const headers={Cookie:login.headers.get("set-cookie").split(";")[0]};
 async function get(path,query){
   const r=await fetch(origin+"/api/"+path+"?"+new URLSearchParams(query),{headers});
   assert.equal(r.status,200);return r.json();
 }
 const approved=await get("projects",{page:1,page_size:20,filters:JSON.stringify({status:"approved"})});
 assert.equal(approved.total,1);
 assert.equal(approved.items[0].id,project.id);
 assert.ok(approved.items[0].approval);
 const seen=new Set();
 for(let page=1;page<=14;page++){
   const data=await get("demands/candidates",{page,page_size:20,include_pending:"true",q:"候选测试需求",sort:"problem_description",direction:"asc"});
   assert.equal(data.total,265);
   for(const row of data.items){
     assert.ok(!seen.has(row.id));seen.add(row.id);assert.ok(!row.binding);
     assert.equal(row.location_count,1);
   }
   if(page===14)assert.equal(data.items.length,5);
 }
 assert.equal(seen.size,265);
 const active=await get("demands/candidates",{page:7,page_size:20,q:"候选测试需求"});
 assert.equal(active.total,133);assert.equal(active.items.length,13);assert.ok(active.items.every(r=>r.status==="active"));
 const unbound=await get("demands/candidates",{page_size:20,include_pending:"true",q:demand.demand_no});
 assert.equal(unbound.total,0,"already linked demand must not be a candidate");
});
