import { createSystem } from "./bootstrap.js";
import { resolve } from "node:path";
import { httpServer } from "./platform/http/server.js";
import { assertInstallationAvailable, registerManagedShutdown } from "./platform/runtime/managed-shutdown.js";
import { packagedMode, selectedDataset, acquireDataset } from "./platform/runtime/dataset.js";

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("服务端口无效");
const formal = packagedMode() === "production";
const managed = formal || process.env.SD_MANAGED_SHUTDOWN === "1";
if (managed && process.env.DATA_DIR) assertInstallationAvailable(resolve(process.env.DATA_DIR));
const dataDirectory = formal ? selectedDataset(process.env.DATA_DIR, true) : undefined;
const releaseDataset = dataDirectory ? await acquireDataset(dataDirectory, port) : undefined;
const system = (() => {
  try { return createSystem(dataDirectory); }
  catch (error) { releaseDataset?.(); throw error; }
})();
const server = httpServer(system);
const host = process.env.HOST || "127.0.0.1";
let releaseManaged: (() => void) | undefined;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.shutdown(error => {
    try {
      if (error) console.error("服务关闭失败", error.message);
      system.close();
    } finally {
      releaseManaged?.();
      releaseDataset?.();
      process.exitCode = error ? 1 : process.exitCode ?? 0;
    }
  });
}
server.listen(port, host, () => {
  try {
    if (managed) releaseManaged = registerManagedShutdown(system.dataDirectory, port, shutdown);
    console.log(`SCHEMA113_READY http://${host}:${port} data=${system.database.directory}`);
  } catch (error) {
    console.error("服务控制文件初始化失败", (error as Error).message);
    process.exitCode = 1;
    shutdown();
  }
});
server.on("error", error => {
  console.error("服务启动失败", error.message);
  releaseManaged?.();
  try { system.close(); } finally { releaseDataset?.(); }
  process.exitCode = 1;
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, shutdown);
