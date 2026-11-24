import { parentPort, workerData } from "node:worker_threads";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";

const system = createSystem(workerData.dataDirectory);
const server = httpServer(system, { staticDirectory: workerData.staticDirectory });
parentPort.once("message", () => {
  server.shutdown(error => {
    system.close();
    parentPort.close();
    if (error) throw error;
  });
});
server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));
