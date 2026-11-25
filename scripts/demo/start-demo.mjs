import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "./seed-demo.mjs";

const port = Number(process.env.SD_DEMO_PORT || 8788);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("演示端口必须在1024～65535之间");
// Alternative ports get separate databases, never open the default demo data twice.
const fixture=process.env.SD_DEMO_FIXTURE==="1";
const assetSource=fixture?undefined:process.env.SD_ASSET_SOURCE;
const directory = resolve(import.meta.dirname,"../../data",fixture?(port===8788?"demo":"demo-"+port):(port===8788?"demo-real":"demo-real-"+port));
const secretFile=resolve(dirname(directory),"."+basename(directory)+"-local-password");
if(!fixture&&!assetSource&&!existsSync(directory))
  throw Error("首次创建真实台账演示需要显式设置 SD_ASSET_SOURCE");
function localPassword(){
  return DEMO_PASSWORD;
}
if (!process.argv.includes("--seed-only")) {
  const { createServer } = await import("node:net");
  const probe = createServer();
  try {
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
    await new Promise(resolve => probe.close(resolve));
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error("演示端口 " + port + " 已被占用。请关闭已有服务，或执行 make demo DEMO_PORT=8789 启动独立演示库（选择空闲端口）。");
      process.exit(1);
    }
    throw error;
  }
}
const password=localPassword();
const result=ensureDemoDatabase(directory,{password,assetSource,real:!fixture});
const description = [
  "【演示】输电项目管理系统",
  "数据目录：" + directory,
  "设备台账：" + result.lines + "条线路，" + result.logicalTowers +
    "基逻辑杆塔，" + result.spans + "个档距",
  "业务数据：" + result.operations + "种操作，" + result.priceRules +
    "条参考价格，" + result.demands + "条需求，" + result.projects + "个子项目",
  result.refreshed
    ? "演示数据版本更新：旧数据已完整归档到 " + result.archive
    : result.created ? "演示数据库创建成功" : "已复用现有演示数据库，未重置任何记录",
];
if (process.argv.includes("--seed-only")) {
  console.log(description.join("\n"));
} else {
  // Deliberately keep the predictable demonstration account on loopback only.
  // This port is separate from the user's real database/server.
  const system = createSystem(directory);
  const server = httpServer(system);
  server.listen(port, "127.0.0.1", () => {
    console.log(description.join("\n"));
    console.log("\n浏览器地址：http://127.0.0.1:" + port);
    console.log("演示账号：" + DEMO_ACCOUNT);
    console.log("演示密码："+DEMO_PASSWORD);
    console.log(fixture?"注意：全部数据均为虚构示例。":"注意：基础台账来自真实导入，新增业务数据为虚构演示；仅本机授权测试，不可作为真实工程依据。");
  });
  server.on("error", err => {
    console.error("演示服务启动失败：", err.message);
    system.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => server.close(() => {
      system.close();
      process.exit(0);
    }));
}
