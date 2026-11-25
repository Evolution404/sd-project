import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { projectRoot } from "../paths.js";
import { assertExistingDatabase } from "../../database/connection.js";
import { acquireRuntimeMutex } from "../../database/runtime-mutex.js";
import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { setTimeout as wait } from "node:timers/promises";

export function packagedMode(): string | undefined {
  const manifest = join(projectRoot, "BUILD-MANIFEST.json");
  if (!existsSync(manifest)) {
    if (process.env.SD_PACKAGED_BUILD === "1") throw Error("缺少发布清单，请完整解压程序");
    return undefined;
  }
  const value = JSON.parse(readFileSync(manifest, "utf8"));
  if (value.product !== "sd-project" || !["production","demo"].includes(value.package_mode))
    throw Error("发布清单无效");
  if (value.package_mode === "production" && value.data_location !== "external-explicit") {
    if (process.env.SD_PACKAGED_BUILD === "1") throw Error("正式程序数据目录契约不兼容");
    return undefined; // development-only fixtures for historical upgrade regression
  }
  return value.package_mode;
}
function inside(parent: string, child: string) {
  const rel = relative(parent, child);
  return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}

export function newDatasetPath(input: string | undefined): string {
  if (!input || !isAbsolute(input)) throw Error("必须显式指定新数据目录的绝对路径");
  const target=resolve(input);
  if (existsSync(target)) throw Error("目标数据目录已存在，禁止覆盖");
  let parent=target;
  const suffix:string[]=[];
  while(!existsSync(parent)){
    suffix.unshift(basename(parent));
    const next=dirname(parent);
    if(next===parent)throw Error("新数据目录的父路径无效");
    parent=next;
  }
  const directory=join(realpathSync(parent),...suffix);
  const root=realpathSync(projectRoot);
  if(inside(root,directory)||inside(directory,root))throw Error("正式数据与程序目录必须相互独立");
  return directory;
}

export function selectedDataset(input = process.env.DATA_DIR, allowTraining = false): string {
  if (!input || !isAbsolute(input)) throw Error("必须显式指定数据目录的绝对路径 DATA_DIR");
  if (!existsSync(input)) throw Error("指定数据目录不存在，禁止自动创建空库");
  const directory = realpathSync(input);
  const root = realpathSync(projectRoot);
  const training = allowTraining && /^[a-f0-9]{32}$/.test(process.env.SD_TRAINING_INSTANCE_ID || "") &&
    process.env.SD_TRAINING_DATA_DIR && realpathSync(process.env.SD_TRAINING_DATA_DIR) === directory &&
    existsSync(join(directory, "TRAINING-INSTANCE.json")) &&
    JSON.parse(readFileSync(join(directory, "TRAINING-INSTANCE.json"), "utf8")).id === process.env.SD_TRAINING_INSTANCE_ID;
  if (!training && (inside(root,directory) || inside(directory,root)))
    throw Error("正式数据与程序目录必须相互独立");
  if (!training && (existsSync(join(directory,"DEMO-DATA.json")) || existsSync(join(directory,"TRAINING-INSTANCE.json"))))
    throw Error("正式服务不得连接演示或训练数据");
  const db = join(directory,"schema113.sqlite");
  if (!existsSync(db) || !lstatSync(db).isFile() || lstatSync(db).size === 0)
    throw Error("指定目录缺少有效 schema113.sqlite，禁止自动创建空库");
  return directory;
}

export function processAlive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true; // Access denied is not evidence that a process is dead.
  }
}

async function portAvailable(port: number): Promise<boolean> {
  // Probe loopback only; VPN virtual interfaces can accept arbitrary ports.
  const probe=(host:string)=>new Promise<boolean>(resolve=>{
    const socket=createConnection({host,port});
    const done=(free:boolean)=>{socket.destroy();resolve(free)};
    socket.once("connect",()=>done(false));
    socket.once("error",(error:NodeJS.ErrnoException)=>done(["ECONNREFUSED","EAFNOSUPPORT","EADDRNOTAVAIL","ENETUNREACH","EHOSTUNREACH","EPROTONOSUPPORT"].includes(error.code||"")));
    socket.setTimeout(500,()=>done(false));
  });
  if(!(await Promise.all(["127.0.0.1","::1"].map(probe))).every(Boolean))return false;
  // Inspect the OS listener table, not arbitrary interfaces (VPNs and TCP
  // TIME_WAIT can make connect/bind probes report false positives).
  if(process.platform==="win32"){
    const rows=execFileSync("netstat.exe",["-ano"],{encoding:"utf8",timeout:10000,windowsHide:true});
    return !rows.split(/\r?\n/).some(line=>{
      const fields=line.trim().split(/\s+/);
      return fields[0]==="TCP" && fields[1]?.endsWith(":"+port) &&
        /:0$/.test(fields[2]||""); // wildcard remote endpoint: listening socket
    });
  }
  if(process.platform==="darwin"){
    const rows=execFileSync("/usr/sbin/netstat",["-an","-p","tcp"],{encoding:"utf8",timeout:10000});
    return !rows.split(/\r?\n/).some(line=>{
      const fields=line.trim().split(/\s+/);
      return /^tcp[46]?$/.test(fields[0]||"") && fields[3]?.endsWith("."+port) && fields.includes("LISTEN");
    });
  }
  if(process.platform==="linux"){
    const wanted=port.toString(16).toUpperCase().padStart(4,"0");
    return !["/proc/net/tcp","/proc/net/tcp6"].some(path=>existsSync(path) &&
      readFileSync(path,"utf8").split("\n").some(line=>{
        const fields=line.trim().split(/\s+/);
        return fields[1]?.endsWith(":"+wanted) && fields[3]==="0A";
      }));
  }
  throw Error("无法检查当前系统的旧服务监听状态");
}

function legacyOwner(lock: string): {pid?:number; port?:number; os_lock?:number} | undefined {
  const owner = join(lock,"owner.json");
  if (!existsSync(owner)) return undefined;
  if (!lstatSync(owner).isFile()) throw Error("旧服务状态文件无效");
  try { return JSON.parse(readFileSync(owner,"utf8")); }
  catch { throw Error("旧服务状态文件损坏，无法确认旧版实例状态"); }
}

/** The OS lock is authoritative for all new versions. The old directory and
 * port markers are only compatibility records; recover them after verifying
 * that an older instance is no longer running. */
export async function acquireDataset(directory: string, port?: number): Promise<() => void> {
  const unlock = acquireRuntimeMutex(directory);
  const lock = join(directory,".sd-dataset.lock");
  let ownsCompatibilityLock = false;
  try {
    assertExistingDatabase(directory);
    if (existsSync(lock)) {
      if (!lstatSync(lock).isDirectory()) throw Error("旧服务状态目录无效");
      let old = legacyOwner(lock);
      // An older launcher creates the directory immediately before its owner
      // file. Give an in-progress launch a short chance to finish publishing.
      if (!old) {
        await wait(1000);
        old = legacyOwner(lock);
      }
      if (old?.os_lock !== 1 && old && processAlive(old.pid))
        throw Error("该数据目录仍由旧版服务或维护任务使用，请先停止该实例");
      // If this record belongs to a new version, obtaining the OS mutex proves
      // it has exited; a reused PID must not prevent restart.
      const names = readdirSync(lock);
      if (names.some(name => name !== "owner.json"))
        throw Error("旧服务状态目录包含未知文件，未自动清理");
      if (existsSync(join(lock,"owner.json"))) unlinkSync(join(lock,"owner.json"));
      rmdirSync(lock);
    }
    // Keep the compatibility record so the immediately previous release also
    // refuses a second connection. The OS lock serializes all new launchers.
    mkdirSync(lock,{mode:0o700});
    ownsCompatibilityLock = true;
    writeFileSync(join(lock,"owner.json"),JSON.stringify({pid:process.pid,port:port??null,started_at:new Date().toISOString(),program:projectRoot,os_lock:1})+"\n",{flag:"wx",mode:0o600});
    for (const name of readdirSync(directory)) {
      const match = /^\.sd-running-(\d+)$/.exec(name);
      if (!match) continue;
      const oldPort = Number(match[1]);
      if (!Number.isSafeInteger(oldPort) || oldPort<1 || oldPort>65535) continue;
      if (!await portAvailable(oldPort))
        throw Error("旧服务记录对应的端口 "+oldPort+" 仍在使用，请先停止实际运行的服务");
      // The old port has no listener. This is a stale control record, not data.
      const marker=join(directory,name);
      if (existsSync(marker) && lstatSync(marker).isFile()) unlinkSync(marker);
      for(const pending of readdirSync(directory))
        if(new RegExp("^\\.sd-stop-"+oldPort+"-[a-f0-9]{48}$").test(pending) && lstatSync(join(directory,pending)).isFile())
          unlinkSync(join(directory,pending));
    }
    let released=false;
    return () => {
      if(released)return;
      released=true;
      try {
        unlinkSync(join(lock,"owner.json"));
        rmdirSync(lock);
      } finally { unlock(); }
    };
  } catch(error) {
    try {
      if(ownsCompatibilityLock){
        const owner=join(lock,"owner.json");
        if(existsSync(owner))unlinkSync(owner);
        rmdirSync(lock);
      }
    } finally { unlock(); }
    throw error;
  }
}
