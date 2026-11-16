import { createSystem } from "./bootstrap.js";
import { httpServer } from "./platform/http/server.js";

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("服务端口无效");
const system = createSystem();
const server = httpServer(system);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => console.log(
  `SCHEMA113_READY http://${host}:${port} data=${system.database.directory}`,
));
server.on("error", error => {
  console.error("服务启动失败", error.message);
  system.close();
  process.exitCode = 1;
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.shutdown(() => {
    system.close();
    process.exit(0);
  }));
}
