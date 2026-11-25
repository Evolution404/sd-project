import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync,cpSync,symlinkSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {createServer} from "node:net";
import {createSystem} from "../../dist/server/bootstrap.js";
import {createEvidence} from "../../dist/server/platform/files/service.js";
import {seedCommonDefinitions,COMMON_UNITS,COMMON_VOLTAGES} from "../../scripts/seed/common.mjs";
import {upgrade} from "../../scripts/upgrade.mjs";

const root=resolve(import.meta.dirname,"../.."), secret="fixture-not-a-real-account-password";
function temp(t){const dir=mkdtempSync(join(tmpdir(),"sd-upgrade-test-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}
function install(dir){
 mkdirSync(dir,{recursive:true});
 cpSync(join(root,"dist/server"),join(dir,"dist/server"),{recursive:true});
 cpSync(join(root,"dist/web"),join(dir,"dist/web"),{recursive:true});
 symlinkSync(join(root,"node_modules"),join(dir,"node_modules"),"junction");
 const schema=join(dir,"dist/server/database/schema/schema113.sql");
 writeFileSync(join(dir,"BUILD-MANIFEST.json"),JSON.stringify({product:"sd-project",schema_version:113,package_mode:"production",schema_sha256:createHash("sha256").update(readFileSync(schema)).digest("hex"),build_input_sha256:"fixture-"+dir}));
}
test("common definitions preserve existing unit precision and roles, and are idempotent",t=>{
 const s=createSystem(temp(t));
 try{
  s.auth.initialize("admin",secret);const {user}=s.auth.login("admin",secret);
  const saved=s.catalog.save(user,"units",{name:"米",quantity_precision:3});
  const first=seedCommonDefinitions(s,user),second=seedCommonDefinitions(s,user);
  assert.equal(first.units,COMMON_UNITS.length-1);
  assert.equal(s.catalog.get("units",saved.id).quantity_precision,3);
  assert.equal(s.catalog.get("units",saved.id).version,saved.version);
  assert.equal(s.catalog.list("units").length,COMMON_UNITS.length);
  assert.equal(s.catalog.list("voltages").length,COMMON_VOLTAGES.length);
  assert.deepEqual(COMMON_VOLTAGES,["35kV","110kV","220kV","500kV","1000kV","±200kV","±500kV","±800kV"]);
  assert.deepEqual(Object.values(second),Object.values(second).map(()=>0));
  assert.equal(s.management.roles(user).length,5);
  assert(s.database.verifyIntegrity());
 }finally{s.close()}
});
test("offline upgrade preserves users, business identity, attachment bytes and history; refuses overwrite",async t=>{
 const parent=temp(t),oldRoot=join(parent,"v1"),newRoot=join(parent,"v2");install(oldRoot);install(newRoot);
 const old=createSystem(join(oldRoot,"data"));let user,demand,attachment,unit;
 try{
  old.auth.initialize("admin",secret);user=old.auth.login("admin",secret).user;
  seedCommonDefinitions(old,user);
  unit=old.catalog.save(user,"units",{name:"自定义计量",quantity_precision:3});
  const object=old.catalog.save(user,"objects",{name:"测试设备",object_position:"body",attribution_unit:"physical_tower"});
  const operation=old.catalog.save(user,"operations",{name:"测试操作",work_object_id:object.id,default_unit_id:unit.id,completion_standard:"完成"});
  const tower=old.catalog.save(user,"physical",{asset_no:"TEST-ASSET"});
  demand=old.demands.save(user,{operation_id:operation.id,problem_description:"保留的业务事实",work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}],sources:[{description:"验收"}]});
  attachment=createEvidence(old).upload(user,{owner_kind:"demand_id",owner_id:demand.id,filename:"fixture.txt",base64:Buffer.from("fixture attachment").toString("base64")});
  mkdirSync(join(oldRoot,"data/logs"),{recursive:true});writeFileSync(join(oldRoot,"data/logs/fixture.log"),"retained log");
 }finally{old.close()}
 const port=await new Promise(ok=>{const listener=createServer();listener.listen(0,"127.0.0.1",()=>{const port=listener.address().port;listener.close(()=>ok(port))})});
 const receipt=await upgrade(oldRoot,newRoot,{port});
 assert(receipt.verified);assert.equal(receipt.old_service_port,port);assert.equal(receipt.backup_history_retained_at,realpathSync(join(oldRoot,"data/backups")));assert(existsSync(receipt.backup));assert(existsSync(join(oldRoot,"data/schema113.sqlite")));
 const next=createSystem(join(newRoot,"data"));
 try{
  const login=next.auth.login("admin",secret);assert.equal(login.user.id,user.id);
  assert.equal(next.catalog.get("units",unit.id).quantity_precision,3);
  assert.equal(next.demands.get(demand.id).problem_description,"保留的业务事实");
  assert.equal(createEvidence(next).download(login.user,attachment.id).bytes.toString(),"fixture attachment");
  assert.equal(readFileSync(join(newRoot,"data/logs/fixture.log"),"utf8"),"retained log");
  assert(next.database.verifyIntegrity());
 }finally{next.close()}
 await assert.rejects(()=>upgrade(oldRoot,newRoot,{port}),/拒绝覆盖/);
});
test("upgrade refuses a running service and incompatible schema without creating target data",async t=>{
 const parent=temp(t),oldRoot=join(parent,"v1"),newRoot=join(parent,"v2");install(oldRoot);install(newRoot);
 const old=createSystem(join(oldRoot,"data"));old.close();
 const listener=createServer();await new Promise(ok=>listener.listen(0,"0.0.0.0",ok));
 try{await assert.rejects(()=>upgrade(oldRoot,newRoot,{port:listener.address().port}),/仍在使用/)}finally{await new Promise(ok=>listener.close(ok))}
 assert(!existsSync(join(newRoot,"data")));
 const schema=join(newRoot,"dist/server/database/schema/schema113.sql");
 const altered=readFileSync(schema,"utf8")+"\n-- fixture change\n";writeFileSync(schema,altered);
 const manifest=JSON.parse(readFileSync(join(newRoot,"BUILD-MANIFEST.json"),"utf8"));manifest.schema_sha256=createHash("sha256").update(altered).digest("hex");writeFileSync(join(newRoot,"BUILD-MANIFEST.json"),JSON.stringify(manifest));
 await assert.rejects(()=>upgrade(oldRoot,newRoot),/数据库结构发生变化/);
 assert(!existsSync(join(newRoot,"data")));
});

test("upgrade refuses tampered deployed scripts before any backup or target creation",async t=>{
 const parent=temp(t),oldRoot=join(parent,"v1"),newRoot=join(parent,"v2");install(oldRoot);install(newRoot);
 const old=createSystem(join(oldRoot,"data"));old.close();
 const path=join(newRoot,"launch.cmd");writeFileSync(path,"original");
 const mpath=join(newRoot,"BUILD-MANIFEST.json"),m=JSON.parse(readFileSync(mpath,"utf8"));
 m.deployment_artifact_sha256={"launch.cmd":createHash("sha256").update(readFileSync(path)).digest("hex")};
 writeFileSync(mpath,JSON.stringify(m));writeFileSync(path,"changed");
 await assert.rejects(()=>upgrade(oldRoot,newRoot,{probe:false}),/部署文件校验失败/);
 assert(!existsSync(join(newRoot,"data")));assert(existsSync(join(oldRoot,"data/schema113.sqlite")));
});
