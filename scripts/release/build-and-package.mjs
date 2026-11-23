import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { sourceSnapshot, requireNode26 } from "./source-snapshot.mjs";
requireNode26();
const root = resolve(import.meta.dirname, "../..");
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (head.status !== 0) throw Error("无法读取构建基线");
const snapshot = sourceSnapshot(root);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error("请使用npm run package:win或package:win:demo");
for (const command of ["build", "check:ui:strict", "check:no-tax", "check:independent-input"]) {
  const result = spawnSync(process.execPath, [npmCli, "run", command], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
if (sourceSnapshot(root).sha256 !== snapshot.sha256) throw Error("构建期间输入文件发生变化，请重新构建");
const result = spawnSync(process.execPath, [resolve(root, "scripts/release/package-win10.mjs")], {
  cwd: root, stdio: "inherit", env: { ...process.env,
    SD_BUILD_INPUT_SHA256: snapshot.sha256, SD_BUILD_GIT_COMMIT: head.stdout.trim() },
});
process.exitCode = result.status || 0;
