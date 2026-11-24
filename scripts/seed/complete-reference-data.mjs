import { createSystem } from "../../dist/server/bootstrap.js";
import { seedCommonDefinitions } from "./common.mjs";
import { existsSync } from "node:fs";
import { resolve,join } from "node:path";
import { createInterface } from "node:readline/promises";
const directory=process.argv[2]&&resolve(process.argv[2]);
if(!directory||!existsSync(join(directory,"schema113.sqlite")))throw Error("需要已存在的独立数据库目录；不初始化或重置账号");
const cli=createInterface({input:process.stdin,output:process.stdout});
const username=process.env.SD_ADMIN_USER||"admin";
const password=process.env.SD_ADMIN_PASSWORD||await cli.question("当前管理员密码：");
cli.close();
const system=createSystem(directory);
try{
 const login=system.auth.login(username,password);
 try{
  const added=seedCommonDefinitions(system,login.user);
  const counts={units:system.catalog.list("units").length,voltages:system.catalog.list("voltages").length,tower_materials:system.catalog.list("tower_materials").length,tower_natures:system.catalog.list("tower_natures").length,roles:system.management.roles(login.user).length};
  console.log("REFERENCE_DATA_READY",JSON.stringify({added,counts}));
 }finally{system.auth.logout(login.token)}
 if(!system.database.verifyIntegrity())throw Error("完整性校验失败");
 system.database.checkpoint();
}finally{system.close()}
