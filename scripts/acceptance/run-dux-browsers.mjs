import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const scripts = JSON.parse(await readFile("package.json", "utf8"))
  .scripts["test:browser"].split("&&")
  .map((text) => text.trim())
  .filter((text) => text.startsWith("node "));
const output = "test-results/dux/browser";
await mkdir(output, { recursive: true });
// Build current source exactly once before testing; do not reuse stale dist.
const buildSucceeded = await new Promise((resolve) => {
  const build = spawn("npm", ["run", "build"], { stdio: "inherit" });
  build.on("error", () => resolve(false));
  build.on("close", (code, signal) => resolve(code === 0 && !signal));
});
if (!buildSucceeded) throw new Error("Browser build failed; E2E not started");
const results = [];
async function worker() {
  while (scripts.length) {
    const command = scripts.shift(),
      name = command.split("/").at(-1);
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, command.split(/\s+/).slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      child.stdout.on("data", (chunk) => (log += chunk));
      child.stderr.on("data", (chunk) => (log += chunk));
      const timer = setTimeout(() => child.kill("SIGTERM"), 600000);
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ name, code, signal, log });
      });
    });
    await writeFile(output + "/" + name + ".log", result.log);
    results.push({
      name: result.name,
      code: result.code,
      signal: result.signal,
    });
    console.log(result.code === 0 ? "PASS" : "FAIL", name, result.code);
  }
}
// Shared dist and browser test resources: run serially to avoid contention.
await worker();
await writeFile(output + "/results.json", JSON.stringify(results, null, 2));
if (results.some((result) => result.code !== 0)) process.exitCode = 1;
