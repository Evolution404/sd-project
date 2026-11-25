// This database contains no business data. SQLite's OS-level write lock is
// released by the operating system even if the service is forcibly terminated.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export function acquireRuntimeMutex(directory: string): () => void {
  const connection = new DatabaseSync(join(directory, ".sd-runtime-lock.sqlite"));
  try {
    connection.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch (error) {
    connection.close();
    if ((error as {errcode?:number}).errcode === 5)
      throw Error("该数据目录正被其他服务或维护任务使用，请先停止正在运行的实例");
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Closing rolls back the empty transaction and releases the OS lock.
    connection.close();
  };
}
