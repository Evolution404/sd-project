import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { projectRoot } from "../paths.js";
import { assertExistingDatabase } from "../../database/connection.js";

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

/** Exclusive per dataset, independent of program version and port. Fail closed
 * on an unclean exit; never guess a stale lock is safe to remove. */
export function acquireDataset(directory: string, port?: number): () => void {
  const lock = join(directory,".sd-dataset.lock");
  if (readdirSync(directory).some(name=>/^\.sd-running-\d+$/.test(name)))
    throw Error("数据目录存在受管服务记录，请先停止旧服务");
  try { mkdirSync(lock, {mode:0o700}); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw Error("数据目录已被占用或上次未正常退出，请先确认所有服务停止，再检查 .sd-dataset.lock");
    throw error;
  }
  const owner=join(lock,"owner.json");
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    if(existsSync(owner))unlinkSync(owner);
    rmdirSync(lock);
  };
  try {
    writeFileSync(owner, JSON.stringify({pid:process.pid,port:port??null,started_at:new Date().toISOString(),program:projectRoot})+"\n",{flag:"wx",mode:0o600});
    // Existing schema is checked read-only before createSystem can initialize.
    assertExistingDatabase(directory);
    return release;
  } catch(error) { release(); throw error; }
}
