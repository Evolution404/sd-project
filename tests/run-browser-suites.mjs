import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "tests/e2e");
const legacy = process.argv.includes("--legacy");
const governance = process.argv.includes("--governance");
const selected = process.argv.slice(2).filter(argument => argument.startsWith("--suite="))
  .map(argument => argument.slice("--suite=".length));
const governanceSuites = new Set([
  "governance-write-retry-browser.mjs", "finance-cross-page-choices-browser.mjs", "project-browser.mjs",
]);
const files = readdirSync(directory).filter(file => {
  if (!/^(?:browser|.+-browser)\.mjs$/.test(file)) return false;
  if (governance && !governanceSuites.has(file)) return false;
  const formal = file.startsWith("youlai-");
  return legacy ? !formal : formal;
}).sort();
if (!files.length) throw Error("没有找到浏览器验收用例");
for (const name of selected)
  if (!files.includes(name)) throw Error("无法在此验收模式运行用例：" + name);
const suites = selected.length ? files.filter(file => selected.includes(file)) : files;

const failed = [];
const env = legacy ? process.env : { ...process.env, SD_BROWSER_STATIC_DIRECTORY: resolve(root, "dist/web") };
for (const file of suites) {
  console.log("BROWSER_SUITE_START", file);
  const path = resolve(directory, file);
  const args = file === "demo-browser.mjs" ? ["--test", path] : [path];
  const result = spawnSync(process.execPath, args, {
    cwd: root, stdio: "inherit", env, timeout: 480000,
  });
  if (result.status !== 0) {
    failed.push(file);
    console.error("BROWSER_SUITE_FAILED", file, result.error?.message || result.signal || result.status);
  } else console.log("BROWSER_SUITE_OK", file);
}
console.log("BROWSER_SUITE_TOTAL", JSON.stringify({ total: suites.length, passed: suites.length - failed.length, failed }));
if (failed.length) process.exitCode = 1;
