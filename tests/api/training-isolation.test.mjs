import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createSystem} from "../../dist/server/bootstrap.js";
import {httpServer} from "../../dist/server/platform/http/server.js";

function testEnvironment(t){
  const root=mkdtempSync(join(tmpdir(),"sd-training-isolation-"));
  const training=join(root,"training");
  const normal=join(root,"normal");
  mkdirSync(training);
  const id="b".repeat(32);
  writeFileSync(join(training,"TRAINING-INSTANCE.json"),
    JSON.stringify({purpose:"sd-project-isolated-training",id}));
  const previousId=process.env.SD_TRAINING_INSTANCE_ID;
  const previousDir=process.env.SD_TRAINING_DATA_DIR;
  process.env.SD_TRAINING_INSTANCE_ID=id;
  process.env.SD_TRAINING_DATA_DIR=training;
  t.after(()=>{
    if(previousId===undefined)delete process.env.SD_TRAINING_INSTANCE_ID;
    else process.env.SD_TRAINING_INSTANCE_ID=previousId;
    if(previousDir===undefined)delete process.env.SD_TRAINING_DATA_DIR;
    else process.env.SD_TRAINING_DATA_DIR=previousDir;
    rmSync(root,{recursive:true,force:true});
  });
  return {training,normal,id};
}

test("trusted marker and exact server DATA_DIR required; all 12 course facts start false",t=>{
  const {training,normal}=testEnvironment(t);
  const s=createSystem(training);
  t.after(()=>s.close());
  s.auth.initialize("trainer","Test-training-only!2026");
  const actor=s.auth.login("trainer","Test-training-only!2026").user;
  const initial=s.training.checkpoints(actor.id);
  assert.equal(initial.training,true);
  assert.deepEqual(initial.courses.map(c=>c.id),Array.from({length:12},(_,i)=>"L"+String(i+1).padStart(2,"0")));
  assert.ok(initial.courses.every(c=>!c.completed));
  // No API, tour, reading or localStorage value affects the service's evidence.
  const unit=s.catalog.save(actor,"units",{name:"培训单位",quantity_precision:0});
  assert.ok(unit);
  assert.equal(s.training.checkpoints(actor.id).courses[0].completed,false);
  s.catalog.save(actor,"objects",{name:"防鸟装置-培训",object_position:"body",attribution_unit:"logical_tower"});
  assert.equal(s.training.checkpoints(actor.id).courses[0].completed,true);
  assert.equal(s.training.checkpoints(actor.id).courses[1].completed,false);
  const normalSystem=createSystem(normal);
  try{
    assert.equal(normalSystem.training.enabled,false);
    assert.deepEqual(normalSystem.training.checkpoints(actor.id),{training:false,courses:[]});
    assert.equal(normalSystem.catalog.list("objects").length,0);
  }finally{normalSystem.close();}
});

test("authenticated read-only training API cannot be promoted by URL parameters; normal server stays isolated",async t=>{
  const {training,normal}=testEnvironment(t);
  const trainingSystem=createSystem(training),normalSystem=createSystem(normal);
  t.after(()=>{trainingSystem.close();normalSystem.close()});
  trainingSystem.auth.initialize("trainer","Test-training-only!2026");
  normalSystem.auth.initialize("normal","Test-normal-only!2026");
  const server=httpServer(trainingSystem),prod=httpServer(normalSystem);
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  await new Promise(r=>prod.listen(0,"127.0.0.1",r));
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>prod.close(r))});
  const base="http://127.0.0.1:"+server.address().port;
  const production="http://127.0.0.1:"+prod.address().port;
  assert.equal((await fetch(base+"/api/training/checkpoints")).status,401);
  const login=await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"trainer",password:"Test-training-only!2026"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const read=await fetch(base+"/api/training/checkpoints",{headers:{cookie}});
  assert.equal(read.status,200);
  assert.equal((await read.json()).training,true);
  assert.equal((await fetch(base+"/api/training/checkpoints?training=false",{headers:{cookie}})).status,200);
  const secondLogin=await fetch(production+"/api/login",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:"normal",password:"Test-normal-only!2026"})});
  const normalCookie=secondLogin.headers.get("set-cookie").split(";")[0];
  const spoof=await fetch(production+"/api/training/checkpoints?training=true&mode=training",
    {headers:{cookie:normalCookie,"x-training-mode":"true"}});
  assert.deepEqual(await spoof.json(),{training:false,courses:[]});
  assert.equal(normalSystem.catalog.list("objects").length,0);
  assert.equal(normalSystem.demands.list().length,0);
});

test("training CLI creates isolated instances, refuses malicious reset and only removes the confirmed id",t=>{
  const root=resolve(import.meta.dirname,"../..");
  const env={...process.env,SD_TRAINING_ADMIN_PASSWORD:"Training-CLI-test!2026"};
  const result=spawnSync(process.execPath,["scripts/training/instance.mjs","create"],
    {cwd:root,env,encoding:"utf8",timeout:45000});
  assert.equal(result.status,0,result.stderr);
  const id=result.stdout.match(/TRAINING_INSTANCE_CREATED ([a-f0-9]{32})/)?.[1];
  assert.ok(id,"CLI must return an opaque instance id");
  const location=join(root,"data-training","instances",id);
  t.after(()=>{
    if(existsSync(location)){
      const reset=spawnSync(process.execPath,
        ["scripts/training/instance.mjs","reset","--id="+id,"--confirm="+id],
        {cwd:root,encoding:"utf8",timeout:15000});
      assert.equal(reset.status,0,reset.stderr);
    }
  });
  assert.equal(JSON.parse(readFileSync(join(location,"TRAINING-INSTANCE.json"))).id,id);
  assert.ok(existsSync(join(location,"schema113.sqlite")));
  const refused=spawnSync(process.execPath,["scripts/training/instance.mjs","reset",
    "--id="+id,"--confirm="+"a".repeat(32)],{cwd:root,encoding:"utf8"});
  assert.notEqual(refused.status,0);
  assert.ok(existsSync(location));
  const source=spawnSync(process.execPath,["scripts/training/instance.mjs","list"],
    {cwd:root,encoding:"utf8"});
  assert.ok(source.stdout.includes(id));
});
