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
const root = resolve(import.meta.dirname, "../.."),
  zip = join(root, "dist/sd-project-win10-x64.zip"),
  temporary = mkdtempSync(join(tmpdir(), "sd113-package-")),
  stage = join(temporary, "release"),
  data = join(temporary, "data");
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
assert.equal(manifest.schema_version, 113);
assert.equal(manifest.git_commit, receipt.git_commit);
const shipped = spawnSync(
  "git",
  [
    "ls-files",
    "-z",
    "server",
    "scripts/init-admin.mjs",
    "scripts/backup.mjs",
    "scripts/restore.mjs",
    "scripts/upgrade-equipment-fields.mjs",
    "package.json",
    "package-lock.json",
  ],
  { cwd: root, encoding: "utf8" },
);
assert.equal(shipped.status, 0);
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
  hash(join(stage, "server/database/schema/schema113.sql")),
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
  const child = spawn(processExec, [join(stage, "server/main.mjs")], {
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
    name: "防鸟装置",
    work_target_type: "physical",
  });
  const operation = await write("/catalog/operations", {
    name: "包装验收操作",
    work_object_id: object.id,
    default_unit_id: unit.id,
    work_target_type: "physical",
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
