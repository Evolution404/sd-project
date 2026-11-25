#!/usr/bin/env node
/**
 * Single-learner isolated training instances, on the actual app server.
 * No browser parameter can turn on training, and the trainer's database is
 * never used as a production/demo DATA_DIR.
 *
 * Usage:
 *   SD_TRAINING_ADMIN_PASSWORD=... node scripts/training/instance.mjs create
 *   node scripts/training/instance.mjs start --id=<32 hex> --port=8791
 *   node scripts/training/instance.mjs start-new --port=8791
 *   node scripts/training/instance.mjs list
 *   node scripts/training/instance.mjs reset --id=<32 hex> --confirm=<same id>
 */
import {randomBytes} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  rmSync, realpathSync, openSync, closeSync, unlinkSync} from "node:fs";
import {resolve,join,sep} from "node:path";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline/promises";
import {createSystem} from "../../dist/server/bootstrap.js";
import {packagedMode,selectedDataset} from "../../dist/server/platform/runtime/dataset.js";

const root=resolve(import.meta.dirname,"../..");
const formal = packagedMode()==="production";
const configured = join(root,"data-location.json");
const trainingBase = formal
  ? join(selectedDataset(process.env.DATA_DIR || (existsSync(configured)?JSON.parse(readFileSync(configured,"utf8")).data_dir:undefined)),"training")
  : join(root,"data-training");
const instances=join(trainingBase,"instances");
const idPattern=/^[a-f0-9]{32}$/;
const args=process.argv.slice(2);
const command=args[0]||"help";
function flag(key){return args.find(a=>a.startsWith("--"+key+"="))?.slice(key.length+3);}
function folder(id){
  if(!idPattern.test(id||""))throw Error("训练实例编号格式无效");
  const dir=resolve(instances,id);
  if(!dir.startsWith(resolve(instances)+sep))throw Error("训练目录不在独立根下");
  return dir;
}
function marker(dir){
  const target=join(dir,"TRAINING-INSTANCE.json");
  const data=JSON.parse(readFileSync(target,"utf8"));
  if(data.purpose!=="sd-project-isolated-training"||
      !idPattern.test(data.id)||data.id!==dir.split(sep).at(-1))
    throw Error("目录不属于本程序创建的隔离训练实例");
  if(realpathSync(dir)!==resolve(dir))throw Error("训练目录不允许符号链接");
  return data;
}
function pidAlive(pid){
  if(!Number.isInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return true;}catch(e){return e?.code==="EPERM";}
}
async function password(){
  if(process.env.SD_TRAINING_ADMIN_PASSWORD)return process.env.SD_TRAINING_ADMIN_PASSWORD;
  if(!process.stdin.isTTY)throw Error("非交互运行须设置SD_TRAINING_ADMIN_PASSWORD环境变量");
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{return await rl.question("训练实例管理员口令（输入将显示，周围无人时操作）：");}
  finally{rl.close();}
}

function seedScenario(system, actor) {
  return system.database.transaction(() => {
    const save = (kind, input) => system.catalog.save(actor, kind, input);
    const unit = save("units", { name:"套", quantity_precision:0 });
    const object = save("objects", { name:"训练杆塔防鸟装置", object_position:"body", attribution_unit:"logical_tower" });
    const voltage = save("voltages", { name:"110kV" });
    const line = save("lines", { name:"【训练】青禾线", voltage_level_id:voltage.id });
    for (const tower of ["01", "02"]) save("towers", {
      line_id:line.id, tower_no:tower, physical_properties:{ tower_material:"angle",tower_nature:"straight" },
    });
    const operation = save("operations", { name:"【训练】防鸟装置安装", work_object_id:object.id,
      default_unit_id:unit.id, completion_standard:"装置固定牢靠，现场复核通过" });
    const fiscalYear = new Date().getFullYear();
    const framework = save("frameworks", { name:"【训练】输电检修年度框架", fiscal_year:fiscalYear, limit_fen:5000000 });
    return { operationId:operation.id,frameworkId:framework.id };
  });
}

async function create(withScenario = false){
  const id=randomBytes(16).toString("hex");
  mkdirSync(instances,{recursive:true,mode:0o700});
  const dir=folder(id);
  mkdirSync(dir,{recursive:false,mode:0o700});
  try{
    const user=flag("username")||"trainer";
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(user))
      throw Error("训练管理员账号必须由3至32位字母/数字/下划线组成");
    const secret=await password();
    const system=createSystem(dir);
    let scenario;
    try{
      system.auth.initialize(user,secret);
      if(withScenario){
        const session=system.auth.login(user,secret);
        try{scenario=seedScenario(system,session.user);}
        finally{system.auth.logout(session.token);}
      }
    }finally{system.close();}
    writeFileSync(join(dir,"TRAINING-INSTANCE.json"),
      JSON.stringify({purpose:"sd-project-isolated-training",id,createdAt:new Date().toISOString(),scenario},null,2),
      {encoding:"utf8",mode:0o600,flag:"wx"});
    console.log("TRAINING_INSTANCE_CREATED "+id+" user="+user);
    return id;
  }catch(e){rmSync(dir,{recursive:true,force:true});throw e;}
}
function list(){
  if(!existsSync(instances))return console.log("当前没有训练实例");
  for(const id of readdirSync(instances)){
    if(!idPattern.test(id))continue;
    try{const value=marker(folder(id));console.log(id+" "+value.createdAt);}
    catch{console.error("跳过非本程序训练目录 "+id);}
  }
}
async function start(id) {
  const dir=folder(id);
  marker(dir);
  if(!existsSync(join(dir,"schema113.sqlite")))throw Error("训练数据库缺失，拒绝自行重建或覆盖");
  const port=Number(flag("port")||8791);
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error("端口必须为1024至65535");
  const lock=join(dir,".training-server.pid");
  if(existsSync(lock)){
    const previous=Number(readFileSync(lock,"utf8"));
    if(pidAlive(previous))throw Error("训练实例仍在运行，不能重复启动");
    unlinkSync(lock);
  }
  const child=spawn(process.execPath,[join(root,"dist/server/main.js")],{
    cwd:root,stdio:"inherit",env:{
      ...process.env,DATA_DIR:dir,
      SD_TRAINING_INSTANCE_ID:id,SD_TRAINING_DATA_DIR:dir,
      HOST:"127.0.0.1",PORT:String(port),
    },
  });
  writeFileSync(lock,String(child.pid),{encoding:"utf8",mode:0o600,flag:"wx"});
  console.log("TRAINING_INSTANCE_SERVER "+id+" http://127.0.0.1:"+port);
  let closing=false;
  const stop=()=>{
    if(closing)return;
    closing=true;
    if(child.exitCode===null)child.kill("SIGTERM");
  };
  process.once("SIGINT",stop);
  process.once("SIGTERM",stop);
  const code=await new Promise((resolve,reject)=>{
    child.on("error",reject);
    child.on("exit",(value,signal)=>resolve(value??(signal?1:0)));
  });
  try{if(readFileSync(lock,"utf8")===String(child.pid))unlinkSync(lock);}catch{}
  if(code!==0)process.exitCode=code;
}
function reset(id) {
  if(flag("confirm")!==id)throw Error("必须提供 --confirm=完整实例编号才能销毁实例数据");
  const dir=folder(id);
  marker(dir);
  const lock=join(dir,".training-server.pid");
  if(existsSync(lock)&&pidAlive(Number(readFileSync(lock,"utf8"))))
    throw Error("训练实例运行中，拒绝重置；请先停止训练进程");
  rmSync(dir,{recursive:true,force:true});
  console.log("TRAINING_INSTANCE_RESET "+id+" only");
}
if(command==="create")await create(args.includes("--scenario"));
else if(command==="start")await start(flag("id"));
else if(command==="start-new")await start(await create(!args.includes("--blank")));
else if(command==="list")list();
else if(command==="reset")reset(flag("id"));
else {
  console.log("create [--scenario] | start-new [--blank] | start --id=ID [--port=8791] | list | reset --id=ID --confirm=ID");
  if(command!=="help")process.exitCode=2;
}
