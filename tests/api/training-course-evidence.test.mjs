import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createSystem} from "../../dist/server/bootstrap.js";
import {httpServer} from "../../dist/server/platform/http/server.js";
import {makeWorkbook} from "../../dist/server/modules/exchange/workbook.js";

test("L11 training strictly requires invalid workbook, corrected preview and successful commit of that exact batch",async t=>{
  const root=mkdtempSync(join(tmpdir(),"sd-p10-l11-real-http-"));
  const data=join(root,"training");mkdirSync(data);
  const id="c".repeat(32);
  writeFileSync(join(data,"TRAINING-INSTANCE.json"),JSON.stringify({
    purpose:"sd-project-isolated-training",id,
  }));
  const oldId=process.env.SD_TRAINING_INSTANCE_ID,oldDir=process.env.SD_TRAINING_DATA_DIR;
  process.env.SD_TRAINING_INSTANCE_ID=id;
  process.env.SD_TRAINING_DATA_DIR=data;
  t.after(()=>{
    if(oldId===undefined)delete process.env.SD_TRAINING_INSTANCE_ID;
    else process.env.SD_TRAINING_INSTANCE_ID=oldId;
    if(oldDir===undefined)delete process.env.SD_TRAINING_DATA_DIR;
    else process.env.SD_TRAINING_DATA_DIR=oldDir;
    rmSync(root,{recursive:true,force:true});
  });
  const s=createSystem(data);
  t.after(()=>s.close());
  s.auth.initialize("trainer","TRAINING-evidence!2026");
  const {user}=s.auth.login("trainer","TRAINING-evidence!2026");
  const unit=s.catalog.save(user,"units",{name:"套",quantity_precision:0});
  const obj=s.catalog.save(user,"objects",{
    name:"防鸟作业对象",object_position:"body",attribution_unit:"physical_tower",
  });
  const operation=s.catalog.save(user,"operations",{
    name:"训练设施安装",work_object_id:obj.id,default_unit_id:unit.id,
  });
  s.catalog.save(user,"physical",{asset_no:"TRAIN-T1",tower_material:"angle"});
  s.catalog.save(user,"physical",{asset_no:"TRAIN-T2",tower_material:"pipe"});
  const server=httpServer(s);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>await new Promise(resolve=>server.close(resolve)));
  const url="http://127.0.0.1:"+server.address().port;
  const login=await fetch(url+"/api/login",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"trainer",password:"TRAINING-evidence!2026"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const headers={cookie};
  async function workbook(assetNo,importRef="TRAIN-L11-001"){
    return makeWorkbook("demands",{
      documents:[{import_ref:importRef,operation_name:operation.name,
        problem_description:"P10纠错训练",completion_standard:"安装牢固"}],
      work_locations:[{import_ref:importRef,action:"upsert",
        location_kind:"physical_tower",asset_no:assetNo,
        quantity_scaled:10000,work_mode:"non_outage"}],
    });
  }
  async function upload(buffer){
    const res=await fetch(url+"/api/exchange/demands/preview",{
      method:"POST",headers:{...headers,"content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
      body:buffer});
    const body=await res.json();
    assert.equal(res.status,200,JSON.stringify(body));
    return body;
  }
  async function checkpoint(){
    const response=await fetch(url+"/api/training/checkpoints",{headers});
    assert.equal(response.status,200);
    const value=await response.json();
    assert.equal(value.training,true);
    return value.courses.find(c=>c.id==="L11").completed;
  }
  assert.equal(await checkpoint(),false);
  // A valid preview before an invalid preview MUST NOT be counted as a correction.
  const before=await upload(await workbook("TRAIN-T2","TRAIN-L11-BEFORE"));
  assert.equal(before.summary.invalid_documents,0);
  assert.equal(await checkpoint(),false);
  const invalid=await upload(await workbook("MISSING-TOWER"));
  assert.ok(invalid.summary.invalid_documents>0||invalid.issues.length>0);
  assert.equal(s.demands.list().length,0,"Preflight never writes formal demands");
  assert.equal(await checkpoint(),false);
  const corrected=await upload(await workbook("TRAIN-T1"));
  assert.equal(corrected.summary.invalid_documents,0,JSON.stringify(corrected.issues));
  assert.equal(await checkpoint(),false);
  const wrong=await fetch(url+"/api/exchange/"+before.token+"/commit",{
    method:"POST",headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify({request_key:"p10-wrong-batch",atomic:true})});
  assert.equal(wrong.status,200,await wrong.clone().text());
  assert.equal(await checkpoint(),false,"An unrelated older valid batch cannot complete the checkpoint");
  const commit=await fetch(url+"/api/exchange/"+corrected.token+"/commit",{
    method:"POST",headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify({request_key:"p10-corrected-batch",atomic:true})});
  const committed=await commit.json();
  assert.equal(commit.status,200,JSON.stringify(committed));
  assert.ok(committed.results.some(row=>row.action==="create"));
  assert.equal(s.demands.list().length,2,"Each distinct import has its own stable business identity");
  assert.equal(await checkpoint(),true);
  assert.ok(s.demands.list().every(d=>d.batch_id));
});
