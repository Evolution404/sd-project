/** Offline upgrade into a new, already extracted program directory. */
import { createSystem } from "../dist/server/bootstrap.js";
import { restoreBackup } from "../dist/server/database/restore.js";
import { existsSync,readFileSync,mkdirSync,mkdtempSync,renameSync,rmSync,cpSync,realpathSync,writeFileSync,lstatSync } from "node:fs";
import { resolve,join,dirname,relative,isAbsolute,sep } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const inside=(parent,child)=>{const rel=relative(parent,child);return rel===""||(!rel.startsWith(".."+sep)&&rel!==".."&&!isAbsolute(rel));};
function manifest(root){
 const m=JSON.parse(readFileSync(join(root,"BUILD-MANIFEST.json"),"utf8"));
 assert(m.product==="sd-project"&&m.schema_version===113,"不支持的程序或数据库结构");
 assert.equal(sha(join(root,"dist/server/database/schema/schema113.sql")),m.schema_sha256,"数据库权威结构文件损坏");
 for(const [name,digest] of Object.entries(m.deployment_artifact_sha256??{})){
  const path=resolve(root,name);assert(inside(root,path),"发布清单路径越界");
  assert.equal(sha(path),digest,"部署文件校验失败："+name);
 }
 for(const [folder,entries] of [["dist/server",m.server_artifact_sha256],["dist/web",m.frontend_artifact_sha256]]){
  for(const [name,digest] of Object.entries(entries??{})){
   const path=resolve(root,folder,name);assert(inside(join(root,folder),path),"编译产物路径越界");
   assert.equal(sha(path),digest,"编译产物校验失败："+name);
  }
 }
 return m;
}
async function assertStopped(port){
 const listener=createServer();
 await new Promise((ok,fail)=>{
  listener.once("error",()=>fail(Error("服务端口 "+port+" 仍在使用，请停止旧服务后重试")));
  listener.listen(port,"0.0.0.0",()=>listener.close(ok));
 });
}
async function smoke(root,directory){
 const port=await new Promise((ok,fail)=>{const l=createServer();l.once("error",fail);l.listen(0,"127.0.0.1",()=>{const p=l.address().port;l.close(()=>ok(p))})});
 const child=spawn(process.execPath,[join(root,"dist/server/main.js")],{cwd:root,env:{...process.env,DATA_DIR:directory,HOST:"127.0.0.1",PORT:String(port)},stdio:["ignore","pipe","pipe"]});
 try{
  await new Promise((ok,fail)=>{
   let output="";const timer=setTimeout(()=>fail(Error("新程序试启动超时")),30000);
   child.stdout.on("data",b=>{output+=b.toString();if(output.includes("SCHEMA113_READY")){clearTimeout(timer);ok()}});
   child.stderr.on("data",b=>{output+=b.toString()});
   child.once("error",e=>{clearTimeout(timer);fail(e)});
   child.once("exit",()=>{clearTimeout(timer);fail(Error("新程序试启动失败："+output.slice(-500)))});
  });
  const response=await fetch("http://127.0.0.1:"+port);
  assert.equal(response.status,200,"新程序首页验证失败");
 }finally{
  if(child.exitCode===null&&child.signalCode===null)await new Promise(ok=>{child.once("exit",ok);child.kill("SIGTERM")});
 }
}
export async function upgrade(oldRoot,newRoot,{port=8787,probe=true}={}){
 oldRoot=realpathSync(resolve(oldRoot));newRoot=realpathSync(resolve(newRoot));
 assert(!inside(oldRoot,newRoot)&&!inside(newRoot,oldRoot),"新旧程序目录必须独立且不得互相嵌套");
 const oldData=join(oldRoot,"data"),target=join(newRoot,"data");
 assert(existsSync(join(oldData,"schema113.sqlite")),"旧目录没有业务数据库");
 assert(!lstatSync(oldData).isSymbolicLink(),"旧数据目录不得为符号链接");
 assert(!existsSync(target),"新目录已有数据，拒绝覆盖");
 const from=manifest(oldRoot),to=manifest(newRoot);
 assert.equal(from.schema_sha256,to.schema_sha256,"数据库结构发生变化：当前无对应迁移程序，拒绝升级");
 assert(to.package_mode==="production","必须使用不含初始数据的正式升级程序");
 assert(Number.isInteger(port)&&port>0&&port<65536,"无效旧服务端口");
 if(probe)await assertStopped(port);
 const lock=join(oldRoot,".upgrade.lock");
 mkdirSync(lock);
 let workspace;
 try{
  const stamp=new Date().toISOString().replaceAll(":","-");
  const backup=join(oldData,"backups","upgrade-"+stamp);
  workspace=mkdtempSync(join(newRoot,".upgrade-"));
  const candidate=join(workspace,"data");
  const old=createSystem(oldData);
  try{
   assert(old.database.verifyIntegrity(),"旧数据库完整性失败");
   await old.database.backupTo(backup);
  }finally{old.close()}
  restoreBackup(backup,candidate);
  const next=createSystem(candidate);
  try{assert(next.database.verifyIntegrity(),"新数据库完整性失败")}finally{next.close()}
  // Test the new runtime on the isolated candidate; never start a second writer on the old data.
  if(probe)await smoke(newRoot,candidate);
  // Keep access logs and prior backup history. Source folders are never deleted.
  for(const name of ["logs"]){
   const path=join(oldData,name);
   if(existsSync(path))cpSync(path,join(candidate,name),{recursive:true,force:false,errorOnExist:false});
  }
  // The isolated training environment remains intact at the old installation;
  // copying it without a verified shutdown would be unsafe. Document its location.
  const retainedBackups=join(oldData,"backups");
  const receipt={backup_history_retained_at:retainedBackups,old_service_port:port,upgraded_at:new Date().toISOString(),old_root:oldRoot,backup,from_build:from.build_input_sha256,to_build:to.build_input_sha256,schema_version:113,training_retained_at:existsSync(join(oldRoot,"data-training"))?join(oldRoot,"data-training"):null,verified:true};
  writeFileSync(join(candidate,"UPGRADE-RECEIPT.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
  assert(!existsSync(target),"目标已创建，拒绝覆盖");
  renameSync(candidate,target);
  return receipt;
 }finally{
  if(workspace)rmSync(workspace,{recursive:true,force:true});
  rmSync(lock,{recursive:true,force:true});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href){
 const [oldRoot,port="8787"]=process.argv.slice(2);
 if(!oldRoot)throw Error("用法：node scripts/upgrade.mjs 旧程序目录 [旧服务端口]");
 const receipt=await upgrade(oldRoot,resolve(import.meta.dirname,".."),{port:Number(port)});
 console.log("UPGRADE_OK",JSON.stringify(receipt));
}
