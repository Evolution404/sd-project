import {
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  statSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
const root = resolve(import.meta.dirname, "..", "..");
const version = process.env.SD_NODE_VERSION || "v24.13.0";
if (!/^v24\.\d+\.\d+$/.test(version))
  throw Error("Windows 运行时仅允许经过测试的 Node 24.x");
const archive = `node-${version}-win-x64.zip`;
const nodeBase = `https://nodejs.org/download/release/${version}`;
const work = join(root, "dist");
const frontend = join(work, "web");
const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const dirty = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (revision.status !== 0 || dirty.status !== 0 || dirty.stdout.trim())
  throw Error("正式打包要求工作区干净，请先提交全部受控源码和文档");
const gitCommit = revision.stdout.trim();
const stage = join(root, ".build", "windows-staging");
const cache = join(root, ".build", "windows-cache");
mkdirSync(cache, { recursive: true });
mkdirSync(work, { recursive: true });
async function download(url, path) {
  if (existsSync(path)) return;
  console.log("Downloading", url);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw Error(url + ": " + response.status);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path + ".part"),
  );
  const { renameSync } = await import("node:fs");
  renameSync(path + ".part", path);
}
const digestFile = (p) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
const shas = join(cache, `${version}-SHASUMS256.txt`);
await download(nodeBase + "/SHASUMS256.txt", shas);
const sums = readFileSync(shas, "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim().split(/\s+/));
const entry = sums.find((x) => x.at(-1) === archive);
if (!entry || !entry[0] || !/^[a-f0-9]{64}$/i.test(entry[0]))
  throw Error("Cannot find official SHA256 for " + archive);
const nodeZip = join(cache, archive);
await download(nodeBase + "/" + archive, nodeZip);
if (digestFile(nodeZip) !== entry[0])
  throw Error("Official Node.js SHA256 mismatch");
console.log("Verified official Node.js SHA256", entry[0]);
if (!existsSync(join(frontend, "index.html")))
  throw Error("Run npm run build first");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "runtime"), { recursive: true });
const runtime = join(stage, "runtime", "node.exe");
const shell = spawnSync(
  "unzip",
  ["-p", nodeZip, `node-${version}-win-x64/node.exe`],
  { cwd: root, encoding: null, maxBuffer: 120 * 1024 * 1024 },
);
if (shell.status !== 0 || !shell.stdout?.length)
  throw Error("Cannot extract Windows node.exe: " + shell.stderr?.toString());
writeFileSync(runtime, shell.stdout);
if (statSync(runtime).size < 20000000)
  throw Error("Windows runtime binary unusually small");
cpSync(frontend, join(stage, "dist", "web"), { recursive: true });
cpSync(join(root, "dist/server"), join(stage, "dist/server"), { recursive: true });
mkdirSync(join(stage, "scripts"), { recursive: true });
for (const [src, dest] of [
  ["scripts/init-admin.mjs", "scripts/init-admin.mjs"],
  ["scripts/backup.mjs", "scripts/backup.mjs"],
  ["scripts/restore.mjs", "scripts/restore.mjs"],
  ["scripts/upgrade-equipment-fields.mjs", "scripts/upgrade-equipment-fields.mjs"],
  ["scripts/upgrade-schema113.mjs", "scripts/upgrade-schema113.mjs"],
  ["scripts/first-run.ps1", "scripts/first-run.ps1"],
  ["scripts/windows/启动服务.cmd", "启动服务.cmd"],
  ["scripts/windows/备份数据库.cmd", "备份数据库.cmd"],
  ["scripts/windows/初始化管理员.cmd", "初始化管理员.cmd"],
  ["README.md", "README.md"],
  ...[
    "docs/implementation/Schema113_重写执行计划_2026-11-08.md",
    "docs/implementation/Schema113_重写交付与验收_2026-11-08.md",
    "docs/architecture/Schema113_应用接入_无税率_草稿撤回与完整计价_2026-11-08.md",
    "docs/architecture/系统开发规范.md",
    "docs/decisions/2026-11-09_系统独立_自动编码_最少录入.md",
    "docs/implementation/2026-11-09_独立业务_自动身份与最少录入_实施验收.md",
    "docs/implementation/2026-11-09_全系统治理执行与验收状态.md",
    "docs/decisions/2026-11-09_已删除作业对象关联操作归档修复.md",
    "docs/implementation/2026-11-09_界面组件评估与迁移路线.md",
    "docs/implementation/2026-11-09_设备台账Excel治理与验收.md",
  ].map((path) => [path, path]),
  ["package.json", "package.json"],
]) {
  const out = join(stage, dest);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(root, src), out);
}
const ps = readFileSync(join(stage, "scripts", "first-run.ps1"));
if (ps.subarray(0, 3).toString("hex") !== "efbbbf")
  throw Error("PowerShell 5.1 requires UTF-8 BOM");
for (const f of ["启动服务.cmd", "初始化管理员.cmd"]) {
  if ([...readFileSync(join(stage, f))].some((c) => c >= 128))
    throw Error(f + " must be ASCII only");
}
for (const f of [
  "dist/server/main.js",
  "dist/server/database/connection.js",
  "package.json",
]) {
  if (readFileSync(join(stage, f)).subarray(0, 3).toString("hex") === "efbbbf")
    throw Error(f + " must be UTF8 without BOM");
}
for (const f of ["package.json", "package-lock.json"])
  copyFileSync(join(root, f), join(stage, f));
console.log("Installing production dependencies in isolated staging");
const npm = spawnSync(
  "npm",
  [
    "ci",
    "--omit=dev",
    "--omit=optional",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  { cwd: stage, stdio: "inherit" },
);
if (npm.status !== 0) throw Error("Production dependency installation failed");
function artifactHashes(directory) {
  const hashes = {};
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else hashes[path.slice(directory.length + 1).replaceAll("\\", "/")] = digestFile(path);
    }
  }
  visit(directory);
  return hashes;
}
const trackedSources = spawnSync("git", ["ls-files", "-z", "server"], { cwd: root, encoding: "utf8" });
if (trackedSources.status !== 0) throw Error("无法固定服务端源码清单");
const sourceHashes = Object.fromEntries(trackedSources.stdout.split("\0").filter(Boolean)
  .map(path => [path, digestFile(join(root, path))]));
const manifest = {
  product: "sd-project",
  entrypoint: "dist/server/main.js",
  server_source_sha256: sourceHashes,
  server_artifact_sha256: artifactHashes(join(stage, "dist/server")),
  git_commit: gitCommit,
  target: "Windows 10 x64, PowerShell 5.1",
  runtime: version,
  runtime_archive_sha256: entry[0],
  runtime_node_exe_sha256: digestFile(runtime),
  frontend_index_sha256: digestFile(join(stage, "dist", "web", "index.html")),
  ps1_utf8_bom: true,
  cmd_ascii_only: true,
  data_location: "./data",
  schema_version: 113,
  schema_sha256: digestFile(
    join(stage, "dist/server/database/schema/schema113.sql"),
  ),
  build_timestamp: new Date().toISOString(),
};
writeFileSync(
  join(stage, "BUILD-MANIFEST.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const zipPath = join(work, "sd-project-win10-x64.zip");
const pendingZip = zipPath + ".part";
const python = `import os,sys,zipfile\nbase,out=sys.argv[1:]\nwith zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:\n for folder,dirs,files in os.walk(base):\n  dirs.sort();files.sort()\n  for f in files:\n   path=os.path.join(folder,f);rel=os.path.relpath(path,base)\n   z.write(path,rel)\nprint(out)\n`;
const proc = spawnSync("python3", ["-c", python, stage, pendingZip], {
  cwd: root,
  stdio: "inherit",
});
if (proc.status !== 0) throw Error("ZIP creation failed");
const verify = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1]);bad=z.testzip();assert bad is None,bad\nfiles=set(z.namelist());need={'runtime/node.exe','scripts/first-run.ps1','启动服务.cmd','初始化管理员.cmd','dist/server/main.js','dist/server/database/connection.js','dist/server/database/schema/schema113.sql','dist/server/modules/exchange/service.mjs','dist/web/index.html','BUILD-MANIFEST.json'};assert need.issubset(files),str(need-files)\nassert z.read('scripts/first-run.ps1')[:3]==bytes.fromhex('efbbbf')\nassert all(x<128 for x in z.read('启动服务.cmd'))\nassert not any(x.startswith('data/') for x in files), 'ZIP must not contain runtime data'\nassert b'DATA_DIR=%~dp0data' in z.read('启动服务.cmd')\nprint('ZIP_OK files:',len(files))\n`;
const check = spawnSync("python3", ["-c", verify, pendingZip], {
  encoding: "utf8",
});
if (check.status !== 0) throw Error("ZIP verify failed: " + check.stderr);
console.log(check.stdout.trim());
const finalStatus = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
const finalRevision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
if (
  finalStatus.status !== 0 ||
  finalStatus.stdout.trim() ||
  finalRevision.stdout.trim() !== gitCommit
)
  throw Error("打包期间源码发生变化，保留原发布包，请提交后重新打包");
renameSync(pendingZip, zipPath);
const release = {
  git_commit: gitCommit,
  generated_at: manifest.build_timestamp,
  path: "dist/sd-project-win10-x64.zip",
  size_bytes: statSync(zipPath).size,
  sha256: digestFile(zipPath),
  runtime: version,
  schema_version: 113,
  windows_machine_verified: false,
};
writeFileSync(
  join(work, "RELEASE-MANIFEST.json"),
  JSON.stringify(release, null, 2) + "\n",
);
console.log("PACKAGE", zipPath);
console.log("SIZE_BYTES", statSync(zipPath).size);
console.log("SHA256", digestFile(zipPath));
