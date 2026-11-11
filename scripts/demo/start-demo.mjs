import { resolve } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "./seed-demo.mjs";

const directory = resolve(import.meta.dirname, "../../data/demo");
const result = ensureDemoDatabase(directory, {
  password: process.env.SD_DEMO_PASSWORD || DEMO_PASSWORD,
});
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
  const port = Number(process.env.SD_DEMO_PORT || 8788);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("演示端口必须在1024～65535之间");
  const system = createSystem(directory);
  const server = httpServer(system);
  server.listen(port, "127.0.0.1", () => {
    console.log(description.join("\n"));
    console.log("\n浏览器地址：http://127.0.0.1:" + port);
    console.log("演示账号：" + DEMO_ACCOUNT);
    console.log("演示密码：" + (process.env.SD_DEMO_PASSWORD || DEMO_PASSWORD));
    console.log("注意：全部数据均为虚构示例，不可用于真实工程或报价。");
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
