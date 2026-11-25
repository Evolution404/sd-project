import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,realpathSync,mkdirSync,rmSync,writeFileSync,existsSync,readFileSync,symlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {createSystem} from "../../dist/server/bootstrap.js";
import {newDatasetPath,selectedDataset,acquireDataset} from "../../dist/server/platform/runtime/dataset.js";

test("external datasets never create missing data and lock across ports and aliases",t=>{
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
 const release=acquireDataset(directory,8787);
 try{
  assert.throws(()=>acquireDataset(selectedDataset(alias),8799),/已被占用/);
 }finally{release()}
 assert(!existsSync(join(directory,".sd-dataset.lock")));
 acquireDataset(directory,8799)();
 writeFileSync(join(directory,".sd-running-8787"),"legacy-owner");
 assert.throws(()=>acquireDataset(directory,8799),/受管服务记录/);
 rmSync(join(directory,".sd-running-8787"));
 writeFileSync(join(directory,"DEMO-DATA.json"),"{}");
 assert.throws(()=>selectedDataset(directory),/不得连接演示/);
});
test("incompatible datasets fail closed without changing database bytes or retaining lock",t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sd-dataset-invalid-")));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,"schema113.sqlite"),db=new DatabaseSync(path);
 db.exec("CREATE TABLE old_schema(id INTEGER); PRAGMA user_version=112;");db.close();
 const before=readFileSync(path);
 assert.throws(()=>acquireDataset(root,8787),/结构版本不兼容/);
 assert.deepEqual(readFileSync(path),before);
 assert(!existsSync(join(root,".sd-dataset.lock")));
});
