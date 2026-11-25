import { selectedDataset, acquireDataset, processAlive } from "../dist/server/platform/runtime/dataset.js";
import { assertExistingDatabase } from "../dist/server/database/connection.js";
import { requestManagedShutdown } from "../dist/server/platform/runtime/managed-shutdown.js";
import { existsSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
const [action]=process.argv.slice(2);
const directory=selectedDataset();
if(action==="validate"){
  assertExistingDatabase(directory);
  console.log("DATASET_OK",directory);
}else if(action==="stop"){
  const lock=join(directory,".sd-dataset.lock");
  const ownerPath=join(lock,"owner.json");
  try {
    const release=await acquireDataset(directory);
    release();
    console.log("DATASET_STOPPED",directory,"服务已停止");
    process.exit(0);
  } catch(error) {
    if(!/正在运行的实例|仍由旧版服务/.test(error.message))throw error;
  }
  const owner=existsSync(ownerPath)?JSON.parse(readFileSync(ownerPath,"utf8")):undefined;
  if(!owner || !processAlive(owner.pid))throw Error("数据集正由其他实例启动或维护，请稍后重试");
  if(!Number.isInteger(owner.port)||owner.port<1||owner.port>65535)throw Error("该目录正由非服务维护任务使用");
  await requestManagedShutdown(directory,owner.port);
  const deadline=Date.now()+5000;
  while(existsSync(lock)){
    if(Date.now()>=deadline)throw Error("服务退出后数据锁未释放，请核实运行状态");
    await wait(50);
  }
  console.log("DATASET_STOPPED",directory);
}else throw Error("用法：设置 DATA_DIR 后运行 dataset.mjs validate|stop");
