import { requireNode26, sourceSnapshot } from "./source-snapshot.mjs";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { verifyPackageAccessLogs } from "./verify-access-logs.mjs";
requireNode26();
const root = resolve(import.meta.dirname, "../.."),
  zip = join(root, "dist/sd-project-win10-x64.zip"),
  temporary = mkdtempSync(join(tmpdir(), "sd113-package-")),
  stage = join(temporary, "release"),
  data = join(stage, "data");
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const receipt = JSON.parse(
  readFileSync(join(root, "dist/RELEASE-MANIFEST.json"), "utf8"),
);
assert.equal(hash(zip), receipt.sha256);
const git = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(git.stdout.trim(), receipt.git_commit);
// A subsequent real frontend build must preserve the finished ZIP byte-for-byte.
const rebuild = spawnSync("npm", ["run", "build"], {
  cwd: root,
  encoding: "utf8",
  timeout: 120000,
});
assert.equal(rebuild.status, 0, rebuild.stderr + rebuild.stdout);
assert.equal(hash(zip), receipt.sha256, "前端重建改写或清理了发布包");
const extracted = spawnSync(
  "python3",
  [
    "-c",
    `import zipfile,sys,os
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
base=os.path.abspath(sys.argv[2])
for name in z.namelist():
 assert os.path.commonpath([base,os.path.abspath(os.path.join(base,name))])==base
 assert not name.startswith('data/')
z.extractall(base)
`,
    zip,
    stage,
  ],
  { encoding: "utf8" },
);
assert.equal(extracted.status, 0, extracted.stderr);
for (const dependency of [
  "vite",
  "typescript",
  "playwright",
  "unplugin-vue-components",
])
  assert.equal(
    existsSync(join(stage, "node_modules", dependency)),
    false,
    "发布包包含开发依赖 " + dependency,
  );
const manifest = JSON.parse(
  readFileSync(join(stage, "BUILD-MANIFEST.json"), "utf8"),
);
for(const file of ["scripts/training/instance.mjs",
    "启动训练环境.cmd","训练实例列表.cmd",
    "docs/implementation/P10_业务操作帮助覆盖清单.md",
    "docs/implementation/杆塔性质与材质字典_实施验收_2026-11-12.md"])
  assert.ok(existsSync(join(stage,file)),"离线包缺少P10及杆塔字典资源："+file);
assert.equal(manifest.schema_version, 113);
assert.match(manifest.runtime,/^v26\.\d+\.\d+$/);
assert.equal(manifest.runtime,receipt.runtime);
  for (const config of ["vite.config.ts", "tsconfig.json", "tsconfig.server.json"])
    assert.match(manifest.build_input_files_sha256[config], /^[a-f0-9]{64}$/);
assert.equal(manifest.git_commit, receipt.git_commit);
assert.equal(sourceSnapshot(root).sha256, manifest.build_input_sha256, "发布包构建输入与当前源码不一致");
assert.deepEqual(sourceSnapshot(root).files, manifest.build_input_files_sha256);
assert.equal(manifest.ps1_utf8_bom, true,
  "formal release must include its PowerShell 5.1 BOM entrypoint");
assert.equal(manifest.data_location, "./data");
assert.equal(typeof manifest.worktree_dirty, "boolean");
assert.match(manifest.build_input_sha256,/^[0-9a-f]{64}$/);
assert.equal(manifest.worktree_dirty,receipt.worktree_dirty);
assert.equal(manifest.build_input_sha256,receipt.build_input_sha256);
const shipped = spawnSync(
  "git",
  [
    "ls-files",
    "-z",
    "scripts/init-admin.mjs",
    "scripts/backup.mjs",
    "scripts/restore.mjs",
    "package.json",
    "package-lock.json",
  ],
  { cwd: root, encoding: "utf8" },
);
assert.equal(shipped.status, 0);
assert.equal(manifest.entrypoint, "dist/server/main.js");
for (const [path, digest] of Object.entries(manifest.server_source_sha256))
  assert.equal(hash(join(root, path)), digest, "服务端源码与发布提交不一致 " + path);
for (const [path, digest] of Object.entries(manifest.server_artifact_sha256)) {
  assert.equal(hash(join(stage, "dist/server", path)), digest, "服务端产物不一致 " + path);
  assert.equal(hash(join(root, "dist/server", path)), digest, "本地重建产物不一致 " + path);
}
assert.equal(existsSync(join(stage, "server")), false, "离线包应运行编译产物");
for (const path of shipped.stdout.split("\0").filter(Boolean))
  assert.equal(
    hash(join(stage, path)),
    hash(join(root, path)),
    "发布源码不一致 " + path,
  );
assert.equal(
  hash(join(stage, "runtime/node.exe")),
  manifest.runtime_node_exe_sha256,
);
assert.equal(
  hash(join(stage, "dist/server/database/schema/schema113.sql")),
  manifest.schema_sha256,
);
assert.equal(
  hash(join(stage, "dist/web/index.html")),
  hash(join(root, "dist/web/index.html")),
);
assert.equal(
  readFileSync(join(stage, "runtime/node.exe")).toString("ascii", 0, 2),
  "MZ",
);
const port = await new Promise((resolve) => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1", () => {
    const value = listener.address().port;
    listener.close(() => resolve(value));
  });
});
const env = {
  ...process.env,
  DATA_DIR: data,
  HOST: "127.0.0.1",
  PORT: String(port),
  ACCESS_LOG_MAX_FILE_BYTES: "2048",
  SD_ADMIN_USER: "package-admin",
  SD_ADMIN_PASSWORD: "Package-verified-password",
};
const initialized = spawnSync(
  process.execPath,
  [join(stage, "scripts/init-admin.mjs")],
  { env, encoding: "utf8", timeout: 20000 },
);
assert.equal(initialized.status, 0, initialized.stderr);
function launch(directory) {
  const child = spawn(processExec, [join(stage, "dist/server/main.js")], {
    env: { ...env, DATA_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}
const processExec = process.execPath;
let server = launch(data);
async function ready() {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("生产包启动超时")), 20000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("SCHEMA113_READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(Error("生产包提前退出 " + code));
    });
  });
}
async function stop() {
  if (server.exitCode !== null) return;
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await stopped;
}
try {
  await ready();
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "package-admin",
      password: env.SD_ADMIN_PASSWORD,
    }),
  });
  assert.equal(login.status, 200);
  const loginRequestId = login.headers.get("x-request-id");
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await fetch(base + "/api/dashboard", { headers: { Cookie: cookie } }))
      .status,
    200,
  );
  assert.equal((await fetch(base)).status, 200);
  const unauthorized = await fetch(base + "/api/demands");
  assert.equal(unauthorized.status, 401);
  async function write(path, value) {
    const response = await fetch(base + "/api" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(value),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const unit = await write("/catalog/units", { name: "套" });
  const object = await write("/catalog/objects", {
    name: "物理杆塔检修",
    object_position: "body",
    attribution_unit: "physical_tower",
  });
  const operation = await write("/catalog/operations", {
    name: "包装验收操作",
    work_object_id: object.id,
    default_unit_id: unit.id,
    completion_standard: "安装牢固",
  });
  const tower = await write("/catalog/physical", { asset_no: "离线验收实物" });
  const demand = await write("/demands", {
    operation_id: operation.id,
    problem_description: "生产包临时隔离验收事实",
    work_locations: [
      {
        location_kind: "physical_tower",
        physical_tower_id: tower.id,
        quantity_scaled: 10000,
      },
    ],
    sources: [{ description: "离线包验收" }],
  });
  const attachment = await write("/evidence", {
    owner_kind: "demand_id",
    owner_id: demand.id,
    filename: "验收依据.txt",
    base64: Buffer.from("release-evidence").toString("base64"),
  });
  const logHeaders = { Cookie: cookie };
  await verifyPackageAccessLogs(base, logHeaders, data, loginRequestId);
  const accounts = await (await fetch(base + "/api/users", { headers: logHeaders })).json();
  assert.equal(accounts.items.some(row => row.username === "demo"), false, "formal package must not seed demo");
  await stop();
  server = launch(data);
  await ready();
  const persistedLogs = await verifyPackageAccessLogs(base, logHeaders, data, loginRequestId);
  assert.ok(persistedLogs.files >= 2, "extracted package must rotate access logs by file size");
  const backup = spawnSync(processExec, [join(stage, "scripts/backup.mjs")], {
    env,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(backup.status, 0, backup.stderr);
  const backupPath = backup.stdout.trim().split("\n").at(-1);
  const restored = join(temporary, "restored");
  const restore = spawnSync(
    processExec,
    [join(stage, "scripts/restore.mjs"), backupPath, restored],
    { env, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(restore.status, 0, restore.stderr);
  await stop();
  server = launch(restored);
  await ready();
  const persisted = await fetch(base + "/api/demands/" + demand.id, {
    headers: { Cookie: cookie },
  });
  assert.equal(persisted.status, 200);
  assert.equal((await persisted.json()).quantity_scaled, 10000);
  const restoredAttachment = await fetch(
    base + "/api/evidence/" + attachment.id,
    { headers: { Cookie: cookie } },
  );
  assert.equal(restoredAttachment.status, 200);
  assert.equal(await restoredAttachment.text(), "release-evidence");
  receipt.host_verification = {
    verified_at: new Date().toISOString(),
    os: process.platform,
    node: process.version,
    rebuild_preserved_zip: true,
    actual_zip_extracted: true,
    backup_restore_restart: true,
    access_logs_rotation_restart: true,
  };
  writeFileSync(
    join(root, "dist/RELEASE-MANIFEST.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    "PORTABLE_ZIP_SMOKE_OK",
    process.version,
    "host",
    process.platform,
    "schema113, production dependencies, assets and authenticated API",
  );
} finally {
  await stop();
  rmSync(temporary, { recursive: true, force: true });
}
