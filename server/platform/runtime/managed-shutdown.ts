import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const ownerPath = (directory: string, port: number) => join(directory, `.sd-running-${port}`);
const requestPath = (directory: string, port: number, nonce: string) => join(directory, `.sd-stop-${port}-${nonce}`);
const noncePattern = /^[a-f0-9]{48}$/;

function readOwner(path: string): string | null {
  try {
    if (!lstatSync(path).isFile()) return null;
    const nonce = readFileSync(path, "utf8").trim();
    return noncePattern.test(nonce) ? nonce : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function assertInstallationAvailable(directory: string) {
  if (existsSync(join(dirname(directory), ".upgrade.lock")))
    throw Error("该程序目录正在升级，请等升级完成后再启动服务");
}

export function registerManagedShutdown(directory: string, port: number, shutdown: () => void) {
  assertInstallationAvailable(directory);
  const owner = ownerPath(directory, port);
  const nonce = randomBytes(24).toString("hex");
  const pending = owner + "." + nonce;
  const request = requestPath(directory, port, nonce);
  try {
    writeFileSync(pending, nonce + "\n", { flag: "wx", mode: 0o600 });
    renameSync(pending, owner);
  } finally {
    rmSync(pending, { force: true });
  }
  const poll = setInterval(() => {
    if (readOwner(request) !== nonce) return;
    clearInterval(poll);
    shutdown();
  }, 200).unref();
  return () => {
    clearInterval(poll);
    if (readOwner(owner) === nonce) rmSync(owner, { force: true });
    rmSync(request, { force: true });
  };
}

export async function requestManagedShutdown(directory: string, port: number) {
  const owner = ownerPath(directory, port);
  const nonce = readOwner(owner);
  if (!nonce) throw Error("端口仍在使用，未识别到此目录的受管旧服务，请手动核实并停止旧服务");
  const request = requestPath(directory, port, nonce);
  writeFileSync(request, nonce + "\n", { flag: "wx", mode: 0o600 });
  try {
    const deadline = Date.now() + 30_000;
    while (readOwner(owner) === nonce) {
      if (Date.now() >= deadline) throw Error("旧服务未在规定时间内完成关闭，请核实源目录和服务端口");
      await wait(200);
    }
  } finally {
    rmSync(request, { force: true });
  }
}
