import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const parent = join(root, ".build", "legacy-browser");
mkdirSync(parent, { recursive: true });
const workspace = mkdtempSync(join(parent, "run-"));
const pnpm = process.env.npm_execpath;
if (!pnpm || !process.env.npm_config_user_agent?.startsWith("pnpm/10.34.5 "))
  throw Error("请使用 pnpm 10.34.5 运行 test:browser:legacy");
let status=0;
try {
for (const input of ["server", "scripts", "tests", "docs", "tsconfig.server.json", "package.json"]) {
  cpSync(join(root, input), join(workspace, input), { recursive: true });
}
const fixture = join(root, "tests", "fixtures", "legacy-frontend");
for (const input of ["web", "index.html", "vite.config.ts", "tsconfig.json"]) {
  cpSync(join(fixture, input), join(workspace, input), { recursive: true });
}
symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), "junction");
console.log("LEGACY_BROWSER_WORKSPACE", workspace);
for (const args of [[pnpm, "run", "build:server"], [pnpm, "run", "build:web:legacy"],
  [join(workspace, "tests/run-browser-suites.mjs"), "--legacy", ...process.argv.slice(2)]]) {
  const result = spawnSync(process.execPath, args, { cwd: workspace, stdio: "inherit" });
  if (result.status !== 0) {status=result.status??1;break;}
}
} finally {
  const results=join(workspace,"test-results");
  if(existsSync(results)){
    const evidence=join(root,"test-results","legacy",workspace.split("/").at(-1));
    mkdirSync(evidence,{recursive:true});cpSync(results,evidence,{recursive:true});
    console.log("LEGACY_BROWSER_EVIDENCE",evidence);
  }
  rmSync(workspace,{recursive:true,force:true});
}
process.exitCode=status;
