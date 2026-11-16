import { requireNode24, sourceSnapshot } from "./source-snapshot.mjs";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { verifyPackageAccessLogs } from "./verify-access-logs.mjs";
import { DEMO_ACCOUNT, DEMO_PASSWORD } from "../demo/seed-demo.mjs";

requireNode24();
const root = resolve(import.meta.dirname, "../..");
const zip = join(root, "dist/sd-project-win10-x64-demo.zip");
const receipt = JSON.parse(readFileSync(join(root, "dist/DEMO-RELEASE-MANIFEST.json"), "utf8"));
const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(receipt.package_mode, "demo");
assert.equal(digest(zip), receipt.sha256);
const temp = mkdtempSync(join(tmpdir(), "sd-project-demo-package-"));
const stage = join(temp, "package");
let server;
try {
  const unzip = spawnSync("python3", ["-c", `import zipfile,os,sys
z=zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
out=os.path.abspath(sys.argv[2])
for entry in z.namelist():
 assert os.path.commonpath([out,os.path.abspath(os.path.join(out,entry))])==out
z.extractall(out)
`, zip, stage], {encoding:"utf8",timeout:90000});
  assert.equal(unzip.status,0,unzip.stderr);
  const manifest = JSON.parse(readFileSync(join(stage,"BUILD-MANIFEST.json"),"utf8"));
  assert.equal(manifest.package_mode,"demo");
  assert.equal(typeof manifest.worktree_dirty,"boolean");
  assert.match(manifest.build_input_sha256,/^[0-9a-f]{64}$/);
  assert.equal(manifest.worktree_dirty,receipt.worktree_dirty);
  assert.equal(manifest.build_input_sha256,receipt.build_input_sha256);
  const head=spawnSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"});
  assert.equal(head.status,0);
  assert.equal(manifest.git_commit,head.stdout.trim());
  for(const file of ["scripts/training/instance.mjs","启动训练环境.cmd",
      "训练实例列表.cmd","docs/implementation/P10_业务操作帮助覆盖清单.md"])
    assert.ok(existsSync(join(stage,file)),"演示包缺少训练功能："+file);

  assert.equal(manifest.schema_version,113);
  for (const config of ["vite.config.ts", "tsconfig.json", "tsconfig.server.json"])
    assert.match(manifest.build_input_files_sha256[config], /^[a-f0-9]{64}$/);
  assert.equal(manifest.sample_data_included,true);
  assert.equal(manifest.ps1_utf8_bom,false,
    "demo does not ship the formal first-run PowerShell script");
  assert.equal(manifest.data_location,"./data");
  assert.equal(manifest.git_commit,receipt.git_commit);
  assert.equal(sourceSnapshot(root).sha256, manifest.build_input_sha256, "发布包构建输入与当前源码不一致");
  assert.deepEqual(sourceSnapshot(root).files, manifest.build_input_files_sha256);
  assert.equal(existsSync(join(stage,"scripts/first-run.ps1")),false);
  assert.equal(manifest.demo_ip_restriction_enabled,false);
  assert.equal(digest(join(stage,"runtime/node.exe")),manifest.runtime_node_exe_sha256);
  assert.equal(readFileSync(join(stage,"runtime/node.exe")).toString("ascii",0,2),"MZ");
  assert.equal(digest(join(stage,"data/schema113.sqlite")),manifest.sample_database_sha256);
  assert.equal(digest(join(stage,"演示账号与部署说明.txt")),manifest.sample_credentials_sha256);
  assert.equal(digest(join(stage,"dist/web/index.html")),manifest.frontend_index_sha256);
  assert.equal(digest(join(stage,"dist/server/database/schema/schema113.sql")),manifest.schema_sha256);
  for(const [name,sha] of Object.entries(manifest.server_artifact_sha256))
    assert.equal(digest(join(stage,"dist/server",name)),sha,"server artifact "+name);
  assert.equal(existsSync(join(stage,"node_modules/vite")),false);
  assert.equal(existsSync(join(stage,"node_modules/typescript")),false);
  assert.equal(existsSync(join(stage,"初始化管理员.cmd")),false);
  const launchCommand=readFileSync(join(stage,"启动演示服务.cmd"),"utf8");
  assert.ok(launchCommand.includes("HOST=0.0.0.0"),"demo must bind LAN");
  assert.ok(launchCommand.includes("DATA_DIR=%~dp0data"),"demo data must be local to extracted folder");
  const credentials=readFileSync(join(stage,"演示账号与部署说明.txt"),"utf8");
  const username=credentials.match(/^管理员账号：(.+)$/m)?.[1]?.trim();
  const password=credentials.match(/^管理员密码：(.+)$/m)?.[1]?.trim();
  assert.equal(username, DEMO_ACCOUNT, "LAN demo username must be fixed");
  assert.equal(password, DEMO_PASSWORD, "LAN demo password must be fixed");
  const chosenPort=await new Promise(resolve=>{
    const listener=createServer();
    listener.listen(0,"127.0.0.1",()=>{
      const selected=listener.address().port;
      listener.close(()=>resolve(selected));
    });
  });
  const env={...process.env, ACCESS_LOG_MAX_FILE_BYTES:"2048", DATA_DIR:join(stage,"data"),HOST:"127.0.0.1",PORT:String(chosenPort)};
  async function stop() {
    if (!server || server.exitCode !== null) return;
    await new Promise(resolve=>{
      server.once("exit",resolve);
      server.kill("SIGTERM");
    });
    server=null;
  }
  async function launch() {
    server=spawn(process.execPath,[join(stage,"dist/server/main.js")],{cwd:stage,env,stdio:["ignore","pipe","pipe"]});
    let text="";
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("demo startup timed out: "+text)),20000);
      const data=chunk=>{
        text+=chunk.toString();
        if(text.includes("SCHEMA113_READY")){
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on("data",data);
      server.stderr.on("data",data);
      server.once("exit",code=>{clearTimeout(timer);reject(Error("demo service exited "+code+" "+text))});
      server.once("error",error=>{clearTimeout(timer);reject(error)});
    });
  }
  const base="http://127.0.0.1:"+chosenPort;
  await launch();
  const login=await fetch(base+"/api/login",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username,password})
  });
  assert.equal(login.status,200,await login.clone().text());
  const invalidPassword=await fetch(base+"/api/login",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:DEMO_ACCOUNT,password:DEMO_PASSWORD+"-wrong"})
  });
  assert.notEqual(invalidPassword.status,200,"incorrect demo password must fail");
  const loginRequestId=login.headers.get("x-request-id");
  const account=await login.json();
  assert.equal(account.role,"admin");
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const headers={Cookie:cookie};
  const projects=await fetch(base+"/api/projects",{headers});
  assert.equal(projects.status,200);
  assert.ok((await projects.json()).items.length>=2);
  const demands=await fetch(base+"/api/demands",{headers});
  assert.equal(demands.status,200);
  assert.ok((await demands.json()).items.length>=3);
  assert.equal((await fetch(base+"/api/demands")).status,401);
  const policy=await fetch(base+"/api/access-policy",{headers});
  assert.equal(policy.status,200);
  assert.equal((await policy.json()).ip_restriction_enabled,false);
  const created=await fetch(base+"/api/catalog/units",{
    method:"POST",headers:{...headers,"Content-Type":"application/json","Idempotency-Key":randomUUID()},
    body:JSON.stringify({name:"演示包重新启动持久化测试",quantity_precision:0})
  });
  assert.equal(created.status,200,await created.clone().text());
  const unit=(await created.json()).id;
  await verifyPackageAccessLogs(base,headers,join(stage,"data"),loginRequestId);
  await stop();
  await launch();
  const loginAgain=await fetch(base+"/api/login",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username,password})
  });
  assert.equal(loginAgain.status,200);
  const auth={Cookie:loginAgain.headers.get("set-cookie").split(";")[0]};
  const persisted=await fetch(base+"/api/catalog/units/"+unit,{headers:auth});
  assert.equal(persisted.status,200);
  assert.equal((await persisted.json()).name,"演示包重新启动持久化测试");
  const logCheck=await verifyPackageAccessLogs(base,auth,join(stage,"data"),loginRequestId);
  assert.ok(logCheck.files>=2,"demo must rotate log files in extracted data/logs");
  await stop();
  assert.equal(digest(zip),receipt.sha256,"archive must remain immutable after launch and restart");
  receipt.host_verification = {
    verified_at: new Date().toISOString(), os: process.platform, node: process.version,
    actual_zip_extracted: true, fixed_demo_credentials: true,
    restart_persistence: true, access_logs_rotation_restart: true,
  };
  writeFileSync(join(root,"dist/DEMO-RELEASE-MANIFEST.json"), JSON.stringify(receipt,null,2) + "\n");
  console.log("DEMO_PACKAGE_VERIFIED fixed demo credentials, zip SHA, Windows x64 Node24, no dev deps, authenticated login, wrong-password rejection, demo facts, IP policy, restart persistence");
} finally {
  if(server && server.exitCode===null)server.kill("SIGTERM");
  rmSync(temp,{recursive:true,force:true});
}
