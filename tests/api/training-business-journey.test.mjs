import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createSystem} from "../../dist/server/bootstrap.js";
import {httpServer} from "../../dist/server/platform/http/server.js";
import {makeWorkbook} from "../../dist/server/modules/exchange/workbook.js";

test("P10 L01-L12 real isolated training course checkpoints use the full business journey, not unrelated counters",async t=>{
  const root=mkdtempSync(join(tmpdir(),"sd-p10-full-journey-"));
  const dir=join(root,"training");
  mkdirSync(dir);
  const id="d".repeat(32);
  writeFileSync(join(dir,"TRAINING-INSTANCE.json"),JSON.stringify({purpose:"sd-project-isolated-training",id}));
  const before={id:process.env.SD_TRAINING_INSTANCE_ID,dir:process.env.SD_TRAINING_DATA_DIR};
  process.env.SD_TRAINING_INSTANCE_ID=id;
  process.env.SD_TRAINING_DATA_DIR=dir;
  t.after(()=>{
    for(const [name,value] of [["SD_TRAINING_INSTANCE_ID",before.id],["SD_TRAINING_DATA_DIR",before.dir]])
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    rmSync(root,{recursive:true,force:true});
  });
  const s=createSystem(dir);
  t.after(()=>s.close());
  s.auth.initialize("trainer","Training-full-journey!2026");
  const {user}=s.auth.login("trainer","Training-full-journey!2026");
  const save=(kind,payload)=>s.catalog.save(user,kind,payload);
  const done=(id,actor=user)=>{
    const result=s.training.checkpoints(actor.id);
    assert.equal(result.training,true);
    return result.courses.find(c=>c.id===id)?.completed;
  };
  assert.equal(s.training.checkpoints(user.id).courses.filter(c=>c.completed).length,0);
  const unit=save("units",{name:"套",quantity_precision:0});
  const object=save("objects",{name:"杆塔防鸟治理",object_position:"body",attribution_unit:"physical_tower"});
  assert.equal(done("L01"),true);
  const voltage=save("voltages",{name:"220kV"});
  const line=save("lines",{name:"P10训练甲线",voltage_level_id:voltage.id});
  const start=save("towers",{line_id:line.id,tower_no:"#1",
    physical_properties:{tower_material:"angle",tower_nature:"tension"}});
  const end=save("towers",{line_id:line.id,tower_no:"#2",
    physical_properties:{tower_material:"pipe",tower_nature:"straight"}});
  save("physical",{asset_no:"P10-REAL-PHYSICAL",tower_material:"angle"});
  save("materials",{name:"训练专用防鸟装置",unit_id:unit.id});
  assert.equal(done("L02"),false,"Unconnected lines and towers alone are insufficient");
  save("spans",{line_id:line.id,start_tower_id:start.id,end_tower_id:end.id,
    transmission_center_length_mm:320000,status:"active"});
  assert.equal(done("L02"),true);
  const operation=save("operations",{name:"训练防鸟装置安装",work_object_id:object.id,
    default_unit_id:unit.id,completion_standard:"安装牢固"});
  save("prices",{title:"训练安装参考价",operation_id:operation.id,
    pricing_mode:"base_plus_unit",base_fee_fen:1000,unit_price_fen:2000,
    price_source:"内部测试",price_date:"2026-11-12",effective_on:"2026-11-12",basis:"训练核价"});
  assert.equal(done("L03"),true);
  const demand=s.demands.save(user,{operation_id:operation.id,problem_description:"两处需要防鸟治理",
    expected_on:"2027-02-28",
    completion_standard:"装置牢固",work_locations:[
      {location_kind:"physical_tower",physical_tower_id:start.physical_tower_id,quantity_scaled:20000},
      {location_kind:"physical_tower",physical_tower_id:end.physical_tower_id,quantity_scaled:10000},
    ],sources:[{description:"训练巡视"}]});
  assert.equal(done("L04"),true);
  assert.equal(done("L05"),false);
  s.demands.transition(user,demand.id,{expected_version:1,expected_event_seq:1,status:"active"});
  assert.equal(done("L05"),true);
  const framework=save("frameworks",{name:"P10训练年度框架",fiscal_year:2026,limit_fen:500000});
  const agreement=save("agreements",{name:"P10训练执行协议",framework_id:framework.id,limit_fen:350000});
  let project=s.projects.save(user,{name:"P10防鸟训练子项目",framework_id:framework.id});
  project=s.projects.link(user,project.id,{demand_id:demand.id,expected_version:1});
  assert.equal(done("L06"),false,"An unfunded project must not count as the complete framework-agreement-project chain");
  project=s.projects.fund(user,project.id,{agreement_id:agreement.id,expected_version:0});
  assert.equal(done("L06"),true);
  project=s.projects.stock(user,project.id,{expected_version:1});
  const scope=project.scopes[0];
  project=s.projects.approvalDraft(user,project.id,{expected_version:2,approved_budget_fen:180000,
    scopes:[{project_scope_id:scope.id,demand_version:1,locations:[
      {location_item_no:1,approved_quantity_scaled:20000},
      {location_item_no:2,approved_quantity_scaled:10000}]}]});
  const original=project.approvals[0];
  project=s.projects.approve(user,project.id,original.id,{expected_version:2});
  assert.equal(done("L07"),false,"First approval is not a formal change");
  project=s.projects.approvalDraft(user,project.id,{
    expected_version:3,expected_approval_version_id:original.id,approved_budget_fen:200000,
    confirm_changes:true,
    scopes:[{project_scope_id:scope.id,demand_version:1,locations:[
      {location_item_no:1,approved_quantity_scaled:20000},
      {location_item_no:2,approved_quantity_scaled:10000}]}],
  });
  const change=project.approvals.find(a=>a.status==="draft");
  assert.ok(change);
  project=s.projects.approve(user,project.id,change.id,{expected_version:3});
  assert.equal(done("L07"),true);
  const node=s.finance.node(user,project.id,{name:"人工费"});
  const cost=s.finance.cost(user,project.id,{cost_node_id:node.id,title:"已核定人工费",
    occurred_on:"2026-11-12",amount_fen:160000,evidence:"训练现场确认"});
  assert.equal(done("L08"),true);
  const bills=[];
  for(const [index,amount] of [40000,50000].entries()){
    let bill=s.finance.saveDraft(user,project.id,{
      number:"P10-TRAIN-SETTLE-"+(index+1),approval_version_id:change.id,
      items:[{cost_node_id:node.id,project_scope_id:scope.id,quantity_scaled:10000,
        amount_fen:amount,evidence:"训练分次结算证明"}],
      resolutions:[{project_scope_id:scope.id,resolved_quantity_scaled:10000,evidence:"训练现场复核"}],
    });
    bill=s.finance.submit(user,bill.id,{expected_version:0,expected_edit_version:1});
    bill=s.finance.review(user,bill.id,{expected_version:1,expected_event_seq:1,action:"approve"});
    bills.push(bill);
  }
  assert.equal(done("L09"),true);
  assert.equal(done("L10"),false);
  s.finance.reconciliation(user,{expected_version:0,cost_version_id:cost.id,
    settlement_item_version_id:bills[0].items[0].id,reconciled_cost_fen:40000,
    reconciled_settlement_fen:40000,is_final:true,evidence:"训练核对差异"});
  assert.equal(done("L10"),false,"Reconciliation without formal project closure is insufficient");
  const closed=s.projectClosure.commit(user,project.id,{preview_hash: s.projectClosure.preview(user, project.id).preview_hash, expected_version:project.version});
  assert.equal(closed.status,"closed");
  assert.equal(done("L10"),true);
  const server=httpServer(s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>await new Promise(resolve=>server.close(resolve)));
  const url="http://127.0.0.1:"+server.address().port;
  const viewer=s.management.saveUser(user,{username:"train-viewer",password:"Training-viewer!2026",role:"viewer",status:"active"});
  const login=await fetch(url+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"train-viewer",password:"Training-viewer!2026"})});
  assert.equal(login.status,200);
  const headers={cookie:login.headers.get("set-cookie").split(";")[0],"content-type":"application/json"};
  assert.equal(done("L12",viewer),false);
  const forbidden=await fetch(url+"/api/catalog/units",{method:"POST",headers,
    body:JSON.stringify({name:"拒绝的写入"})});
  assert.equal(forbidden.status,403);
  assert.equal(done("L12",viewer),true);
  assert.equal(s.catalog.list("units").length,1,"Viewer 403 never creates a unit");

  // Complete L11 against the same running training instance through real HTTP.
  const importRef="P10-FINAL-EXCEL";
  async function preview(assetNo) {
    const workbook=await makeWorkbook("demands",{
      documents:[{import_ref:importRef,operation_name:operation.name,
        problem_description:"P10 Excel完整业务训练",completion_standard:"安装牢固"}],
      work_locations:[{import_ref:importRef,location_kind:"physical_tower",
        asset_no:assetNo,quantity_scaled:10000,work_mode:"non_outage"}],
    });
    const auth=await fetch(url+"/api/login",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:"trainer",password:"Training-full-journey!2026"})});
    const cookie=auth.headers.get("set-cookie").split(";")[0];
    const response=await fetch(url+"/api/exchange/demands/preview",{
      method:"POST",headers:{cookie,"content-type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},body:workbook});
    assert.equal(response.status,200,await response.clone().text());
    return {cookie,result:await response.json()};
  }
  const invalid=await preview("P10-MISSING-PHYSICAL");
  assert.ok(invalid.result.issues.length>0);
  assert.equal(done("L11"),false);
  const fixed=await preview("P10-REAL-PHYSICAL");
  assert.equal(fixed.result.issues.length,0,JSON.stringify(fixed.result.issues));
  const committed=await fetch(url+"/api/exchange/"+fixed.result.token+"/commit",{
    method:"POST",headers:{cookie:fixed.cookie,"content-type":"application/json"},
    body:JSON.stringify({request_key:"p10-journey-last-import",atomic:true})});
  assert.equal(committed.status,200,await committed.clone().text());
  assert.equal(done("L11"),true);
  for(const course of s.training.checkpoints(user.id).courses)
    if(course.id!=="L12")assert.equal(course.completed,true,course.id+" must be completed for the real admin journey");
  assert.equal(done("L12",viewer),true);
});
