import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,realpathSync,mkdirSync,rmSync,writeFileSync,existsSync,readFileSync,symlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {createSystem} from "../../dist/server/bootstrap.js";
import {newDatasetPath,selectedDataset,acquireDataset} from "../../dist/server/platform/runtime/dataset.js";

test("external datasets never create missing data and lock across ports and aliases",async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sd-dataset-test-")));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const absent=join(root,"absent"),empty=join(root,"empty"),directory=join(root,"independent");
 assert.throws(()=>selectedDataset(absent),/不存在/);assert(!existsSync(absent));
 mkdirSync(empty);assert.throws(()=>selectedDataset(empty),/缺少有效/);
 assert.equal(newDatasetPath(directory),directory);
 assert.throws(()=>newDatasetPath(empty),/已存在/);
 const system=createSystem(directory);system.close();
 assert.equal(selectedDataset(directory),directory);
 const alias=join(root,"alias");symlinkSync(directory,alias,"junction");
 assert.equal(selectedDataset(alias),directory);
 const release=await acquireDataset(directory,8787);
 try{
  await assert.rejects(acquireDataset(selectedDataset(alias),8799),/正在运行的实例/);
 }finally{release()}
 assert(!existsSync(join(directory,".sd-dataset.lock")));
 (await acquireDataset(directory,8799))();
 const listener=createServer();
 listener.listen(0,"127.0.0.1");
 await once(listener,"listening");
 const oldPort=listener.address().port,marker=join(directory,".sd-running-"+oldPort);
 writeFileSync(marker,"a".repeat(48));
 try{
  await assert.rejects(acquireDataset(directory,8799),/仍在使用/);
  assert(existsSync(marker));
 }finally{await new Promise(resolve=>listener.close(resolve))}
 (await acquireDataset(directory,8799))();
 assert(!existsSync(marker));
 writeFileSync(join(directory,"DEMO-DATA.json"),"{}");
 assert.throws(()=>selectedDataset(directory),/不得连接演示/);
});
test("incompatible datasets fail closed without changing database bytes or retaining lock",async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sd-dataset-invalid-")));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,"schema113.sqlite"),db=new DatabaseSync(path);
 db.exec("CREATE TABLE old_schema(id INTEGER); PRAGMA user_version=112;");db.close();
 const before=readFileSync(path);
 await assert.rejects(acquireDataset(root,8787),/结构版本不兼容/);
 assert.deepEqual(readFileSync(path),before);
 assert(!existsSync(join(root,".sd-dataset.lock")));
});

test("force-terminated process releases OS lock and stale markers recover automatically",async t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),"sd-crash-recover-")));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const system=createSystem(directory);system.close();
 const moduleURL=pathToFileURL(join(process.cwd(),"dist/server/platform/runtime/dataset.js")).href;
 const code='import {acquireDataset} from '+JSON.stringify(moduleURL)+';await acquireDataset(process.argv[1],8799);console.log("LOCKED");setInterval(()=>{},1000);';
 const child=spawn(process.execPath,["--input-type=module","-e",code,directory],{stdio:["ignore","pipe","pipe"]});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL")});
 await new Promise((resolve,reject)=>{
  let output="";child.stdout.on("data",b=>{output+=b;if(output.includes("LOCKED"))resolve()});
  child.once("error",reject);child.once("exit",c=>reject(Error("child exited "+c)));
 });
 await assert.rejects(acquireDataset(directory,8800),/正在运行的实例/);
 const exited=once(child,"exit");child.kill("SIGKILL");await exited;
 assert(existsSync(join(directory,".sd-dataset.lock")));
 (await acquireDataset(directory,8800))();
 assert(!existsSync(join(directory,".sd-dataset.lock")));
});
