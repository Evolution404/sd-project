import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { sourceSnapshot, requireNode24 } from "./source-snapshot.mjs";

requireNode24();
const root=resolve(import.meta.dirname,"../..");
const dist=join(root,"dist"), work=join(root,".build"), evidence=join(root,"test-results","release");
const pnpm=process.env.npm_execpath;
if(!pnpm||!process.env.npm_config_user_agent?.startsWith("pnpm/10.34.5 "))throw Error("请使用 pnpm 10.34.5 运行发布命令");
const args=process.argv.slice(2);
const full=args.includes("--full");
const mode=args.find(arg=>["production","demo","both"].includes(arg))??process.env.SD_PACKAGE_MODE??"production";
if(!["production","demo","both"].includes(mode)||full&&mode!=="both"||args.some(arg=>!["production","demo","both","--full"].includes(arg)))throw Error("发布模式无效");
const modes=mode==="both"?["production","demo"]:[mode];
const git=(...args)=>{
  const r=spawnSync("git",args,{cwd:root,encoding:"utf8"});
  if(r.status!==0)throw Error(r.stderr||"无法获取 Git 状态");
  return r.stdout.trim();
};
mkdirSync(work,{recursive:true});mkdirSync(dist,{recursive:true});mkdirSync(evidence,{recursive:true});
const lock=join(work,"release.lock");
try{mkdirSync(lock)}catch{throw Error("已有发布任务或上次异常退出，请先核实发布锁 "+lock)}
writeFileSync(join(lock,"owner.json"),JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),mode,full}));
let staging, log;
try {
  const head=git("rev-parse","HEAD");
  if(full&&git("status","--porcelain"))throw Error("最终验收发布要求干净 Git HEAD；未提交源码请用 make release 或单版打包");
  const snapshot=sourceSnapshot(root).sha256;
  staging=mkdtempSync(join(work,"release-run-"));
  const receiptDir=join(staging,"output");mkdirSync(receiptDir);
  const logPath=join(evidence,new Date().toISOString().replace(/[:.]/g,"-")+".log");
  log=createWriteStream(logPath,{flags:"wx"});
  const env={...process.env,SD_BUILD_INPUT_SHA256:snapshot,SD_BUILD_GIT_COMMIT:head,SD_PNPM_CLI:pnpm,SD_RELEASE_OUTPUT_DIR:receiptDir};
  delete env.SD_FINAL_GATE_LOG;
  function line(value){console.log(value);log.write(value+"\n")}
  function run(label,argv,extraEnv={},executable=process.execPath){
    line("RELEASE_STEP_START "+label);
    return new Promise((done,reject)=>{
      const child=spawn(executable,argv,{cwd:root,env:{...env,...extraEnv},stdio:["ignore","pipe","pipe"]});
      child.stdout.on("data",chunk=>{process.stdout.write(chunk);log.write(chunk)});
      child.stderr.on("data",chunk=>{process.stderr.write(chunk);log.write(chunk)});
      child.on("error",reject);
      child.on("close",code=>{line("RELEASE_STEP_END "+label+" "+code);code===0?done():reject(Error(label+" 未通过"))});
    });
  }
  const script=(name,extraEnv)=>run(name,[pnpm,"run",name],extraEnv);
  const stable=()=>{if(git("rev-parse","HEAD")!==head||sourceSnapshot(root).sha256!==snapshot||full&&git("status","--porcelain"))throw Error("发布输入已变化，保留上一版产物");};
  if(full){
    await run("check:public-source", [join(root,"scripts/check-public-source.py")], {},
      process.platform==="win32" ? "python" : "python3");
    await script("check");
    await script("check:ui:strict");
    await script("check:schema");
    await run("test:performance",["--test",...await import("node:fs/promises").then(fs=>fs.readdir(join(root,"tests/performance"))).then(files=>files.filter(f=>f.endsWith(".bench.mjs")).map(f=>join(root,"tests/performance",f)))]);
    await run("test:browser",[join(root,"tests/run-browser-suites.mjs")]);
    await script("test:browser:legacy");
    await script("test:browser:governance");
    await run("test:worksheet:scale",[join(root,"tests/e2e/youlai-worksheet-scale-probe.mjs")]);
    await run("test:worksheet:layout",[join(root,"tests/e2e/youlai-worksheet-layout-probe.mjs")]);
    await run("test:worksheet:disposal",[join(root,"tests/e2e/youlai-worksheet-disposal-probe.mjs")]);
  } else {
    for(const name of ["build","check:field-independence","check:ui:strict","check:no-tax","check:independent-input"])await script(name);
  }
  stable();
  for(const item of modes){
    await run("package:"+item,[join(root,"scripts/release/package-win10.mjs")],{SD_PACKAGE_MODE:item});
    await script(item==="demo"?"test:package:demo":"test:package");
    stable();
  }
  // Flush the current run log before the report reads it.
  await new Promise((done,reject)=>log.write("",error=>error?reject(error):done()));
  if(mode==="both")await run("report:delivery",[join(root,"scripts/release/write-delivery-report.mjs")],full?{SD_FINAL_GATE_LOG:relative(root,logPath)}:{});
  stable();
  const names=modes.flatMap(item=>item==="demo"?["sd-project-win10-x64-demo.zip","DEMO-RELEASE-MANIFEST.json"]:["sd-project-win10-x64.zip","RELEASE-MANIFEST.json"]);
  if(mode==="both")names.push("FINAL-DELIVERY-REPORT.md");
  // Preserve the complete previous set until every new file has been validated.
  // A failed rename rolls back the promotion. Single-package updates invalidate a pair report.
  const backup=join(staging,"previous");mkdirSync(backup);
  const oldNames=[...new Set([...names,"FINAL-DELIVERY-REPORT.md"])];
  const moved=[],published=[];
  try {
    for(const name of oldNames)if(existsSync(join(dist,name))){renameSync(join(dist,name),join(backup,name));moved.push(name);}
    for(const name of names){renameSync(join(receiptDir,name),join(dist,name));published.push(name);}
  } catch(error){
    for(const name of published)rmSync(join(dist,name),{force:true});
    for(const name of moved)renameSync(join(backup,name),join(dist,name));
    throw error;
  }
  line("RELEASE_OK "+mode+" "+head+" "+snapshot);
  line("RELEASE_LOG "+relative(root,logPath));
} finally {
  if(log)await new Promise(done=>log.end(done));
  if(staging)rmSync(staging,{recursive:true,force:true});
  for(const name of ["windows-staging","windows-demo-staging"])rmSync(join(work,name),{recursive:true,force:true});
  rmSync(lock,{recursive:true,force:true});
}
